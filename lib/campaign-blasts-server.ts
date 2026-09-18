import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc, ListDoc, ListMembershipDoc } from "@/lib/crm";
import {
  campaignSequences,
  formatCampaignClock,
  isOneOneCampaign,
  sequencesReady,
  type CampaignSequence,
  type CampaignSequenceProgress,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { getSuppressionSets, isSuppressedAddress } from "@/lib/unsubscribe-server";
import {
  DEFAULT_PROJECT_SENDING_LIMIT,
  normalizeSendingLimit,
} from "@/lib/projects";
import {
  injectCampaignTracking,
  isNonNavigationalTrackedUrl,
  resolveUtmConfig,
  resolveUsableTrackingOrigin,
} from "@/lib/campaign-tracking";
import { sendProjectMail } from "@/lib/smtp-senders-server";
import { normalizeStoredMessageId } from "@/lib/master-inbox-server";
import { normalizeEmailMergeTags } from "@/lib/email-variables";
import { emitWebhookEventBackground } from "@/lib/webhooks-server";
import {
  GMAIL_DAILY_LIMIT_DEFAULT,
  normalizeGmailDailyLimit,
  type SenderDoc,
} from "@/lib/smtp-senders";

export type BlastStatus = "scheduled" | "sending" | "sent" | "paused";

export type BlastTimelineEvent = {
  id: string;
  type: "draft" | "scheduled" | "sent";
  title: string;
  description: string;
  at: string;
};

export type CampaignBlastDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  campaignId: string;
  name: string;
  subject: string;
  previewText?: string;
  html: string;
  senderId: string;
  senderName?: string;
  senderEmail: string;
  replyTo?: string;
  listId?: string;
  listName?: string;
  listDisplayId?: number;
  timezone: string;
  status: BlastStatus;
  scheduledFor?: Date;
  sentAt?: Date;
  recipients: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
  conversions: number;
  bounces: number;
  replies: number;
  timeline: BlastTimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
  kind?: "drip" | "oneone";
  sequences?: CampaignSequence[];
  windowStart?: string;
  windowEnd?: string;
  emailGapMinutes?: number;
  sendLockUntil?: Date;
  utmEnabled?: boolean;
  utmSourceEnabled?: boolean;
  utmSource?: string;
  utmMediumEnabled?: boolean;
  utmMedium?: string;
  utmCampaignEnabled?: boolean;
  utmCampaign?: string;
};

export type CampaignSendDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  blastId: ObjectId;
  campaignId: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  companyName: string;
  token: string;
  status: "pending" | "sending" | "sent" | "failed";
  error?: string;
  claimedAt?: Date;
  sentAt?: Date;
  openedAt?: Date;
  openCount: number;
  clickedAt?: Date;
  clickedUrl?: string;
  clickEvents?: Array<{ url: string; at: Date; ignored?: boolean }>;
  clickCount: number;
  /** True when multi-link burst scanning was detected for this send. */
  clickBurstIgnored?: boolean;
  unsubscribedAt?: Date;
  /** Set when a real reply is matched via Master Inbox. */
  repliedAt?: Date;
  /** Set when a bounce/DSN is matched via Master Inbox. */
  bouncedAt?: Date;
  sequenceId?: string;
  sequenceIndex?: number;
  availableAt?: Date;
  /** Outbound RFC Message-ID (angle brackets). */
  messageId?: string;
  /** Lowercased Message-ID without brackets for reply matching. */
  messageIdNorm?: string;
};

export type CampaignReport = {
  campaignId: string;
  kind?: "drip" | "oneone";
  name: string;
  subject: string;
  senderName?: string;
  senderEmail: string;
  replyTo?: string;
  html: string;
  status: BlastStatus;
  timezone: string;
  scheduledFor?: string;
  sentAt?: string;
  recipients: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
  conversions: number;
  bounces: number;
  replies: number;
  listId?: string;
  listName?: string;
  listDisplayId?: number;
  timeline: BlastTimelineEvent[];
  sequenceProgress?: CampaignSequenceProgress;
};

const SEND_BATCH = 25;
const LOCKED_SEQUENCE_AT = new Date("2099-01-01T00:00:00.000Z");

function blastKindFilter(kind?: string): Record<string, unknown> {
  if (kind === "oneone") {
    return { kind: "oneone" };
  }
  if (kind === "drip") {
    return { kind: { $ne: "oneone" as const } };
  }
  return {};
}

async function findBlastForCampaign(
  projectId: ObjectId,
  campaignId: string,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  if (kind) {
    const typed = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
      projectId,
      campaignId,
      ...blastKindFilter(kind),
    });
    if (typed) {
      return typed;
    }
  }
  // Fallback for older blasts missing kind, or kind/campaignId desync
  return db.collection<CampaignBlastDoc>("campaign_blasts").findOne(
    { projectId, campaignId },
    { sort: { updatedAt: -1 } },
  );
}

