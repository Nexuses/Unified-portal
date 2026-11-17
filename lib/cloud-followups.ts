import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { runInApiCredit } from "@/lib/api-credits-server";
import { chatWithDeepSeekResult } from "@/lib/deepseek";
import { applyContactVariables } from "@/lib/email-variables";
import { cleanSignatureHtml, personaliseEmphasizeTerms, pitchToHtml } from "@/lib/personalise-types";
import {
  applyColumnTokens,
  cleanCell,
  resolveCloudRowFields,
  type CloudColumnMap,
  type CloudResolvedRow,
} from "@/lib/cloud-sheet-csv";
import {
  CLOUD_FOLLOWUP_MAX_STEPS,
  type CloudFollowupSettings,
  type CloudFollowupStatus,
  type CloudFollowupStep,
} from "@/lib/cloud-campaigns";
import { getCloudCampaignDoc, patchCloudCampaignDoc, type CloudCampaignDoc } from "@/lib/cloud-campaigns-server";
import { cloudSendsFilter } from "@/lib/cloud-campaign-tracking";
import { isSendAllowed, nextAllowedTime, type CloudSchedule } from "@/lib/cloud-schedule";

/**
 * Automatic follow-ups for cloud campaigns. After a pitch goes out, follow-up 1 is booked
 * `delayDays` later; when it's sent, follow-up 2 is booked, and so on. Each one is a reply in the
 * original thread, sent by the same no-AI script sender. Its text comes from the sheet column
 * mapped for that step, or, when that cell is empty, is written by AI from the person's pitch.
 * Anyone who replied, bounced or unsubscribed gets no further follow-ups.
 */
export type CloudFollowupDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  campaignId: string;
  row: number;
  /** 1-based follow-up number. */
  step: number;
  email: string;
  /** Subject of the original email (the thread). */
  threadSubject: string;
  /** Gmail id of the original message, when known (opens the thread directly). */
  messageId?: string;
  status: CloudFollowupStatus;
  dueAt: Date;
  /** When the previous email in this thread went out (the delay counts from here). */
  previousSentAt: Date;
  sentAt?: Date;
  reason?: string;
  source?: "sheet" | "ai";
  /** Text actually used (cached so a preview, a retry and the sent email match). */
  bodyText?: string;
  attempts: number;
  /** A send may have gone out (server stopped mid-send): check the thread before resending. */
  uncertain?: boolean;
  claimUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CloudFollowupView = {
  row: number;
  step: number;
  email: string;
  status: CloudFollowupStatus;
  dueAt?: string;
  sentAt?: string;
  reason?: string;
  source?: "sheet" | "ai";
};

const DAY_MS = 24 * 60 * 60 * 1000;

let indexesReady = false;
async function followups() {
  const db = await getDb();
  const collection = db.collection<CloudFollowupDoc>("cloud_followups");
  if (!indexesReady) {
    indexesReady = true;
    await Promise.all([
      collection.createIndex({ projectId: 1, campaignId: 1, row: 1, step: 1 }, { unique: true }),
      collection.createIndex({ status: 1, dueAt: 1 }),
    ]).catch((error) => console.warn("[cloud-followups] index:", error instanceof Error ? error.message : error));
  }
  return collection;
}

type OriginalSend = {
  _id: ObjectId;
  email: string;
  cloudRow: number;
  sentAt?: Date;
  subjectLine?: string;
  gmailMessageId?: string;
  repliedAt?: Date;
  bouncedAt?: Date;
  unsubscribedAt?: Date;
};

async function originalSends(projectId: ObjectId, campaignId: string) {
  const db = await getDb();
  return db
    .collection<OriginalSend>("campaign_sends")
    .find(
      { ...(await cloudSendsFilter(projectId, campaignId)), status: "sent" },
      {
        projection: {
          email: 1,
          cloudRow: 1,
          sentAt: 1,
          subjectLine: 1,
          gmailMessageId: 1,
          repliedAt: 1,
          bouncedAt: 1,
          unsubscribedAt: 1,
        },
      },
    )
    .toArray();
}

async function originalSend(projectId: ObjectId, campaignId: string, row: number, email: string) {
  const db = await getDb();
  return db
    .collection<OriginalSend>("campaign_sends")
    .findOne({ ...(await cloudSendsFilter(projectId, campaignId)), status: "sent", cloudRow: row, email });
}

/* ------------------------------------------------------------------ Settings */