function parseHmToMinutes(value: string) {
  const [hours, minutes] = String(value || "").split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function minutesInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isWithinSendWindow(
  date: Date,
  timeZone: string,
  windowStart?: string,
  windowEnd?: string,
) {
  const start = parseHmToMinutes(windowStart ?? "");
  const end = parseHmToMinutes(windowEnd ?? "");
  if (start === null || end === null) {
    return true;
  }
  if (start === end) {
    return true;
  }
  const current = minutesInTimeZone(date, timeZone);
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function sequenceContent(blast: CampaignBlastDoc, send: CampaignSendDoc) {
  const sequence =
    blast.sequences?.find((item) => item.id === send.sequenceId) ??
    (typeof send.sequenceIndex === "number" ? blast.sequences?.[send.sequenceIndex] : undefined);
  return {
    subject: sequence?.subject?.trim() || blast.subject,
    html: sequence?.designHtml?.trim() || blast.html,
  };
}

async function failLaterSequences(
  blastId: ObjectId,
  email: string,
  sequenceIndex: number | undefined,
  error: string,
) {
  const index = typeof sequenceIndex === "number" ? sequenceIndex : 0;
  const db = await getDb();
  await db.collection<CampaignSendDoc>("campaign_sends").updateMany(
    {
      blastId,
      email,
      sequenceIndex: { $gt: index },
      status: { $in: ["pending", "sending"] },
    },
    {
      $set: { status: "failed", error },
      $unset: { claimedAt: "" },
    },
  );
}

/** Stop later 1-1 steps when a contact replies to an earlier sequence email. */
export async function stopOneOneSequencesOnReply(send: {
  blastId: ObjectId;
  email: string;
  sequenceIndex?: number;
}) {
  await failLaterSequences(
    send.blastId,
    send.email,
    typeof send.sequenceIndex === "number" ? send.sequenceIndex : 0,
    "Replied",
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyContactVariables(
  text: string,
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    companyName: string;
  },
  forHtml = true,
) {
  const values: Record<string, string> = {
    FIRSTNAME: contact.firstName || "",
    LASTNAME: contact.lastName || "",
    EMAIL: contact.email || "",
    COMPANY: contact.companyName || "",
  };

  return normalizeEmailMergeTags(text).replace(
    /\{\{\s*contact\.([A-Za-z]+)\s*\}\}/g,
    (_, key: string) => {
      const value = values[key.toUpperCase()] ?? "";
      return forHtml ? escapeHtml(value) : value;
    },
  );
}

async function resolveTrackingOrigin(projectId: ObjectId, senderId: string) {
  const db = await getDb();
  const sender = await db.collection("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId,
  });
  const typed = sender as {
    trackingDomain?: string;
  } | null;
  // Live HTTPS probe — DNS-only "verified" is not enough (Cloudflare 1014).
  return resolveUsableTrackingOrigin(typed?.trackingDomain);
}

function mapReport(
  doc: CampaignBlastDoc,
  sequenceProgress?: CampaignSequenceProgress,
): CampaignReport {
  return {
    campaignId: doc.campaignId,
    kind: doc.kind === "oneone" ? "oneone" : "drip",
    name: doc.name,
    subject: doc.subject,
    senderName: doc.senderName,
    senderEmail: doc.senderEmail,
    replyTo: doc.replyTo,
    html: doc.html,
    status: doc.status,
    timezone: doc.timezone,
    scheduledFor: doc.scheduledFor?.toISOString(),
    sentAt: doc.sentAt?.toISOString(),
    recipients: doc.recipients,
    delivered: doc.delivered,
    opens: doc.opens,
    clicks: doc.clicks,
    unsubscribed: doc.unsubscribed,
    conversions: doc.conversions,
    bounces: doc.bounces ?? 0,
    replies: doc.replies ?? 0,
    listId: doc.listId,
    listName: doc.listName,
    listDisplayId: doc.listDisplayId,
    timeline: doc.timeline,
    sequenceProgress,
  };
}

type SequenceSendGroup = {
  _id: { blastId: ObjectId; sequenceIndex?: number };
  pending: number;
  sent: number;
};

async function loadSequenceProgress(blasts: CampaignBlastDoc[]) {
  const oneOne = blasts.filter((blast) => blast.kind === "oneone");
  const progress = new Map<string, CampaignSequenceProgress>();
  if (oneOne.length === 0) {
    return progress;
  }

  const db = await getDb();
  const grouped = (await db
    .collection<CampaignSendDoc>("campaign_sends")
    .aggregate<SequenceSendGroup>([
      { $match: { blastId: { $in: oneOne.map((blast) => blast._id) } } },
      {
        $group: {
          _id: { blastId: "$blastId", sequenceIndex: "$sequenceIndex" },
          pending: {
            $sum: {
              $cond: [{ $in: ["$status", ["pending", "sending"]] }, 1, 0],
            },
          },
          sent: {
            $sum: {
              $cond: [{ $eq: ["$status", "sent"] }, 1, 0],
            },
          },
        },
      },
    ])
    .toArray()) as SequenceSendGroup[];

  const rowsByBlast = new Map<
    string,
    Array<{ sequenceIndex: number; pending: number; sent: number }>
  >();
  for (const row of grouped) {
    const blastId = String(row._id.blastId);
    const list = rowsByBlast.get(blastId) ?? [];
    list.push({
      sequenceIndex: Number(row._id.sequenceIndex) || 0,
      pending: row.pending,
      sent: row.sent,
    });
    rowsByBlast.set(blastId, list);
  }

  for (const blast of oneOne) {
    const total = Math.max(1, blast.sequences?.length || 1);
    const rows = rowsByBlast.get(blast._id.toString()) ?? [];
    const currentIndex =
      [...Array(total).keys()].find((index) => {
        const row = rows.find((item) => item.sequenceIndex === index);
        return (row?.pending ?? 0) > 0;
      }) ??
      Math.max(0, total - 1);
    const currentRow = rows.find((item) => item.sequenceIndex === currentIndex);
    progress.set(blast._id.toString(), {
      current: currentIndex + 1,
      total,
      sent: currentRow?.sent ?? 0,
      contacts: blast.recipients || 0,
    });
  }

  return progress;
}

async function reportsFromBlasts(docs: CampaignBlastDoc[]) {
  const progress = await loadSequenceProgress(docs);
  return docs.map((doc) => mapReport(doc, progress.get(doc._id.toString())));
}

async function resolveRecipients(
  projectId: ObjectId,
  campaign: DripCampaign,
) {
  const db = await getDb();

  if (campaign.recipientMode === "individual" && campaign.individualContacts?.length) {
    return campaign.individualContacts.map((contact) => {
      const [firstName, ...rest] = contact.fullName.trim().split(" ");
      return {
        email: contact.email.trim().toLowerCase(),
        fullName: contact.fullName,
        firstName: firstName || "",
        lastName: rest.join(" "),
        companyName: "",
      };
    });
  }

  if (!campaign.listId || !ObjectId.isValid(campaign.listId)) {
    return [];
  }

  const listId = new ObjectId(campaign.listId);
  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, listId })
    .toArray();
  const contactIds = memberships.map((item) => item.contactId);
  if (contactIds.length === 0) {
    return [];
  }

  const contacts = await db
    .collection<ContactDoc>("contacts")
    .find({
      _id: { $in: contactIds },
      projectId,
      subscribed: { $ne: false },
      blocklisted: { $ne: true },
    })
    .toArray();

  return contacts
    .map((contact) => ({
      email: contact.email.trim().toLowerCase(),
      fullName: `${contact.firstName} ${contact.lastName}`.trim(),
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.companyName || "",
    }))
    .filter((contact) => contact.email);
}

function isCountableClickEvent(event: {
  url?: string;
  ignored?: boolean;
}) {
  if (event.ignored) {
    return false;
  }
  return !isNonNavigationalTrackedUrl(event.url ?? "");
}

function sendHasCountableClick(send: Pick<CampaignSendDoc, "clickEvents" | "clickedAt" | "clickedUrl">) {
  const events = send.clickEvents ?? [];
  if (events.length > 0) {
    return events.some((event) => isCountableClickEvent(event));
  }
  if (!send.clickedAt) {
    return false;
  }
  return !isNonNavigationalTrackedUrl(send.clickedUrl ?? "");
}

async function refreshBlastCounts(blastId: ObjectId) {
  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const [delivered, opens, clickDocs, bounceEmails, replies] = await Promise.all([
    sends.countDocuments({
      blastId,
      status: "sent",
      bouncedAt: { $exists: false },
    }),
    sends.countDocuments({ blastId, openCount: { $gt: 0 } }),
    sends
      .find({
        blastId,
        $or: [{ clickCount: { $gt: 0 } }, { clickedAt: { $exists: true } }],
      })
      .project({ clickEvents: 1, clickedAt: 1, clickedUrl: 1 })
      .toArray(),
    sends.distinct("email", {
      blastId,
      $or: [
        { bouncedAt: { $exists: true } },
        {
          status: "failed",
          error: { $nin: ["Unsubscribed", "Suppressed", "Replied"] },
        },
      ],
    }),
    sends.countDocuments({
      blastId,
      repliedAt: { $exists: true },
    }),
  ]);
  const clicks = clickDocs.filter((send) => sendHasCountableClick(send)).length;
  const bounces = bounceEmails.length;

  const pending = await sends.countDocuments({
    blastId,
    status: { $in: ["pending", "sending"] },
  });
  const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    _id: blastId,
  });
  if (!blast) {
    return null;
  }

  const now = new Date();
  const nextStatus: BlastStatus =
    blast.status === "paused"
      ? "paused"
      : pending === 0
        ? "sent"
        : blast.status === "scheduled"
          ? "scheduled"
          : "sending";
  const timeline = [...blast.timeline];
  if (nextStatus === "sent" && blast.status !== "sent") {
    timeline.unshift({
      id: randomBytes(6).toString("hex"),
      type: "sent",
      title: "Sending completed",
      description: `The campaign [${blast.campaignId}] ${blast.name} has been sent.`,
      at: now.toISOString(),
    });
  }

  await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
    { _id: blastId },
    {
      $set: {
        delivered,
        opens,
        clicks,
        bounces,
        replies,
        status: nextStatus,
        sentAt: nextStatus === "sent" ? blast.sentAt ?? now : blast.sentAt,
        timeline,
        updatedAt: now,
      },
    },
  );

  return db.collection<CampaignBlastDoc>("campaign_blasts").findOne({ _id: blastId });
}

function utcDayBounds(now = new Date()) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** How many emails this sender has already used today (UTC), including in-flight claims. */
async function countSenderSendsToday(
  projectId: ObjectId,
  senderId: string,
  dayStart: Date,
  dayEnd: Date,
) {
  const db = await getDb();
  const blastDocs = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({ projectId, senderId }, { projection: { _id: 1 } })
    .toArray();
  const blastIds = blastDocs.map((blast) => blast._id);
  if (blastIds.length === 0) {
    return 0;
  }
  return db.collection<CampaignSendDoc>("campaign_sends").countDocuments({
    projectId,
    blastId: { $in: blastIds },
    $or: [
      { status: "sent", sentAt: { $gte: dayStart, $lt: dayEnd } },
      { status: "sending", claimedAt: { $gte: dayStart, $lt: dayEnd } },
    ],
  });
}

async function remainingGmailDailySends(
  projectId: ObjectId,
  senderId: string,
  now = new Date(),
) {
  if (!ObjectId.isValid(senderId)) {
    return null;
  }
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId,
  });
  if (!sender || sender.provider !== "gmail") {
    return null;
  }
  const dailyLimit = normalizeGmailDailyLimit(
    sender.dailyLimit ?? GMAIL_DAILY_LIMIT_DEFAULT,
  );
  const { start, end } = utcDayBounds(now);
  const used = await countSenderSendsToday(projectId, senderId, start, end);
  return Math.max(0, dailyLimit - used);
}