/** Validate follow-up settings from the page. */
export function normalizeFollowupSettings(raw: unknown, headers: string[]): CloudFollowupSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .slice(0, CLOUD_FOLLOWUP_MAX_STEPS)
    .map((value, index): CloudFollowupStep => {
      const step = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const column = typeof step.column === "string" && headers.includes(step.column) ? step.column : undefined;
      return {
        id: typeof step.id === "string" && step.id ? step.id.slice(0, 40) : `fu${index + 1}`,
        delayDays: Math.max(1, Math.min(60, Math.round(Number(step.delayDays) || 3))),
        column,
        instructions: typeof step.instructions === "string" ? step.instructions.trim().slice(0, 600) : undefined,
      };
    });
  return {
    enabled: input.enabled === true && steps.length > 0,
    steps,
    savedAt: new Date().toISOString(),
  };
}

function scheduleOf(doc: CloudCampaignDoc): CloudSchedule {
  return {
    timezone: doc.schedule?.timezone || "UTC",
    excludedDays: doc.schedule?.excludedDays || [],
    windowStart: doc.schedule?.windowStart,
    windowEnd: doc.schedule?.windowEnd,
  };
}

function dueFrom(previousSentAt: Date, step: CloudFollowupStep, schedule: CloudSchedule) {
  const earliest = new Date(Math.max(Date.now(), previousSentAt.getTime() + step.delayDays * DAY_MS));
  return nextAllowedTime(earliest, schedule) || earliest;
}

/* ------------------------------------------------------------------ Planning */

/**
 * Bring the follow-up queue in line with the campaign: book the next follow-up for everyone
 * whose previous email went out, re-time unsent ones after a settings change, and drop
 * unsent ones for steps that were removed or when follow-ups are off. Cheap and idempotent.
 */
export async function planCloudFollowups(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  const collection = await followups();
  if (!doc) return { booked: 0 };
  const settings = doc.followups;
  if (!settings?.enabled || !settings.steps.length) {
    await collection.deleteMany({ projectId, campaignId, status: "scheduled" });
    return { booked: 0 };
  }
  const steps = settings.steps;
  const schedule = scheduleOf(doc);
  await collection.deleteMany({ projectId, campaignId, status: "scheduled", step: { $gt: steps.length } });

  // Re-time unsent follow-ups (delay or schedule may have changed).
  const pending = await collection.find({ projectId, campaignId, status: "scheduled" }).toArray();
  for (const item of pending) {
    const step = steps[item.step - 1];
    if (!step) continue;
    const due = dueFrom(item.previousSentAt, step, schedule);
    if (Math.abs(due.getTime() - item.dueAt.getTime()) > 60_000) {
      await collection.updateOne({ _id: item._id, status: "scheduled" }, { $set: { dueAt: due, updatedAt: new Date() } });
    }
  }

  const sends = await originalSends(projectId, campaignId);
  const existing = await collection
    .find({ projectId, campaignId }, { projection: { row: 1, step: 1, status: 1, sentAt: 1 } })
    .toArray();
  const byKey = new Map(existing.map((item) => [`${item.row}:${item.step}`, item]));
  let booked = 0;
  for (const send of sends) {
    if (!send.sentAt || send.repliedAt || send.bouncedAt || send.unsubscribedAt) continue;
    // The next follow-up to book: after the last one sent for this row.
    let previousSentAt = send.sentAt;
    let nextStep = 1;
    for (; nextStep <= steps.length; nextStep += 1) {
      const item = byKey.get(`${send.cloudRow}:${nextStep}`);
      if (!item) break;
      if (item.status !== "sent" || !item.sentAt) {
        nextStep = 0; // one is already queued, failed or skipped: nothing more to book
        break;
      }
      previousSentAt = item.sentAt;
    }
    if (nextStep < 1 || nextStep > steps.length) continue;
    const now = new Date();
    const result = await collection.updateOne(
      { projectId, campaignId, row: send.cloudRow, step: nextStep },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          projectId,
          campaignId,
          row: send.cloudRow,
          step: nextStep,
          email: send.email,
          threadSubject: send.subjectLine || "",
          messageId: send.gmailMessageId,
          status: "scheduled",
          dueAt: dueFrom(previousSentAt, steps[nextStep - 1], schedule),
          previousSentAt,
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) booked += 1;
  }
  return { booked };
}