async function sendPendingBatch(
  blast: CampaignBlastDoc,
  limit = SEND_BATCH,
  depth = 0,
) {
  const db = await getDb();
  const now = new Date();
  const oneOne = blast.kind === "oneone";
  if (
    oneOne &&
    !isWithinSendWindow(now, blast.timezone || "Asia/Kolkata", blast.windowStart, blast.windowEnd)
  ) {
    return blast;
  }

  const gmailRemaining = await remainingGmailDailySends(
    blast.projectId,
    blast.senderId,
    now,
  );
  if (gmailRemaining !== null) {
    if (gmailRemaining <= 0) {
      return blast;
    }
    limit = Math.min(limit, gmailRemaining);
  }

  const gapMinutes = oneOne ? Math.max(0, Number(blast.emailGapMinutes) || 0) : 0;
  if (oneOne) {
    // Repair stuck later sequences that should already be unlocked from an earlier send
    if (blast.sequences && blast.sequences.length > 1) {
      const sentSteps = await db
        .collection<CampaignSendDoc>("campaign_sends")
        .find({
          blastId: blast._id,
          status: "sent",
          sequenceIndex: { $gte: 0 },
        })
        .project({ email: 1, sequenceIndex: 1, sentAt: 1 })
        .toArray();
      for (const sent of sentSteps) {
        if (typeof sent.sequenceIndex !== "number") {
          continue;
        }
        const nextSequence = blast.sequences[sent.sequenceIndex + 1];
        if (!nextSequence) {
          continue;
        }
        const delayDays = Math.max(0, Number(nextSequence.delayDays) || 0);
        const base = sent.sentAt instanceof Date ? sent.sentAt : now;
        const availableAt = new Date(base.getTime() + delayDays * 24 * 60 * 60 * 1000);
        if (availableAt.getTime() > now.getTime()) {
          continue;
        }
        await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
          {
            blastId: blast._id,
            email: sent.email,
            sequenceIndex: sent.sequenceIndex + 1,
            status: "pending",
            availableAt: { $gt: now },
          },
          { $set: { availableAt } },
        );
      }
    }

    const locked = await db.collection<CampaignBlastDoc>("campaign_blasts").findOneAndUpdate(
      {
        _id: blast._id,
        $or: [{ sendLockUntil: { $exists: false } }, { sendLockUntil: { $lte: now } }],
      },
      { $set: { sendLockUntil: new Date(now.getTime() + 60_000), updatedAt: now } },
      { returnDocument: "after" },
    );
    if (!locked) {
      return blast;
    }

    if (gapMinutes > 0) {
      const lastSent = await db.collection<CampaignSendDoc>("campaign_sends").findOne(
        { blastId: blast._id, status: "sent", sentAt: { $exists: true } },
        { sort: { sentAt: -1 } },
      );
      if (lastSent?.sentAt) {
        const nextAllowed = new Date(lastSent.sentAt.getTime() + gapMinutes * 60 * 1000);
        if (nextAllowed.getTime() > now.getTime()) {
          await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
            { _id: blast._id },
            { $set: { sendLockUntil: nextAllowed, updatedAt: now } },
          );
          return blast;
        }
      }
    }
    limit = gapMinutes > 0 ? 1 : limit;
  }

  await db.collection<CampaignSendDoc>("campaign_sends").updateMany(
    {
      blastId: blast._id,
      status: "sending",
      claimedAt: { $lte: new Date(now.getTime() - 2 * 60 * 1000) },
    },
    { $set: { status: "pending" }, $unset: { claimedAt: "" } },
  );

  const trackingBase = await resolveTrackingOrigin(blast.projectId, blast.senderId);
  const pending: CampaignSendDoc[] = [];
  for (let index = 0; index < limit; index += 1) {
    const claimed = await db.collection<CampaignSendDoc>("campaign_sends").findOneAndUpdate(
      {
        blastId: blast._id,
        status: "pending",
        $or: [{ availableAt: { $exists: false } }, { availableAt: { $lte: now } }],
      },
      { $set: { status: "sending", claimedAt: now } },
      { sort: { sequenceIndex: 1, _id: 1 }, returnDocument: "after" },
    );
    if (!claimed) {
      break;
    }
    pending.push(claimed);
  }

  if (pending.length === 0 && oneOne) {
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: blast._id },
      { $set: { sendLockUntil: now, updatedAt: now } },
    );
    return refreshBlastCounts(blast._id);
  }

  const suppressed = await getSuppressionSets(blast.projectId);
  let lastSuccessAt: Date | null = null;

  for (const send of pending) {
    if (isSuppressedAddress(send.email, suppressed)) {
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        { $set: { status: "failed", error: "Suppressed" }, $unset: { claimedAt: "" } },
      );
      await failLaterSequences(blast._id, send.email, send.sequenceIndex, "Unsubscribed");
      continue;
    }

    // 1-1: if this contact already replied, never send further sequences
    if (oneOne) {
      const stoppedByReply = await db.collection<CampaignSendDoc>("campaign_sends").findOne({
        blastId: blast._id,
        email: send.email,
        status: "failed",
        error: "Replied",
      });
      if (stoppedByReply) {
        await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
          { _id: send._id },
          { $set: { status: "failed", error: "Replied" }, $unset: { claimedAt: "" } },
        );
        await failLaterSequences(blast._id, send.email, send.sequenceIndex, "Replied");
        continue;
      }
    }

    try {
      const content = sequenceContent(blast, send);
      const personalized = applyContactVariables(content.html, send, true);
      const html = injectCampaignTracking(personalized, trackingBase, send.token, {
        utm: resolveUtmConfig(blast),
        campaignName: blast.name,
      });
      const mailResult = await sendProjectMail(blast.projectId, blast.senderId, {
        to: send.email,
        subject: applyContactVariables(content.subject, send, false),
        html,
        fromName: blast.senderName,
        replyTo: blast.replyTo,
        listUnsubscribeUrl: `${trackingBase.replace(/\/$/, "")}/api/unsubscribe/${send.token}`,
      });
      const sentAt = new Date();
      lastSuccessAt = sentAt;
      const messageId = mailResult?.messageId;
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        {
          $set: {
            status: "sent",
            sentAt,
            error: undefined,
            ...(messageId
              ? {
                  messageId,
                  messageIdNorm: normalizeStoredMessageId(messageId),
                }
              : {}),
          },
          $unset: { claimedAt: "" },
        },
      );

      if (typeof send.sequenceIndex === "number" && blast.sequences) {
        const nextSequence = blast.sequences[send.sequenceIndex + 1];
        if (nextSequence) {
          const delayDays = Math.max(0, Number(nextSequence.delayDays) || 0);
          const availableAt = new Date(
            sentAt.getTime() + delayDays * 24 * 60 * 60 * 1000,
          );
          await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
            {
              blastId: blast._id,
              email: send.email.trim().toLowerCase(),
              sequenceIndex: send.sequenceIndex + 1,
              status: "pending",
            },
            { $set: { availableAt } },
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        {
          $set: {
            status: "failed",
            error: message,
          },
          $unset: { claimedAt: "" },
        },
      );
      await failLaterSequences(blast._id, send.email, send.sequenceIndex, message);
    }
  }

  if (oneOne) {
    const lockUntil =
      lastSuccessAt && gapMinutes > 0
        ? new Date(lastSuccessAt.getTime() + gapMinutes * 60 * 1000)
        : new Date();
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: blast._id },
      { $set: { sendLockUntil: lockUntil, updatedAt: now } },
    );

    // With 0-day sequence delay (and no minute gap), keep draining newly unlocked steps
    if (gapMinutes === 0 && lastSuccessAt && depth < 10) {
      const dueNext = await db.collection<CampaignSendDoc>("campaign_sends").countDocuments({
        blastId: blast._id,
        status: "pending",
        $or: [{ availableAt: { $exists: false } }, { availableAt: { $lte: new Date() } }],
      });
      if (dueNext > 0) {
        const refreshed = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
          _id: blast._id,
        });
        if (refreshed && refreshed.status === "sending") {
          return sendPendingBatch(refreshed, limit, depth + 1);
        }
      }
    }
  }

  return refreshBlastCounts(blast._id);
}

async function getProjectSendingQuota(projectId: ObjectId) {
  const db = await getDb();
  const [project, blasts] = await Promise.all([
    db.collection("projects").findOne(
      { _id: projectId },
      { projection: { sendingLimit: 1 } },
    ),
    db
      .collection<CampaignBlastDoc>("campaign_blasts")
      .find({
        projectId,
        status: { $in: ["sent", "sending", "scheduled", "paused"] },
      })
      .project({ delivered: 1, recipients: 1 })
      .toArray(),
  ]);

  const sendingLimit = normalizeSendingLimit(
    project?.sendingLimit ?? DEFAULT_PROJECT_SENDING_LIMIT,
  );
  const used = blasts.reduce((sum, blast) => {
    const delivered = Number(blast.delivered);
    if (Number.isFinite(delivered) && delivered > 0) {
      return sum + delivered;
    }
    const recipients = Number(blast.recipients);
    return sum + (Number.isFinite(recipients) ? recipients : 0);
  }, 0);

  return { sendingLimit, used };
}

export async function launchCampaignBlast(input: {
  projectId: ObjectId;
  campaign: DripCampaign;
  mode: "now" | "later";
  scheduledFor?: string;
  origin: string;
}) {
  const { projectId, campaign, mode } = input;
  if (!campaign.senderId || !campaign.senderEmail) {
    throw new Error("Select a sender first.");
  }
  const oneOne = isOneOneCampaign(campaign);
  const sequences = oneOne ? campaignSequences(campaign) : [];
  if (oneOne) {
    if (!sequencesReady(campaign)) {
      throw new Error("Add a subject and design for every sequence first.");
    }
  } else {
    if (!campaign.subject?.trim()) {
      throw new Error("Add a subject line first.");
    }
    if (!campaign.designHtml?.trim()) {
      throw new Error("Save an email design first.");
    }
  }

  const firstSequence = sequences[0];
  const blastSubject = firstSequence?.subject?.trim() || campaign.subject || "";
  const blastHtml = firstSequence?.designHtml?.trim() || campaign.designHtml || "";

  const recipients = await resolveRecipients(projectId, campaign);
  const unique = new Map(recipients.map((item) => [item.email, item]));
  const suppressed = await getSuppressionSets(projectId);
  const list = [...unique.values()].filter(
    (item) => !isSuppressedAddress(item.email, suppressed),
  );
  if (list.length === 0) {
    throw new Error("This campaign has no recipients to send to.");
  }

  const { sendingLimit, used } = await getProjectSendingQuota(projectId);
  const remaining = Math.max(0, sendingLimit - used);
  if (list.length > remaining) {
    throw new Error(
      `Sending limit reached. This campaign needs ${list.length.toLocaleString()} emails, but only ${remaining.toLocaleString()} remain of ${sendingLimit.toLocaleString()}.`,
    );
  }

  const db = await getDb();
  const now = new Date();
  const scheduledFor =
    mode === "later" && input.scheduledFor ? new Date(input.scheduledFor) : undefined;
  if (mode === "later" && (!scheduledFor || Number.isNaN(scheduledFor.getTime()))) {
    throw new Error("Pick a valid schedule date and time.");
  }
  if (mode === "later" && scheduledFor && scheduledFor.getTime() <= now.getTime()) {
    throw new Error("Schedule time must be in the future.");
  }

  let listDisplayId: number | undefined;
  if (campaign.listId && ObjectId.isValid(campaign.listId)) {
    const listDoc = await db.collection<ListDoc>("lists").findOne({
      _id: new ObjectId(campaign.listId),
      projectId,
    });
    listDisplayId = listDoc?.displayId;
  }

  const timezone = campaign.timezone || "Asia/Kolkata";
  const timeline: BlastTimelineEvent[] = [];
  if (mode === "later" && scheduledFor) {
    timeline.push({
      id: randomBytes(6).toString("hex"),
      type: "scheduled",
      title: "Scheduled",
      description: `The campaign [${campaign.id}] ${campaign.name} has been scheduled for ${formatCampaignClock(scheduledFor, timezone)}.`,
      at: now.toISOString(),
    });
  }
  timeline.push({
    id: randomBytes(6).toString("hex"),
    type: "draft",
    title: "Draft",
    description: `The campaign [${campaign.id}] ${campaign.name} has been launched.`,
    at: now.toISOString(),
  });

  const blast: CampaignBlastDoc = {
    _id: new ObjectId(),
    projectId,
    campaignId: campaign.id,
    name: campaign.name,
    subject: blastSubject,
    previewText: firstSequence?.previewText || campaign.previewText,
    html: blastHtml,
    senderId: campaign.senderId,
    senderName: campaign.senderName,
    senderEmail: campaign.senderEmail,
    replyTo: campaign.replyToEnabled ? campaign.replyToEmail : undefined,
    listId: campaign.listId,
    listName: campaign.listName,
    listDisplayId,
    timezone,
    status: mode === "later" ? "scheduled" : "sending",
    scheduledFor,
    recipients: list.length,
    delivered: 0,
    opens: 0,
    clicks: 0,
    unsubscribed: 0,
    conversions: 0,
    bounces: 0,
    replies: 0,
    timeline,
    createdAt: now,
    updatedAt: now,
    ...(oneOne
      ? {
          kind: "oneone" as const,
          sequences,
          windowStart: campaign.windowStart || "09:00",
          windowEnd: campaign.windowEnd || "18:00",
          emailGapMinutes: Math.max(0, Number(campaign.emailGapMinutes) || 0),
        }
      : { kind: "drip" as const }),
    ...(campaign.utmEnabled
      ? {
          utmEnabled: true,
          utmSourceEnabled: campaign.utmSourceEnabled !== false,
          utmSource: campaign.utmSource,
          utmMediumEnabled: campaign.utmMediumEnabled !== false,
          utmMedium: campaign.utmMedium,
          utmCampaignEnabled: campaign.utmCampaignEnabled !== false,
          utmCampaign: campaign.utmCampaign,
        }
      : {}),
  };

  const kindFilter = oneOne
    ? { kind: "oneone" as const }
    : { kind: { $ne: "oneone" as const } };
  const previousBlasts = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({ projectId, campaignId: campaign.id, ...kindFilter })
    .project({ _id: 1 })
    .toArray();
  const previousIds = previousBlasts.map((item) => item._id);
  if (previousIds.length > 0) {
    await db.collection<CampaignSendDoc>("campaign_sends").deleteMany({
      blastId: { $in: previousIds },
    });
    await db.collection<CampaignBlastDoc>("campaign_blasts").deleteMany({
      _id: { $in: previousIds },
    });
  }
  await db.collection<CampaignBlastDoc>("campaign_blasts").insertOne(blast);
  const saved = blast;

  await db.collection<CampaignSendDoc>("campaign_sends").insertMany(
    oneOne
      ? list.flatMap((contact) =>
          sequences.map((sequence, sequenceIndex) => ({
            _id: new ObjectId(),
            projectId,
            blastId: saved._id,
            campaignId: campaign.id,
            email: contact.email,
            fullName: contact.fullName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            companyName: contact.companyName,
            token: randomBytes(18).toString("hex"),
            status: "pending" as const,
            openCount: 0,
            clickCount: 0,
            sequenceId: sequence.id,
            sequenceIndex,
            availableAt:
              sequenceIndex === 0 ? scheduledFor ?? now : LOCKED_SEQUENCE_AT,
          })),
        )
      : list.map((contact) => ({
          _id: new ObjectId(),
          projectId,
          blastId: saved._id,
          campaignId: campaign.id,
          email: contact.email,
          fullName: contact.fullName,
          firstName: contact.firstName,
          lastName: contact.lastName,
          companyName: contact.companyName,
          token: randomBytes(18).toString("hex"),
          status: "pending" as const,
          openCount: 0,
          clickCount: 0,
        })),
  );

  let latest = saved;
  if (mode === "now") {
    latest = (await sendPendingBatch(saved)) ?? { ...saved, status: "sending" as const };
  }

  const [report] = await reportsFromBlasts([latest]);
  return report;
}