/** Everything the page shows about follow-ups for one campaign. */
export async function listCloudFollowups(projectId: ObjectId, campaignId: string) {
  const collection = await followups();
  const docs = await collection.find({ projectId, campaignId }).sort({ row: 1, step: 1 }).limit(10_000).toArray();
  const items: CloudFollowupView[] = docs.map((doc) => ({
    row: doc.row,
    step: doc.step,
    email: doc.email,
    status: doc.status,
    dueAt: doc.status === "scheduled" || doc.status === "sending" ? doc.dueAt.toISOString() : undefined,
    sentAt: doc.sentAt?.toISOString(),
    reason: doc.reason,
    source: doc.source,
  }));
  const nextDue = docs
    .filter((doc) => doc.status === "scheduled")
    .reduce<Date | null>((min, doc) => (!min || doc.dueAt < min ? doc.dueAt : min), null);
  return { items, nextDueAt: nextDue?.toISOString() };
}

export async function deleteCloudFollowups(projectId: ObjectId, campaignId: string) {
  const collection = await followups();
  await collection.deleteMany({ projectId, campaignId });
}

/* ------------------------------------------------------------------ Content */

const FOLLOWUP_ANGLES = [
  "a gentle, friendly nudge that adds one new, concrete reason to talk (a benefit or outcome not stated before)",
  "a different angle: a short example, result or question relevant to their role or company",
  "a brief, low-pressure check whether this is a priority right now, offering to send something useful instead",
  "a polite close-the-loop note: say you won't follow up again and leave the door open",
];

function fieldsFor(doc: CloudCampaignDoc, row: number) {
  const cells = (Array.isArray(doc.sheetRows) ? doc.sheetRows[row]?.cells : null) || {};
  const map: CloudColumnMap = doc.columnMap || {};
  return { cells, map, fields: resolveCloudRowFields(cells, map) };
}