export async function processDueCampaignBlasts(
  projectId: ObjectId,
  origin: string,
) {
  const db = await getDb();
  const now = new Date();
  const due = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({
      projectId,
      $or: [
        { status: "sending" },
        { status: "scheduled", scheduledFor: { $lte: now } },
      ],
    })
    .toArray();

  const reports: CampaignReport[] = [];
  for (const blast of due) {
    if (blast.status === "scheduled") {
      await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
        { _id: blast._id },
        { $set: { status: "sending", updatedAt: now } },
      );
      blast.status = "sending";
    }
    const latest = (await sendPendingBatch(blast)) ?? blast;
    reports.push(...(await reportsFromBlasts([latest])));
  }

  const rest = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({
      projectId,
      _id: { $nin: due.map((blast) => blast._id) },
    })
    .toArray();

  return [...reports, ...(await reportsFromBlasts(rest))];
}

export async function pauseCampaignBlast(
  projectId: ObjectId,
  campaignId: string,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  const blast = await findBlastForCampaign(projectId, campaignId, kind);
  if (!blast) {
    return false;
  }
  if (blast.status === "paused") {
    return true;
  }
  if (blast.status !== "sending" && blast.status !== "scheduled") {
    return false;
  }

  const result = await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
    { _id: blast._id },
    {
      $set: {
        status: "paused",
        updatedAt: new Date(),
        ...(kind === "oneone" && blast.kind !== "oneone" ? { kind: "oneone" } : {}),
      },
    },
  );
  return result.matchedCount > 0;
}

export async function resumeCampaignBlast(
  projectId: ObjectId,
  campaignId: string,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  const blast = await findBlastForCampaign(projectId, campaignId, kind);
  if (!blast) {
    return null;
  }

  if (blast.status === "sent") {
    return "sent" as const;
  }

  if (blast.status === "sending" || blast.status === "scheduled") {
    // Already active (e.g. drip/blast status desync) — treat as resumed
    return blast.status;
  }

  if (blast.status !== "paused") {
    return null;
  }

  const now = new Date();
  const nextStatus: BlastStatus =
    blast.scheduledFor && blast.scheduledFor.getTime() > now.getTime()
      ? "scheduled"
      : "sending";

  await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
    { _id: blast._id },
    {
      $set: {
        status: nextStatus,
        updatedAt: now,
        ...(kind === "oneone" && blast.kind !== "oneone" ? { kind: "oneone" } : {}),
      },
    },
  );

  return nextStatus;
}

export async function getProjectCampaignReports(projectId: ObjectId) {
  const db = await getDb();
  const docs = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({ projectId })
    .toArray();
  return reportsFromBlasts(docs);
}

export async function getCampaignReport(
  projectId: ObjectId,
  campaignId: string,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  const doc = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    projectId,
    campaignId,
    ...blastKindFilter(kind),
  });
  if (!doc) {
    return null;
  }
  const refreshed = (await refreshBlastCounts(doc._id)) ?? doc;
  const [report] = await reportsFromBlasts([refreshed]);
  return report;
}

/** Ignore open beacons in the first 25s after send (filters most bots). */
export const OPEN_BOT_GRACE_MS = 25_000;
/** Ignore click beacons in the first 45s after send (filters most bots). */
export const CLICK_BOT_GRACE_MS = 45_000;
/** Ignore counted clicks closer together than this (link scanners). */
export const CLICK_MIN_GAP_MS = 2_000;
/** Window used to detect multi-link burst scanning. */
export const CLICK_BURST_WINDOW_MS = 5_000;
/** Distinct URLs clicked inside the burst window → treat as bot burst. */
export const CLICK_BURST_DISTINCT_URLS = 2;

function asTimeMs(value: Date | string | undefined) {
  if (!value) {
    return NaN;
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function isWithinBotGracePeriod(
  send: Pick<CampaignSendDoc, "sentAt" | "status">,
  graceMs: number,
) {
  if (send.status !== "sent" || !send.sentAt) {
    return true;
  }
  const sentAt = asTimeMs(send.sentAt);
  if (!Number.isFinite(sentAt)) {
    return true;
  }
  return Date.now() - sentAt < graceMs;
}

async function getProjectEngagementFlags(projectId: ObjectId) {
  const db = await getDb();
  const project = await db.collection("projects").findOne(
    { _id: projectId },
    { projection: { instantOpen: 1, instantClick: 1, instantOpenClick: 1 } },
  );
  const legacyBoth = Boolean(project?.instantOpenClick);
  return {
    skipOpenGrace:
      typeof project?.instantOpen === "boolean"
        ? Boolean(project.instantOpen)
        : legacyBoth,
    skipClickGrace:
      typeof project?.instantClick === "boolean"
        ? Boolean(project.instantClick)
        : legacyBoth,
  };
}

function normalizeClickUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString().toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Link-safety bots often hit every URL in the email within a few seconds.
 * Returns whether this click should be ignored for metrics (redirect still happens).
 */
function detectClickBurst(input: {
  events: Array<{ url: string; at: Date | string }>;
  now: Date;
  nextUrl: string;
}): { ignore: boolean; revokeCountedClick: boolean } {
  const nowMs = input.now.getTime();
  const nextNorm = normalizeClickUrl(input.nextUrl);
  const withNext = [
    ...input.events.map((event) => ({
      url: normalizeClickUrl(event.url),
      at: asTimeMs(event.at),
    })),
    { url: nextNorm, at: nowMs },
  ].filter((event) => Number.isFinite(event.at));

  const windowStart = nowMs - CLICK_BURST_WINDOW_MS;
  const inWindow = withNext.filter((event) => event.at >= windowStart);
  const distinct = new Set(inWindow.map((event) => event.url).filter(Boolean));
  if (distinct.size >= CLICK_BURST_DISTINCT_URLS || inWindow.length >= 3) {
    return { ignore: true, revokeCountedClick: true };
  }

  const lastPrior = withNext.length >= 2 ? withNext[withNext.length - 2] : null;
  if (lastPrior && nowMs - lastPrior.at < CLICK_MIN_GAP_MS) {
    return { ignore: true, revokeCountedClick: false };
  }

  return { ignore: false, revokeCountedClick: false };
}

export async function recordCampaignOpen(token: string) {
  const db = await getDb();
  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
  if (!send) {
    return;
  }
  const { skipOpenGrace } = await getProjectEngagementFlags(send.projectId);
  if (!skipOpenGrace && isWithinBotGracePeriod(send, OPEN_BOT_GRACE_MS)) {
    return;
  }

  const firstOpen = !send.openedAt;
  await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
    { _id: send._id },
    {
      $inc: { openCount: 1 },
      $set: { openedAt: send.openedAt ?? new Date() },
    },
  );
  if (firstOpen) {
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: send.blastId },
      { $inc: { opens: 1 }, $set: { updatedAt: new Date() } },
    );
    const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
      _id: send.blastId,
    });
    emitWebhookEventBackground({
      projectId: send.projectId,
      type: "send.opened",
      data: {
        campaignId: send.campaignId,
        kind: blast?.kind === "oneone" ? "oneone" : "drip",
        name: blast?.name,
        email: send.email,
        fullName: send.fullName,
        sendId: send._id.toString(),
        sequenceIndex: send.sequenceIndex,
      },
    });
  }
}

export async function getCampaignSendByToken(token: string) {
  const db = await getDb();
  return db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
}

export async function recordCampaignClick(token: string, url?: string) {
  const db = await getDb();
  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
  if (!send) {
    return;
  }
  const { skipClickGrace } = await getProjectEngagementFlags(send.projectId);
  if (!skipClickGrace && isWithinBotGracePeriod(send, CLICK_BOT_GRACE_MS)) {
    return;
  }

  const now = new Date();
  const clickedUrl = String(url ?? "").trim();
  if (clickedUrl && isNonNavigationalTrackedUrl(clickedUrl)) {
    return;
  }

  // Already flagged as burst — keep redirect, never count again.
  if (send.clickBurstIgnored) {
    if (clickedUrl) {
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        {
          $push: {
            clickEvents: { url: clickedUrl, at: now, ignored: true },
          },
        },
      );
    }
    return;
  }

  const burst = detectClickBurst({
    events: send.clickEvents ?? [],
    now,
    nextUrl: clickedUrl,
  });

  if (burst.ignore) {
    const update: Record<string, unknown> = {};
    if (clickedUrl) {
      update.$push = {
        clickEvents: {
          url: clickedUrl,
          at: now,
          ignored: true,
        },
      };
    }
    if (burst.revokeCountedClick && send.clickedAt) {
      update.$unset = { clickedAt: "", clickedUrl: "" };
      update.$set = {
        clickBurstIgnored: true,
        clickCount: 0,
      };
    } else if (burst.revokeCountedClick) {
      update.$set = { clickBurstIgnored: true };
    }

    if (Object.keys(update).length > 0) {
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        update,
      );
    }

    if (burst.revokeCountedClick && send.clickedAt) {
      await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
        { _id: send.blastId, clicks: { $gt: 0 } },
        { $inc: { clicks: -1 }, $set: { updatedAt: now } },
      );
    }
    return;
  }

  const firstClick = !send.clickedAt;
  await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
    { _id: send._id },
    {
      $inc: { clickCount: 1 },
      $set: {
        clickedAt: send.clickedAt ?? now,
        ...(clickedUrl && !send.clickedUrl ? { clickedUrl } : {}),
      },
      ...(clickedUrl
        ? { $push: { clickEvents: { url: clickedUrl, at: now } } }
        : {}),
    },
  );
  if (firstClick) {
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: send.blastId },
      { $inc: { clicks: 1 }, $set: { updatedAt: now } },
    );
    const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
      _id: send.blastId,
    });
    emitWebhookEventBackground({
      projectId: send.projectId,
      type: "send.clicked",
      data: {
        campaignId: send.campaignId,
        kind: blast?.kind === "oneone" ? "oneone" : "drip",
        name: blast?.name,
        email: send.email,
        fullName: send.fullName,
        sendId: send._id.toString(),
        url: clickedUrl || send.clickedUrl || undefined,
        sequenceIndex: send.sequenceIndex,
      },
    });
  }
}