function cleanAiText(text: string) {
  return String(text || "")
    .replace(/^```[a-z]*\n?|```$/gim, "")
    .replace(/^\s*subject\s*:.*$/gim, "")
    .replace(/\[(your name|name|signature)\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** AI-written follow-up for one person, from their original pitch. */
async function writeFollowupWithAi(input: {
  projectId: ObjectId;
  stepNumber: number;
  totalSteps: number;
  fields: CloudResolvedRow;
  instructions?: string;
  previous: string[];
}) {
  const angle =
    input.stepNumber === input.totalSteps && input.totalSteps > 1
      ? FOLLOWUP_ANGLES[3]
      : FOLLOWUP_ANGLES[Math.min(input.stepNumber - 1, 2)];
  const system = [
    "You write short B2B follow-up emails. Each one is sent as a reply in the same thread as an earlier cold email that has had no response.",
    "Rules:",
    "- 35 to 90 words. Plain text, short paragraphs. No subject line.",
    "- Start with a greeting using the first name if known (e.g. \"Hi Priya,\").",
    "- Don't repeat the original pitch; refer to it in a few words at most.",
    "- No clichés such as \"just following up\", \"bumping this\", \"circling back\", \"hope this finds you well\".",
    "- One soft call to action. No links unless the original had one.",
    "- Never invent facts, numbers, clients or names that are not in the original email.",
    "- Match the language and spelling (British/American) of the original email.",
    "- End with a short sign-off line such as \"Best,\" on its own line and NO name after it (the signature is added).",
    "Reply with the email body only.",
  ].join("\n");
  const user = [
    `This is follow-up ${input.stepNumber} of ${input.totalSteps}. Make it ${angle}.`,
    input.instructions ? `Extra guidance from the sender: ${input.instructions}` : "",
    "",
    `Recipient: ${[input.fields.firstname, input.fields.lastname].filter(Boolean).join(" ") || "unknown"}${
      input.fields.position ? `, ${input.fields.position}` : ""
    }${input.fields.company ? ` at ${input.fields.company}` : ""}${input.fields.industry ? ` (${input.fields.industry})` : ""}`,
    `Original subject: ${input.fields.subject}`,
    "Original email:",
    input.fields.pitch.slice(0, 3000),
    ...(input.previous.length
      ? ["", "Follow-ups already sent (don't repeat them):", ...input.previous.map((text, i) => `#${i + 1}: ${text.slice(0, 800)}`)]
      : []),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
  const result = await runInApiCredit(input.projectId.toHexString(), "cloud", () =>
    chatWithDeepSeekResult({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 500,
    }),
  );
  const text = cleanAiText(result.content);
  if (text.length < 20) throw new Error("The AI returned an empty follow-up");
  return text;
}

/** Text for a follow-up: the sheet cell when there is one, else AI. Cached on the queue item. */
export async function followupText(
  doc: CloudCampaignDoc,
  row: number,
  stepNumber: number,
  previous: string[] = [],
): Promise<{ text: string; source: "sheet" | "ai" }> {
  const settings = doc.followups;
  const step = settings?.steps[stepNumber - 1];
  if (!step) throw new Error(`Follow-up ${stepNumber} isn't set up`);
  const { cells, fields } = fieldsFor(doc, row);
  const fromSheet = step.column ? cleanCell(cells[step.column]) : "";
  if (fromSheet) {
    return {
      text: applyColumnTokens(fromSheet, cells),
      source: "sheet",
    };
  }
  const text = await writeFollowupWithAi({
    projectId: doc.projectId,
    stepNumber,
    totalSteps: settings?.steps.length || 1,
    fields,
    instructions: step.instructions,
    previous,
  });
  return { text, source: "ai" };
}

/** HTML + plain text for a follow-up body (same rendering and signature as the pitch). */
export function followupBody(doc: CloudCampaignDoc, row: number, text: string) {
  const { fields } = fieldsFor(doc, row);
  const signature = cleanSignatureHtml(String(doc.signatureHtml || "").trim());
  const marked = signature ? `<div data-cloud-signature="1" style="margin:18px 0 0">${signature}</div>` : "";
  const contact = {
    firstName: fields.firstname,
    lastName: fields.lastname,
    email: fields.email,
    companyName: fields.company,
    position: fields.position,
  };
  const emphasize = personaliseEmphasizeTerms({ companyName: fields.company, steps: [{ body: text }] });
  const html = applyContactVariables(pitchToHtml(text, marked, { emphasize, linkify: true }), contact, true);
  const plain = applyContactVariables(text, contact, false).trim();
  return { html, plain, fields };
}

/** Earlier follow-ups sent to this row (so the next one doesn't repeat them). */
async function previousTexts(projectId: ObjectId, campaignId: string, row: number, beforeStep: number) {
  const collection = await followups();
  const docs = await collection
    .find({ projectId, campaignId, row, step: { $lt: beforeStep }, status: "sent" })
    .sort({ step: 1 })
    .toArray();
  return docs.map((doc) => doc.bodyText || "").filter(Boolean);
}

/** Preview follow-up `stepNumber` for a row: subject, html and where the text came from. */
export async function previewCloudFollowup(projectId: ObjectId, campaignId: string, row: number, stepNumber: number) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  const rows = Array.isArray(doc.sheetRows) ? doc.sheetRows : [];
  if (!rows[row]) throw new Error("That row doesn't exist");
  const collection = await followups();
  const queued = await collection.findOne({ projectId, campaignId, row, step: stepNumber });
  let text = queued?.bodyText || "";
  let source = queued?.source;
  if (!text) {
    const made = await followupText(doc, row, stepNumber, await previousTexts(projectId, campaignId, row, stepNumber));
    text = made.text;
    source = made.source;
    // Keep it so the email that goes out is the one that was previewed.
    if (queued && queued.status === "scheduled") {
      await collection.updateOne({ _id: queued._id }, { $set: { bodyText: text, source, updatedAt: new Date() } });
    }
  }
  const { html, fields } = followupBody(doc, row, text);
  const subject = fields.subject ? (/^re:/i.test(fields.subject) ? fields.subject : `Re: ${fields.subject}`) : "Re: (original subject)";
  return { row, step: stepNumber, to: fields.email, subject, html, source, queued: Boolean(queued) };
}

/** Move one queued follow-up to now (the worker sends it within a minute). */
export async function sendCloudFollowupNow(projectId: ObjectId, campaignId: string, row: number, step: number) {
  const collection = await followups();
  const result = await collection.updateOne(
    { projectId, campaignId, row, step, status: "scheduled" },
    { $set: { dueAt: new Date(), reason: "Sending now (requested).", updatedAt: new Date() } },
  );
  if (!result.matchedCount) throw new Error("That follow-up isn't waiting to be sent.");
}

/* ------------------------------------------------------------------ Worker */

/** Claim one due follow-up (or one left mid-send by a stopped server). */
async function claimDue() {
  const collection = await followups();
  const now = new Date();
  const claimUntil = new Date(now.getTime() + 8 * 60 * 1000);
  const stale = await collection.findOneAndUpdate(
    { status: "sending", claimUntil: { $lte: now } },
    { $set: { claimUntil, uncertain: true, updatedAt: now }, $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (stale) return stale;
  return collection.findOneAndUpdate(
    { status: "scheduled", dueAt: { $lte: now } },
    { $set: { status: "sending", claimUntil, updatedAt: now }, $inc: { attempts: 1 } },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  );
}

async function settle(item: CloudFollowupDoc, patch: Partial<CloudFollowupDoc>) {
  const collection = await followups();
  await collection.updateOne(
    { _id: item._id },
    { $set: { ...patch, updatedAt: new Date() }, $unset: { claimUntil: "" } },
  );
}

async function postpone(item: CloudFollowupDoc, until: Date, reason: string) {
  await settle(item, { status: "scheduled", dueAt: until, reason, attempts: Math.max(0, item.attempts - 1) });
}

export type FollowupSender = (input: {
  campaign: CloudCampaignDoc;
  item: CloudFollowupDoc;
  html: string;
  plain: string;
  dupCheck: boolean;
}) => Promise<{ ok: boolean; status?: string; code?: string; message?: string; sendPressed?: boolean }>;

export type FollowupHooks = {
  send: FollowupSender;
  /** Refresh replies/bounces for this campaign (sender inbox). */
  checkInbox: (campaign: CloudCampaignDoc) => Promise<void>;
  /** Name of another campaign holding the computer, or null. */
  busyWith: (campaign: CloudCampaignDoc) => Promise<string | null>;
  /** Stop the computer when nothing is due soon. */
  idle: (projectId: ObjectId) => Promise<void>;
};

const TRANSIENT = new Set([
  "CDP_UNREACHABLE",
  "CHROME_START_FAILED",
  "GMAIL_NOT_LOADED",
  "OUTLOOK_NOT_LOADED",
  "GMAIL_NAVIGATION_FAILED",
  "COMPOSE_NOT_LOADED",
  "BODY_INSERT_FAILED",
  "BODY_VERIFY_FAILED",
  "THREAD_NOT_OPENED",
  "REPLY_BUTTON_MISSING",
  "SCRIPT_TIMEOUT",
  "COMMAND_TIMEOUT",
  "TOOLKIT_INSTALL_FAILED",
]);

const FAILURE_TEXT: Record<string, string> = {
  LOGIN_REQUIRED: "The sender Chrome is signed out — sign in (step 2); follow-ups resume on their own.",
  WRONG_ACCOUNT: "The sender Chrome is signed in to a different account.",
  THREAD_NOT_FOUND: "The original email wasn't found in Sent.",
  RECIPIENT_MISMATCH: "The reply would have gone to someone else, so it wasn't sent.",
  SEND_UNCONFIRMED: "Send was pressed but couldn't be confirmed — check the thread.",
};

async function processOne(item: CloudFollowupDoc, hooks: FollowupHooks, touched: Set<string>) {
  const campaign = await getCloudCampaignDoc(item.projectId, item.campaignId);
  const settings = campaign?.followups;
  const step = settings?.steps[item.step - 1];
  if (!campaign || !settings?.enabled || !step) {
    const collection = await followups();
    await collection.deleteOne({ _id: item._id });
    return;
  }
  touched.add(campaign.projectId.toHexString());
  const now = new Date();
  if (campaign.status === "paused") {
    await postpone(item, new Date(now.getTime() + 60 * 60 * 1000), "Waiting: the campaign is paused.");
    return;
  }
  const schedule = scheduleOf(campaign);
  if (!isSendAllowed(now, schedule)) {
    const next = nextAllowedTime(now, schedule) || new Date(now.getTime() + DAY_MS);
    await postpone(item, next, "Waiting for the sending days/hours.");
    return;
  }
  const busy = await hooks.busyWith(campaign);
  if (busy) {
    await postpone(item, new Date(now.getTime() + 10 * 60 * 1000), `Waiting: the computer is sending "${busy}".`);
    return;
  }

  // Never follow up on someone who replied, bounced or unsubscribed.
  const stale = !campaign.inboxCheckedAt || now.getTime() - campaign.inboxCheckedAt.getTime() > 30 * 60 * 1000;
  if (stale) await hooks.checkInbox(campaign).catch(() => undefined);
  const original = await originalSend(item.projectId, item.campaignId, item.row, item.email);
  if (!original) {
    await settle(item, { status: "skipped", reason: "The original email isn't in the report any more." });
    return;
  }
  const stopReason = original.repliedAt
    ? "Replied"
    : original.bouncedAt
      ? "Bounced"
      : original.unsubscribedAt
        ? "Unsubscribed"
        : "";
  if (stopReason) {
    await settle(item, { status: "skipped", reason: stopReason });
    return;
  }

  let text = item.bodyText || "";
  let source = item.source;
  if (!text) {
    try {
      const made = await followupText(campaign, item.row, item.step, await previousTexts(item.projectId, item.campaignId, item.row, item.step));
      text = made.text;
      source = made.source;
      const collection = await followups();
      await collection.updateOne({ _id: item._id }, { $set: { bodyText: text, source, updatedAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (item.attempts >= 3) await settle(item, { status: "failed", reason: `Couldn't write the follow-up: ${message.slice(0, 160)}` });
      else await postpone(item, new Date(now.getTime() + 30 * 60 * 1000), `Writing failed, retrying: ${message.slice(0, 120)}`);
      return;
    }
  }
  const { html, plain } = followupBody(campaign, item.row, text);
  const result = await hooks
    .send({ campaign, item: { ...item, bodyText: text, source }, html, plain, dupCheck: Boolean(item.uncertain) || item.attempts > 1 })
    .catch((error): Awaited<ReturnType<FollowupSender>> => ({
      ok: false,
      code: "SEND_ERROR",
      message: error instanceof Error ? error.message : String(error),
      sendPressed: false,
    }));

  if (result.ok && (result.status === "sent" || result.status === "already_sent")) {
    await settle(item, { status: "sent", sentAt: new Date(), reason: undefined, uncertain: false, bodyText: text, source });
    await planCloudFollowups(item.projectId, item.campaignId);
    return;
  }
  const code = String(result.code || "error");
  if (result.sendPressed) {
    // It may have gone out: next try opens the thread and checks for this text first.
    await settle(item, {
      status: item.attempts >= 3 ? "failed" : "scheduled",
      dueAt: new Date(now.getTime() + 20 * 60 * 1000),
      uncertain: true,
      reason: FAILURE_TEXT.SEND_UNCONFIRMED,
    });
    return;
  }
  if (code === "LOGIN_REQUIRED" || code === "WRONG_ACCOUNT") {
    await postpone(item, new Date(now.getTime() + 2 * 60 * 60 * 1000), FAILURE_TEXT[code]);
    await patchCloudCampaignDoc(campaign.projectId, campaign.campaignId, { lastError: `Follow-ups waiting: ${FAILURE_TEXT[code]}` });
    return;
  }
  if (TRANSIENT.has(code) && item.attempts < 3) {
    await postpone(item, new Date(now.getTime() + 15 * 60 * 1000), `Retrying (${code}).`);
    return;
  }
  await settle(item, {
    status: "failed",
    reason: FAILURE_TEXT[code] || `${code}${result.message ? `: ${String(result.message).slice(0, 140)}` : ""}`,
  });
}

/** Plan follow-ups for recent campaigns, then send what's due. Called by the send worker. */
export async function runCloudFollowupTick(hooks: FollowupHooks) {
  const db = await getDb();
  const recent = await db
    .collection<CloudCampaignDoc>("cloud_campaigns")
    .find(
      { "followups.enabled": true, lastSentAt: { $gte: new Date(Date.now() - 120 * DAY_MS) } },
      { projection: { projectId: 1, campaignId: 1 } },
    )
    .limit(200)
    .toArray();
  for (const campaign of recent) {
    await planCloudFollowups(campaign.projectId, campaign.campaignId).catch((error) =>
      console.error("[cloud-followups] plan failed:", error),
    );
  }
  const touched = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    const item = await claimDue();
    if (!item) break;
    try {
      await processOne(item, hooks, touched);
    } catch (error) {
      console.error("[cloud-followups] send failed:", error);
      await postpone(item, new Date(Date.now() + 15 * 60 * 1000), "Unexpected error; retrying.");
    }
  }
  for (const projectHex of touched) {
    await hooks.idle(new ObjectId(projectHex)).catch(() => undefined);
  }
}

/** Soonest follow-up due for any campaign in this project (to decide whether to stop the computer). */
export async function nextFollowupDueForProject(projectId: ObjectId) {
  const collection = await followups();
  const next = await collection.find({ projectId, status: { $in: ["scheduled", "sending"] } }).sort({ dueAt: 1 }).limit(1).next();
  return next?.dueAt || null;
}