export function requestOrigin(requestUrl: string, headers: Headers) {
  const host = headers.get("x-forwarded-host") || headers.get("host");
  const proto = headers.get("x-forwarded-proto") || "http";
  if (host) {
    return `${proto}://${host}`;
  }
  return new URL(requestUrl).origin;
}

export type CampaignRecipientFilter =
  | "delivered"
  | "opens"
  | "clicks"
  | "bounces"
  | "replies"
  | "unsubscribes"
  | "audience";

export type CampaignSendRecipient = {
  id: string;
  email: string;
  fullName: string;
  companyName: string;
  contactId?: string;
  status: CampaignSendDoc["status"];
  error?: string;
  sentAt?: string;
  openedAt?: string;
  clickedAt?: string;
  clickedUrl?: string;
  unsubscribedAt?: string;
  repliedAt?: string;
  sequenceIndex?: number;
  sequenceNumber?: number;
};

const RECIPIENT_FILTERS: CampaignRecipientFilter[] = [
  "delivered",
  "opens",
  "clicks",
  "bounces",
  "replies",
  "unsubscribes",
  "audience",
];

export function isCampaignRecipientFilter(
  value: string,
): value is CampaignRecipientFilter {
  return RECIPIENT_FILTERS.includes(value as CampaignRecipientFilter);
}

export async function listCampaignSendRecipients(
  projectId: ObjectId,
  campaignId: string,
  filter: CampaignRecipientFilter,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    projectId,
    campaignId,
    ...blastKindFilter(kind),
  });
  const query: Record<string, unknown> = blast
    ? { projectId, blastId: blast._id }
    : { projectId, campaignId };

  if (filter === "delivered") {
    query.status = "sent";
    query.bouncedAt = { $exists: false };
  } else if (filter === "opens") {
    query.openCount = { $gt: 0 };
  } else if (filter === "clicks") {
    query.clickCount = { $gt: 0 };
  } else if (filter === "bounces") {
    query.$or = [
      { bouncedAt: { $exists: true } },
      {
        status: "failed",
        error: { $nin: ["Unsubscribed", "Suppressed", "Replied"] },
      },
    ];
  } else if (filter === "replies") {
    query.repliedAt = { $exists: true };
  } else if (filter === "unsubscribes") {
    query.unsubscribedAt = { $exists: true, $ne: null };
  }

  const docs = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find(query)
    .sort({ fullName: 1, email: 1 })
    .toArray();

  const emails = [...new Set(docs.map((doc) => doc.email.trim().toLowerCase()).filter(Boolean))];
  const contacts =
    emails.length === 0
      ? []
      : await db
          .collection<ContactDoc>("contacts")
          .find({
            projectId,
            $expr: { $in: [{ $toLower: "$email" }, emails] },
          })
          .project({ _id: 1, email: 1 })
          .toArray();

  const contactIdsByEmail = new Map(
    contacts.map((contact) => [contact.email.trim().toLowerCase(), contact._id.toString()]),
  );

  function mapRecipient(
    doc: CampaignSendDoc,
    extra?: Partial<CampaignSendRecipient>,
  ): CampaignSendRecipient {
    const email = doc.email.trim().toLowerCase();
    const sequenceIndex =
      typeof doc.sequenceIndex === "number" ? doc.sequenceIndex : undefined;
    return {
      id: extra?.id ?? doc._id.toString(),
      email: doc.email,
      fullName: doc.fullName || doc.email,
      companyName: doc.companyName || "",
      contactId: contactIdsByEmail.get(email),
      status: doc.status,
      error: doc.error || "",
      sentAt: doc.sentAt?.toISOString(),
      openedAt: doc.openedAt?.toISOString(),
      clickedAt: doc.clickedAt?.toISOString(),
      clickedUrl: doc.clickedUrl || "",
      unsubscribedAt: doc.unsubscribedAt?.toISOString(),
      repliedAt: doc.repliedAt?.toISOString(),
      sequenceIndex,
      sequenceNumber:
        typeof sequenceIndex === "number" ? sequenceIndex + 1 : undefined,
      ...extra,
    };
  }

  if (filter === "clicks") {
    return docs.flatMap((doc) => {
      const events =
        doc.clickEvents && doc.clickEvents.length > 0
          ? doc.clickEvents
          : doc.clickedAt
            ? [{ url: doc.clickedUrl || "", at: doc.clickedAt }]
            : [];

      return events
        .filter((event) => isCountableClickEvent(event))
        .slice()
        .sort((left, right) => {
          const leftAt = left.at instanceof Date ? left.at.getTime() : new Date(left.at).getTime();
          const rightAt = right.at instanceof Date ? right.at.getTime() : new Date(right.at).getTime();
          return rightAt - leftAt;
        })
        .map((event, index) =>
          mapRecipient(doc, {
            id: `${doc._id.toString()}-${index}`,
            clickedAt: (event.at instanceof Date
              ? event.at
              : new Date(event.at)
            ).toISOString(),
            clickedUrl: event.url || doc.clickedUrl || "",
          }),
        );
    });
  }

  // One row per email for bounces (1-1 can create multiple failed sequence rows)
  if (filter === "bounces") {
    const seen = new Set<string>();
    const unique: CampaignSendDoc[] = [];
    for (const doc of docs) {
      const key = doc.email.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(doc);
    }
    return unique.map((doc) => mapRecipient(doc));
  }

  return docs.map((doc) => mapRecipient(doc));
}

export async function listCampaignSendsForExport(
  projectId: ObjectId,
  campaignId: string,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    projectId,
    campaignId,
    ...blastKindFilter(kind),
  });
  return db
    .collection<CampaignSendDoc>("campaign_sends")
    .find(blast ? { projectId, blastId: blast._id } : { projectId, campaignId })
    .sort({ fullName: 1, email: 1 })
    .toArray();
}
