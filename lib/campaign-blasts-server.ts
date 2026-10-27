import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc, ListDoc, ListMembershipDoc } from "@/lib/crm";
import {
  campaignCcList,
  campaignSequences,
  formatCampaignClock,
  isOneOneCampaign,
  sequencesReady,
  type CampaignSequence,
  type CampaignSequenceProgress,
  type DripCampaign,
  type SequenceReportStats,
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
import { formatSenderDisplayName } from "@/lib/mxtoolbox";
import {
  normalizeStoredMessageId,
  refreshSenderRepliesIfStale,
} from "@/lib/master-inbox-server";
import { applyContactVariables } from "@/lib/email-variables";
import { emitWebhookEventBackground } from "@/lib/webhooks-server";
import type { EngagementClientMeta } from "@/lib/engagement-client-meta";
import {
  OPEN_PIXEL_BLOCKED_TAG,
  sendCountsAsOpen,
  sendOpenPixelBlocked,
} from "@/lib/open-pixel";
import { BOT_CLICK_TAG, clickEventIsBot, sendIsBotClick } from "@/lib/bot-click";
import { BOT_OPEN_TAG, sendIsBotOnlyOpen, sendIsBotOpen } from "@/lib/bot-open";
import {
  GMAIL_DAILY_LIMIT_DEFAULT,
  isGmailOrOutlookProvider,
  normalizeGmailDailyLimit,
  type SenderDoc,
} from "@/lib/smtp-senders";
import {
  followUpAvailableAt,
  loadUsualOpenMinutes,
  snapToUsualOpenTime,
} from "@/lib/schedule-by-open-time";

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
  /** CC'd on every email in the campaign. */
  cc?: string[];
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
  sendStartDay?: number;
  sendEndDay?: number;
  emailGapMinutes?: number;
  sendLockUntil?: Date;
  utmEnabled?: boolean;
  utmSourceEnabled?: boolean;
  utmSource?: string;
  utmMediumEnabled?: boolean;
  utmMedium?: string;
  utmCampaignEnabled?: boolean;
  utmCampaign?: string;
  openTrackingOff?: boolean;
  clickTrackingOff?: boolean;
  /** When true, snap each contact’s availableAt to their usual open time. */
  scheduleByOpenTime?: boolean;
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
  /** First counted open client hints. */
  openedIp?: string;
  openedDevice?: "mobile" | "tablet" | "desktop" | "unknown";
  openedUserAgent?: string;
  openEvents?: Array<{
    at: Date;
    ip?: string;
    userAgent?: string;
    device?: "mobile" | "tablet" | "desktop" | "unknown";
    /** Open was inferred from a click (tracking pixel never loaded). */
    inferredFromClick?: boolean;
    /** Counted but tagged as bot (within post-send grace). */
    bot?: boolean;
  }>;
  /**
   * True when the open was counted because the contact clicked a link
   * but the open tracking pixel never fired (images blocked).
   */
  openPixelBlocked?: boolean;
  /**
   * Instant-open projects: first counted open was within bot grace
   * and should show the Bot open tag.
   */
  botOpen?: boolean;
  clickedAt?: Date;
  clickedUrl?: string;
  /** First counted click client hints. */
  clickedIp?: string;
  clickedDevice?: "mobile" | "tablet" | "desktop" | "unknown";
  clickedUserAgent?: string;
  clickEvents?: Array<{
    url: string;
    at: Date;
    ignored?: boolean;
    /** Instant-click projects: counted but tagged as bot (grace/burst). */
    bot?: boolean;
    ip?: string;
    userAgent?: string;
    device?: "mobile" | "tablet" | "desktop" | "unknown";
  }>;
  clickCount: number;
  /** True when multi-link burst scanning was detected for this send. */
  clickBurstIgnored?: boolean;
  /**
   * Instant-click projects: send has at least one counted bot/scanner click
   * (within grace or burst) that should show the Bot click tag.
   */
  botClick?: boolean;
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
  /** Personalised subject. An empty string stays on the previous thread. */
  subjectLine?: string;
  /** Personalised HTML. When set, this send does not use the shared sequence design. */
  htmlBody?: string;
  /** Days after the previous step before this send. Overrides the shared sequence delay. */
  stepDelayDays?: number;
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
  sequenceReports?: SequenceReportStats[];
};

const SEND_BATCH = 25;
/** Resend default is 10 req/sec; stay under that with headroom for other API calls. */
const RESEND_SEND_BATCH = 8;
const RESEND_MIN_GAP_MS = 150;
const LOCKED_SEQUENCE_AT = new Date("2099-01-01T00:00:00.000Z");

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isResendRateLimitError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("rate_limit_exceeded") ||
    lower.includes("too many requests") ||
    (lower.includes("429") && lower.includes("rate"))
  );
}

async function campaignSenderProvider(projectId: ObjectId, senderId: string) {
  if (!ObjectId.isValid(senderId)) {
    return null;
  }
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne(
    { _id: new ObjectId(senderId), projectId },
    { projection: { provider: 1 } },
  );
  return sender?.provider ?? null;
}

async function isResendCampaignSender(projectId: ObjectId, senderId: string) {
  return (await campaignSenderProvider(projectId, senderId)) === "resend";
}

/** Turn an email local part saved as a name ("greta.h") into "Greta H". */
function readableSenderName(name?: string) {
  const trimmed = name?.trim();
  if (!trimmed || !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(trimmed)) {
    return trimmed || undefined;
  }
  return formatSenderDisplayName(`${trimmed}@x`).replace(/\s*<.*$/, "");
}

let marketingIndexesPromise: Promise<void> | null = null;

export async function ensureMarketingQueryIndexes() {
  if (!marketingIndexesPromise) {
    marketingIndexesPromise = (async () => {
      const db = await getDb();
      await Promise.all([
        db.collection("campaign_blasts").createIndex(
          { projectId: 1, status: 1, scheduledFor: 1 },
          { name: "blasts_project_status_scheduled", background: true },
        ),
        db.collection("campaign_blasts").createIndex(
          { projectId: 1, campaignId: 1, kind: 1 },
          { name: "blasts_project_campaign_kind", background: true },
        ),
        db.collection("drip_campaigns").createIndex(
          { projectId: 1, kind: 1, createdAt: -1 },
          { name: "drip_project_kind_created", background: true },
        ),
        db.collection("drip_campaigns").createIndex(
          { projectId: 1, campaignId: 1, kind: 1 },
          { name: "drip_project_campaign_kind", background: true },
        ),
        db.collection("automations").createIndex(
          { projectId: 1, updatedAt: -1 },
          { name: "automations_project_updated", background: true },
        ),
      ]);
    })().catch((error) => {
      marketingIndexesPromise = null;
      console.error("Failed to ensure marketing indexes:", error);
    });
  }
  await marketingIndexesPromise;
}

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
    // Kind-scoped only — never fall back across drip ↔ 1-1 (IDs can collide).
    return db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
      projectId,
      campaignId,
      ...blastKindFilter(kind),
    });
  }
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

function weekdayInTimeZone(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name.slice(0, 3));
  return index < 0 ? 0 : index;
}

function isAllowedSendDay(
  date: Date,
  timeZone: string,
  startDay?: number,
  endDay?: number,
) {
  if (!Number.isInteger(startDay) || !Number.isInteger(endDay)) {
    return true;
  }
  if ((startDay as number) < 0 || (startDay as number) > 6 || (endDay as number) < 0 || (endDay as number) > 6) {
    return true;
  }
  const day = weekdayInTimeZone(date, timeZone);
  if ((startDay as number) <= (endDay as number)) {
    return day >= (startDay as number) && day <= (endDay as number);
  }
  return day >= (startDay as number) || day <= (endDay as number);
}

function isWithinSendWindow(
  date: Date,
  timeZone: string,
  windowStart?: string,
  windowEnd?: string,
  startDay?: number,
  endDay?: number,
) {
  if (!isAllowedSendDay(date, timeZone, startDay, endDay)) {
    return false;
  }
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

function explicitDelayDays(value: number | undefined, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return Math.max(0, fallback);
}

function sequenceContent(blast: CampaignBlastDoc, send: CampaignSendDoc) {
  if (send.htmlBody?.trim()) {
    return {
      subject: send.subjectLine?.trim() || blast.subject,
      html: send.htmlBody,
    };
  }
  const sequence =
    blast.sequences?.find((item) => item.id === send.sequenceId) ??
    (typeof send.sequenceIndex === "number" ? blast.sequences?.[send.sequenceIndex] : undefined);
  return {
    subject: sequence?.subject?.trim() || blast.subject,
    html: sequence?.designHtml?.trim() || blast.html,
  };
}

function replySubject(subject: string) {
  const trimmed = subject.trim();
  if (!trimmed) {
    return "Re:";
  }
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Follow-up with no subject stays in the previous thread. A subject starts a new one. */
async function resolveOneOneOutbound(blast: CampaignBlastDoc, send: CampaignSendDoc) {
  const index = typeof send.sequenceIndex === "number" ? send.sequenceIndex : 0;
  const sequences = blast.sequences ?? [];
  const personalised = typeof send.subjectLine === "string";
  const subjectLine = send.subjectLine;
  const ownSubject =
    typeof subjectLine === "string"
      ? subjectLine.trim()
      : sequences[index]?.subject?.trim() || "";

  if (index === 0 || ownSubject) {
    return {
      subject: ownSubject || blast.subject,
      inReplyTo: undefined as string | undefined,
      references: undefined as string[] | undefined,
    };
  }

  const db = await getDb();
  const prior = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({
      blastId: blast._id,
      email: send.email,
      sequenceIndex: { $gte: 0, $lt: index },
      status: "sent",
    })
    .project({ sequenceIndex: 1, messageId: 1, subjectLine: 1 })
    .sort({ sequenceIndex: 1 })
    .toArray();

  let threadStart = index - 1;
  let threadSubject = sequences[threadStart]?.subject?.trim() || blast.subject;
  if (personalised) {
    threadStart = 0;
    threadSubject = blast.subject;
    for (const item of prior) {
      const line = item.subjectLine?.trim();
      if (line) {
        threadStart = typeof item.sequenceIndex === "number" ? item.sequenceIndex : 0;
        threadSubject = line;
      }
    }
  } else {
    while (threadStart > 0 && !sequences[threadStart]?.subject?.trim()) {
      threadStart -= 1;
    }
    threadSubject = sequences[threadStart]?.subject?.trim() || blast.subject;
  }

  const threaded = prior.filter(
    (item) => (item.sequenceIndex ?? 0) >= threadStart,
  );

  const references = threaded
    .map((item) => String(item.messageId ?? "").trim())
    .filter(Boolean);
  const inReplyTo = references[references.length - 1];

  return {
    subject: replySubject(threadSubject),
    inReplyTo,
    references: references.length > 0 ? references : undefined,
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

/** Mark campaign sends bounced from an SES notification and refresh blast counts. */
export async function recordSesBounce(input: {
  messageIds: string[];
  emails: string[];
  error: string;
}) {
  const messageIds = [
    ...new Set(input.messageIds.map((value) => normalizeStoredMessageId(value)).filter(Boolean)),
  ];
  const emails = [
    ...new Set(
      input.emails
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (messageIds.length === 0 && emails.length === 0) {
    return { matched: 0, updated: 0 };
  }

  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const matched: CampaignSendDoc[] = [];

  if (messageIds.length > 0) {
    matched.push(
      ...(await sends.find({ messageIdNorm: { $in: messageIds } }).toArray()),
    );
  }

  if (matched.length === 0) {
    for (const email of emails) {
      const send = await sends.findOne(
        { email, status: "sent", bouncedAt: { $exists: false } },
        { sort: { sentAt: -1 } },
      );
      if (send) {
        matched.push(send);
      }
    }
  }

  const reason = input.error.trim().slice(0, 240) || "Bounced";
  const blastIds = new Set<string>();
  let updated = 0;
  const now = new Date();

  for (const send of matched) {
    if (send.bouncedAt) {
      continue;
    }
    await sends.updateOne(
      { _id: send._id },
      {
        $set: { status: "failed", error: reason, bouncedAt: now },
        $unset: { claimedAt: "" },
      },
    );
    await failLaterSequences(send.blastId, send.email, send.sequenceIndex, "Bounced");
    blastIds.add(send.blastId.toString());
    updated += 1;
  }

  for (const id of blastIds) {
    await refreshBlastCounts(new ObjectId(id));
  }

  return { matched: matched.length, updated };
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

async function recipientsToEnroll(projectId: ObjectId, campaign: DripCampaign) {
  const merged = new Map<
    string,
    {
      email: string;
      fullName: string;
      firstName: string;
      lastName: string;
      companyName: string;
    }
  >();
  const add = (
    people: Array<{
      email: string;
      fullName: string;
      firstName: string;
      lastName: string;
      companyName: string;
    }>,
  ) => {
    for (const person of people) {
      if (person.email && !merged.has(person.email)) {
        merged.set(person.email, person);
      }
    }
  };

  if (campaign.recipientMode === "individual") {
    add(await resolveRecipients(projectId, campaign));
  } else if (campaign.listId) {
    add(await resolveRecipients(projectId, campaign));
  }

  for (const listId of campaign.addedListIds ?? []) {
    if (!listId || listId === campaign.listId) {
      continue;
    }
    add(
      await resolveRecipients(projectId, {
        ...campaign,
        recipientMode: "list",
        individualContacts: [],
        listId,
      }),
    );
  }

  return [...merged.values()];
}

async function dropPendingContactsFromRemovedLists(
  projectId: ObjectId,
  campaign: DripCampaign,
  blastId: ObjectId,
  sends: CampaignSendDoc[],
) {
  const db = await getDb();
  const existing = await db.collection<{ addedListIds?: string[] }>("drip_campaigns").findOne({
    projectId,
    campaignId: campaign.id,
    kind: "oneone",
  });
  const previousAdded = existing?.addedListIds ?? [];
  const nextAdded = new Set(campaign.addedListIds ?? []);
  const removedListIds = previousAdded.filter((id) => id && !nextAdded.has(id));
  if (removedListIds.length === 0) {
    return sends;
  }

  const keepEmails = new Set(
    (await recipientsToEnroll(projectId, campaign)).map((contact) => contact.email),
  );
  const dropEmails = new Set<string>();
  for (const listId of removedListIds) {
    const people = await resolveRecipients(projectId, {
      ...campaign,
      recipientMode: "list",
      individualContacts: [],
      listId,
    });
    for (const person of people) {
      if (person.email && !keepEmails.has(person.email)) {
        dropEmails.add(person.email);
      }
    }
  }

  const dropIds: ObjectId[] = [];
  const grouped = new Map<string, CampaignSendDoc[]>();
  for (const send of sends) {
    const email = send.email.trim().toLowerCase();
    const rows = grouped.get(email) ?? [];
    rows.push(send);
    grouped.set(email, rows);
  }
  for (const email of dropEmails) {
    const rows = grouped.get(email) ?? [];
    if (rows.length > 0 && rows.every((row) => row.status === "pending")) {
      dropIds.push(...rows.map((row) => row._id));
    }
  }
  if (dropIds.length === 0) {
    return sends;
  }

  await db.collection<CampaignSendDoc>("campaign_sends").deleteMany({
    _id: { $in: dropIds },
  });
  const dropped = new Set(dropIds.map((id) => id.toString()));
  return sends.filter((send) => !dropped.has(send._id.toString()));
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

function sendHasCountableClick(
  send: Pick<CampaignSendDoc, "clickEvents" | "clickedAt" | "clickedUrl" | "clickBurstIgnored">,
) {
  if (send.clickBurstIgnored) {
    return false;
  }
  const events = send.clickEvents ?? [];
  if (events.length > 0) {
    return events.some((event) => isCountableClickEvent(event));
  }
  if (!send.clickedAt) {
    return false;
  }
  return !isNonNavigationalTrackedUrl(send.clickedUrl ?? "");
}

export async function refreshBlastCounts(blastId: ObjectId) {
  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const [deliveredEmails, openEmails, clickDocs, bounceEmails, replyEmails, unsubEmails] =
    await Promise.all([
    sends.distinct("email", {
      blastId,
      status: "sent",
      bouncedAt: { $exists: false },
    }),
    sends.distinct("email", {
      blastId,
      $or: [
        { openCount: { $gt: 0 } },
        { openedAt: { $exists: true } },
        { openPixelBlocked: true },
        {
          clickBurstIgnored: { $ne: true },
          $or: [{ clickCount: { $gt: 0 } }, { clickedAt: { $exists: true } }],
        },
      ],
    }),
    sends
      .find({
        blastId,
        $or: [{ clickCount: { $gt: 0 } }, { clickedAt: { $exists: true } }],
      })
      .project({ email: 1, clickEvents: 1, clickedAt: 1, clickedUrl: 1, clickBurstIgnored: 1 })
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
    sends.distinct("email", {
      blastId,
      repliedAt: { $exists: true },
    }),
    sends.distinct("email", {
      blastId,
      unsubscribedAt: { $exists: true },
    }),
  ]);
  const uniqueEmailCount = (values: string[]) =>
    new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)).size;
  const clickEmails = new Set(
    clickDocs
      .filter((send) => sendHasCountableClick(send))
      .map((send) => send.email.trim().toLowerCase())
      .filter(Boolean),
  );
  const delivered = uniqueEmailCount(deliveredEmails);
  const opens = uniqueEmailCount(openEmails);
  const clicks = clickEmails.size;
  const bounces = uniqueEmailCount(bounceEmails);
  const replies = uniqueEmailCount(replyEmails);
  const unsubscribed = uniqueEmailCount(unsubEmails);

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
        unsubscribed,
        status: nextStatus,
        sentAt: nextStatus === "sent" ? blast.sentAt ?? now : blast.sentAt,
        timeline,
        updatedAt: now,
      },
    },
  );

  return db.collection<CampaignBlastDoc>("campaign_blasts").findOne({ _id: blastId });
}

/**
 * Remove campaign send rows for these emails (project-scoped) and recount
 * affected blasts so CRM-deleted contacts disappear from reports.
 */
export async function purgeCampaignEngagementForEmails(
  projectId: ObjectId,
  emails: string[],
) {
  const normalized = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes("@")),
    ),
  ];
  if (normalized.length === 0) {
    return { deletedSends: 0, blastsRefreshed: 0 };
  }

  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const matching = await sends
    .find(
      {
        projectId,
        $expr: { $in: [{ $toLower: "$email" }, normalized] },
      },
      { projection: { blastId: 1 } },
    )
    .toArray();
  if (matching.length === 0) {
    return { deletedSends: 0, blastsRefreshed: 0 };
  }

  const blastIds = [
    ...new Map(
      matching.map((send) => [send.blastId.toString(), send.blastId]),
    ).values(),
  ];

  const result = await sends.deleteMany({
    projectId,
    $expr: { $in: [{ $toLower: "$email" }, normalized] },
  });

  for (const blastId of blastIds) {
    await refreshBlastCounts(blastId);
  }

  return {
    deletedSends: result.deletedCount ?? 0,
    blastsRefreshed: blastIds.length,
  };
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
  const senderProvider = await campaignSenderProvider(blast.projectId, blast.senderId);
  // Gmail / Outlook SMTP: user adds their own unsubscribe only — never
  // auto-attach a footer unsubscribe or a List-Unsubscribe header.
  const userUnsubscribeOnly = isGmailOrOutlookProvider(senderProvider);
  const resendSender = senderProvider === "resend";
  if (resendSender) {
    limit = Math.min(limit, RESEND_SEND_BATCH);
  }
  if (
    oneOne &&
    !isWithinSendWindow(
      now,
      blast.timezone || "Asia/Kolkata",
      blast.windowStart,
      blast.windowEnd,
      blast.sendStartDay,
      blast.sendEndDay,
    )
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
      const waitingSteps = await db
        .collection<CampaignSendDoc>("campaign_sends")
        .find({
          blastId: blast._id,
          status: "pending",
          sequenceIndex: { $gt: 0 },
        })
        .project({ email: 1, sequenceIndex: 1, stepDelayDays: 1 })
        .toArray();
      const delayByStep = new Map<string, number | undefined>();
      for (const row of waitingSteps) {
        if (typeof row.sequenceIndex !== "number") {
          continue;
        }
        delayByStep.set(
          `${String(row.email ?? "").trim().toLowerCase()}|${row.sequenceIndex}`,
          row.stepDelayDays,
        );
      }
      const usualMinutes = blast.scheduleByOpenTime
        ? await loadUsualOpenMinutes(
            blast.projectId,
            sentSteps.map((row) => String(row.email ?? "")),
            blast.timezone,
          )
        : new Map<string, number>();
      for (const sent of sentSteps) {
        if (typeof sent.sequenceIndex !== "number") {
          continue;
        }
        const nextSequence = blast.sequences[sent.sequenceIndex + 1];
        if (!nextSequence) {
          continue;
        }
        const email = String(sent.email ?? "").trim().toLowerCase();
        const delayDays = explicitDelayDays(
          delayByStep.get(`${email}|${sent.sequenceIndex + 1}`),
          Number(nextSequence.delayDays) || 0,
        );
        const base = sent.sentAt instanceof Date ? sent.sentAt : now;
        const availableAt = blast.scheduleByOpenTime
          ? followUpAvailableAt(
              base,
              delayDays,
              usualMinutes.get(email),
              blast.timezone,
            )
          : new Date(base.getTime() + delayDays * 24 * 60 * 60 * 1000);
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

  if (oneOne && blast.senderId) {
    const followUpDue = await db.collection<CampaignSendDoc>("campaign_sends").findOne(
      {
        blastId: blast._id,
        status: "pending",
        sequenceIndex: { $gt: 0 },
        $or: [{ availableAt: { $exists: false } }, { availableAt: { $lte: now } }],
      },
      { projection: { _id: 1 } },
    );
    if (followUpDue) {
      await refreshSenderRepliesIfStale(blast.projectId, blast.senderId);
    }
  }

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
  let sentInBatch = 0;
  const batchUsualMinutes =
    oneOne && blast.scheduleByOpenTime
      ? await loadUsualOpenMinutes(
          blast.projectId,
          pending.map((send) => send.email),
          blast.timezone,
        )
      : new Map<string, number>();

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

    if (resendSender && sentInBatch > 0) {
      await sleep(RESEND_MIN_GAP_MS);
    }

    try {
      const content = sequenceContent(blast, send);
      const outbound = oneOne
        ? await resolveOneOneOutbound(blast, send)
        : { subject: content.subject, inReplyTo: undefined, references: undefined };
      const personalized = applyContactVariables(content.html, send, true);
      const html = injectCampaignTracking(personalized, trackingBase, send.token, {
        utm: resolveUtmConfig(blast),
        campaignName: blast.name,
        trackOpens: blast.openTrackingOff !== true,
        trackClicks: blast.clickTrackingOff !== true,
        autoUnsubscribeFooter: !userUnsubscribeOnly,
      });
      const mailResult = await sendProjectMail(blast.projectId, blast.senderId, {
        to: send.email,
        subject: applyContactVariables(outbound.subject, send, false),
        html,
        fromName: readableSenderName(blast.senderName),
        replyTo: blast.replyTo,
        cc: blast.cc,
        listUnsubscribeUrl: userUnsubscribeOnly
          ? undefined
          : `${trackingBase.replace(/\/$/, "")}/api/unsubscribe/${send.token}`,
        inReplyTo: outbound.inReplyTo,
        references: outbound.references,
      });
      const sentAt = new Date();
      lastSuccessAt = sentAt;
      sentInBatch += 1;
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
          const nextSend = await db.collection<CampaignSendDoc>("campaign_sends").findOne(
            {
              blastId: blast._id,
              email: send.email.trim().toLowerCase(),
              sequenceIndex: send.sequenceIndex + 1,
              status: "pending",
            },
            { projection: { stepDelayDays: 1 } },
          );
          const delayDays = explicitDelayDays(
            nextSend?.stepDelayDays,
            Number(nextSequence.delayDays) || 0,
          );
          const email = send.email.trim().toLowerCase();
          const availableAt = blast.scheduleByOpenTime
            ? followUpAvailableAt(
                sentAt,
                delayDays,
                batchUsualMinutes.get(email),
                blast.timezone,
              )
            : new Date(sentAt.getTime() + delayDays * 24 * 60 * 60 * 1000);
          await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
            {
              blastId: blast._id,
              email,
              sequenceIndex: send.sequenceIndex + 1,
              status: "pending",
            },
            { $set: { availableAt } },
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";

      // Resend rate limits are temporary — re-queue instead of counting as bounce.
      if (resendSender && isResendRateLimitError(message)) {
        const retryAt = new Date(Date.now() + 2_000);
        await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
          { _id: send._id },
          {
            $set: {
              status: "pending",
              availableAt: retryAt,
            },
            $unset: { claimedAt: "", error: "" },
          },
        );
        // Put remaining claimed rows back so this tick stops hammering Resend.
        const remainingIds = pending
          .slice(pending.indexOf(send) + 1)
          .map((item) => item._id);
        if (remainingIds.length > 0) {
          await db.collection<CampaignSendDoc>("campaign_sends").updateMany(
            { _id: { $in: remainingIds }, status: "sending" },
            {
              $set: { status: "pending", availableAt: retryAt },
              $unset: { claimedAt: "" },
            },
          );
        }
        break;
      }

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

export async function assertProjectRecipientQuota(projectId: ObjectId, needed: number) {
  const { sendingLimit, used } = await getProjectSendingQuota(projectId);
  const remaining = Math.max(0, sendingLimit - used);
  if (needed > remaining) {
    throw new Error(
      `Sending limit reached. This campaign needs ${needed.toLocaleString()} emails, but only ${remaining.toLocaleString()} remain of ${sendingLimit.toLocaleString()}.`,
    );
  }
}

export async function dispatchBlastNow(blastId: ObjectId) {
  const db = await getDb();
  const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    _id: blastId,
  });
  if (!blast || blast.status !== "sending") {
    return blast;
  }
  return sendPendingBatch(blast);
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
      throw new Error(
        "Add a subject on the first sequence and a design for every sequence first.",
      );
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

  const recipients = await recipientsToEnroll(projectId, campaign);
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
  if (oneOne) {
    if (!ObjectId.isValid(campaign.senderId)) {
      throw new Error("Select a sender.");
    }
    const sender = await db.collection("smtp_senders").findOne({
      _id: new ObjectId(campaign.senderId),
      projectId,
    });
    if (!sender) {
      throw new Error("Select a sender.");
    }
  }
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
    cc: campaignCcList(campaign),
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
          ...(Number.isInteger(campaign.sendStartDay) ? { sendStartDay: campaign.sendStartDay } : {}),
          ...(Number.isInteger(campaign.sendEndDay) ? { sendEndDay: campaign.sendEndDay } : {}),
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
    ...(campaign.openTrackingOff ? { openTrackingOff: true } : {}),
    ...(campaign.clickTrackingOff ? { clickTrackingOff: true } : {}),
    ...(campaign.scheduleByOpenTime ? { scheduleByOpenTime: true } : {}),
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

  const baseAvailableAt = scheduledFor ?? now;
  const usualMinutes = campaign.scheduleByOpenTime
    ? await loadUsualOpenMinutes(
        projectId,
        list.map((contact) => contact.email),
        timezone,
      )
    : new Map<string, number>();

  await db.collection<CampaignSendDoc>("campaign_sends").insertMany(
    oneOne
      ? list.flatMap((contact) =>
          sequences.map((sequence, sequenceIndex) => {
            const email = contact.email.trim().toLowerCase();
            const firstAt = campaign.scheduleByOpenTime
              ? snapToUsualOpenTime(
                  baseAvailableAt,
                  usualMinutes.get(email),
                  timezone,
                )
              : baseAvailableAt;
            return {
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
              availableAt: sequenceIndex === 0 ? firstAt : LOCKED_SEQUENCE_AT,
            };
          }),
        )
      : list.map((contact) => {
          const email = contact.email.trim().toLowerCase();
          const row: CampaignSendDoc = {
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
          };
          if (campaign.scheduleByOpenTime) {
            row.availableAt = snapToUsualOpenTime(
              baseAvailableAt,
              usualMinutes.get(email),
              timezone,
            );
          }
          return row;
        }),
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
  options?: { maxBatchesPerBlast?: number },
) {
  void origin;
  const db = await getDb();
  const now = new Date();
  const maxBatches = Math.max(
    1,
    Math.min(20, Math.floor(options?.maxBatchesPerBlast ?? 1)),
  );
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
    let latest: CampaignBlastDoc = blast;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const next = (await sendPendingBatch(latest)) ?? latest;
      latest = next;
      if (latest.status !== "sending") {
        break;
      }
      const pendingDue = await db
        .collection<CampaignSendDoc>("campaign_sends")
        .countDocuments({
          blastId: latest._id,
          status: { $in: ["pending", "sending"] },
          $or: [{ availableAt: { $exists: false } }, { availableAt: { $lte: new Date() } }],
        });
      if (pendingDue === 0) {
        break;
      }
    }
    reports.push(...(await reportsFromBlasts([latest])));
  }

  // Only return blasts that were processed — callers refresh lists separately.
  // Avoid reloading every project blast (including full HTML) on each tick.
  return reports;
}

const BLAST_LIST_PROJECTION = {
  html: 0,
} as const;

export async function getProjectCampaignReports(
  projectId: ObjectId,
  kind?: "drip" | "oneone",
) {
  const db = await getDb();
  void ensureMarketingQueryIndexes();
  const docs = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find(
      { projectId, ...blastKindFilter(kind) },
      { projection: BLAST_LIST_PROJECTION },
    )
    .toArray();
  return reportsFromBlasts(
    docs.map((doc) => ({ ...doc, html: doc.html ?? "" })),
  );
}

function emptySequenceBucket() {
  return {
    recipients: new Set<string>(),
    delivered: new Set<string>(),
    opens: new Set<string>(),
    clicks: new Set<string>(),
    bounces: new Set<string>(),
    replies: new Set<string>(),
    unsubscribed: new Set<string>(),
  };
}

function isSendBounce(send: Pick<CampaignSendDoc, "status" | "bouncedAt" | "error">) {
  if (send.bouncedAt) {
    return true;
  }
  return (
    send.status === "failed" &&
    !["Unsubscribed", "Suppressed", "Replied"].includes(send.error ?? "")
  );
}

/** Unique-contact counts per sequence, plus the merged overview sets. */
async function loadOneOneSequenceReports(blastId: ObjectId): Promise<{
  sequences: SequenceReportStats[];
  overview: Omit<SequenceReportStats, "sequenceIndex">;
}> {
  const db = await getDb();
  const docs = (await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({ blastId })
    .project({
      email: 1,
      sequenceIndex: 1,
      status: 1,
      bouncedAt: 1,
      error: 1,
      openCount: 1,
      openedAt: 1,
      openPixelBlocked: 1,
      clickCount: 1,
      clickEvents: 1,
      clickedAt: 1,
      clickedUrl: 1,
      clickBurstIgnored: 1,
      repliedAt: 1,
      unsubscribedAt: 1,
    })
    .toArray()) as CampaignSendDoc[];

  const bySequence = new Map<number, ReturnType<typeof emptySequenceBucket>>();
  const overview = emptySequenceBucket();

  for (const doc of docs) {
    const email = doc.email?.trim().toLowerCase();
    if (!email) {
      continue;
    }
    if (
      doc.status === "failed" &&
      ["Replied", "Unsubscribed", "Suppressed"].includes(doc.error ?? "")
    ) {
      continue;
    }
    const index = typeof doc.sequenceIndex === "number" ? doc.sequenceIndex : 0;
    let row = bySequence.get(index);
    if (!row) {
      row = emptySequenceBucket();
      bySequence.set(index, row);
    }
    row.recipients.add(email);
    overview.recipients.add(email);
    if (doc.status === "sent" && !doc.bouncedAt) {
      row.delivered.add(email);
      overview.delivered.add(email);
    }
    if (sendCountsAsOpen(doc)) {
      row.opens.add(email);
      overview.opens.add(email);
    }
    if (sendHasCountableClick(doc)) {
      row.clicks.add(email);
      overview.clicks.add(email);
    }
    if (isSendBounce(doc)) {
      row.bounces.add(email);
      overview.bounces.add(email);
    }
    if (doc.repliedAt) {
      row.replies.add(email);
      overview.replies.add(email);
    }
    if (doc.unsubscribedAt) {
      row.unsubscribed.add(email);
      overview.unsubscribed.add(email);
    }
  }

  const sequences = [...bySequence.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([sequenceIndex, row]) => ({
      sequenceIndex,
      recipients: row.recipients.size,
      delivered: row.delivered.size,
      opens: row.opens.size,
      clicks: row.clicks.size,
      bounces: row.bounces.size,
      replies: row.replies.size,
      unsubscribed: row.unsubscribed.size,
    }));

  return {
    sequences,
    overview: {
      recipients: overview.recipients.size,
      delivered: overview.delivered.size,
      opens: overview.opens.size,
      clicks: overview.clicks.size,
      bounces: overview.bounces.size,
      replies: overview.replies.size,
      unsubscribed: overview.unsubscribed.size,
    },
  };
}

export async function getCampaignReport(
  projectId: ObjectId,
  campaignId: string,
  kind?: "drip" | "oneone",
  options?: { refresh?: boolean },
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
  const refreshed =
    options?.refresh === false ? doc : ((await refreshBlastCounts(doc._id)) ?? doc);
  const [report] = await reportsFromBlasts([refreshed]);
  if (refreshed.kind === "oneone") {
    const breakdown = await loadOneOneSequenceReports(refreshed._id);
    report.sequenceReports = breakdown.sequences;
    report.delivered = breakdown.overview.delivered;
    report.opens = breakdown.overview.opens;
    report.clicks = breakdown.overview.clicks;
    report.bounces = breakdown.overview.bounces;
    report.replies = breakdown.overview.replies;
    report.unsubscribed = breakdown.overview.unsubscribed;
    if (refreshed.clicks !== breakdown.overview.clicks) {
      await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
        { _id: refreshed._id },
        { $set: { clicks: breakdown.overview.clicks, updatedAt: new Date() } },
      );
    }
  }
  return report;
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
      },
    },
  );

  return nextStatus;
}

const LIVE_EDIT_DAY_MS = 24 * 60 * 60 * 1000;

/** Apply sender, added recipients, and sequence edits onto a paused 1-1 blast. */
export async function syncPausedOneOneBlast(
  projectId: ObjectId,
  campaign: DripCampaign,
) {
  const db = await getDb();
  const blast = await findBlastForCampaign(projectId, campaign.id, "oneone");
  if (!blast) {
    throw new Error("This paused campaign has no send to update.");
  }
  if (blast.status === "sent") {
    throw new Error("This campaign has already finished.");
  }

  const sequences = campaignSequences(campaign);
  if (sequences.length === 0) {
    throw new Error("Keep at least one sequence.");
  }

  if (campaign.senderId && campaign.senderId !== blast.senderId) {
    if (!ObjectId.isValid(campaign.senderId)) {
      throw new Error("Select a sender.");
    }
    const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
      _id: new ObjectId(campaign.senderId),
      projectId,
    });
    if (!sender) {
      throw new Error("Select a sender.");
    }
  }

  const loadedSends = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({ blastId: blast._id })
    .toArray();
  const sends = await dropPendingContactsFromRemovedLists(
    projectId,
    campaign,
    blast._id,
    loadedSends,
  );
  const previousSequences = blast.sequences ?? [];
  const nextIds = new Set(sequences.map((sequence) => sequence.id));
  const removed = previousSequences.filter((sequence) => !nextIds.has(sequence.id));

  for (const sequence of removed) {
    const started = sends.some(
      (send) => send.sequenceId === sequence.id && send.status !== "pending",
    );
    if (started) {
      const index = previousSequences.findIndex((item) => item.id === sequence.id);
      throw new Error(
        `Sequence ${index + 1} has already started and can't be removed.`,
      );
    }
  }

  const removedIds = removed.map((sequence) => sequence.id);
  if (removedIds.length > 0) {
    await db.collection<CampaignSendDoc>("campaign_sends").deleteMany({
      blastId: blast._id,
      sequenceId: { $in: removedIds },
      status: "pending",
    });
  }

  const keptSends = sends.filter(
    (send) => !send.sequenceId || !removedIds.includes(send.sequenceId),
  );

  if (sequences.length > 0) {
    await db.collection<CampaignSendDoc>("campaign_sends").bulkWrite(
      sequences.map((sequence, index) => ({
        updateMany: {
          filter: { blastId: blast._id, sequenceId: sequence.id },
          update: { $set: { sequenceIndex: index } },
        },
      })),
    );
  }

  const existingEmails = new Set(
    keptSends.map((send) => send.email.trim().toLowerCase()),
  );
  const previousIds = new Set(previousSequences.map((sequence) => sequence.id));
  const now = new Date();
  const addedSequences = sequences
    .map((sequence, index) => ({ sequence, index }))
    .filter(({ sequence }) => !previousIds.has(sequence.id));

  const sampleByEmail = new Map<string, CampaignSendDoc>();
  for (const send of keptSends) {
    const email = send.email.trim().toLowerCase();
    if (!sampleByEmail.has(email)) {
      sampleByEmail.set(email, send);
    }
  }

  const incoming = await recipientsToEnroll(projectId, campaign);
  const useOpenTime = Boolean(blast.scheduleByOpenTime || campaign.scheduleByOpenTime);
  const usualMinutes = useOpenTime
    ? await loadUsualOpenMinutes(
        projectId,
        [...sampleByEmail.keys(), ...incoming.map((contact) => contact.email)],
        blast.timezone,
      )
    : new Map<string, number>();

  const rows: CampaignSendDoc[] = [];
  for (const contact of sampleByEmail.values()) {
    const email = contact.email.trim().toLowerCase();
    for (const { sequence, index } of addedSequences) {
      rows.push(
        pendingSendRow({
          projectId,
          blast,
          campaignId: campaign.id,
          contact: {
            email,
            fullName: contact.fullName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            companyName: contact.companyName,
          },
          sequenceId: sequence.id,
          sequenceIndex: index,
          availableAt: availableAtForNewStep(
            keptSends,
            sequences,
            index,
            email,
            now,
            useOpenTime ? usualMinutes : undefined,
            blast.timezone,
          ),
        }),
      );
    }
  }

  const suppressed = await getSuppressionSets(projectId);
  const fresh = incoming.filter(
    (contact) =>
      contact.email &&
      !existingEmails.has(contact.email) &&
      !isSuppressedAddress(contact.email, suppressed),
  );
  if (fresh.length > 0) {
    const { sendingLimit, used } = await getProjectSendingQuota(projectId);
    const remaining = Math.max(0, sendingLimit - used);
    if (fresh.length > remaining) {
      throw new Error(
        `Sending limit reached. Adding this list needs ${fresh.length.toLocaleString()} more contacts, but only ${remaining.toLocaleString()} remain of ${sendingLimit.toLocaleString()}.`,
      );
    }
  }

  for (const contact of fresh) {
    const email = contact.email.trim().toLowerCase();
    for (let index = 0; index < sequences.length; index += 1) {
      const sequence = sequences[index];
      const firstAt = useOpenTime
        ? snapToUsualOpenTime(now, usualMinutes.get(email), blast.timezone)
        : now;
      rows.push(
        pendingSendRow({
          projectId,
          blast,
          campaignId: campaign.id,
          contact,
          sequenceId: sequence.id,
          sequenceIndex: index,
          availableAt: index === 0 ? firstAt : LOCKED_SEQUENCE_AT,
        }),
      );
    }
  }

  for (let offset = 0; offset < rows.length; offset += 400) {
    await db
      .collection<CampaignSendDoc>("campaign_sends")
      .insertMany(rows.slice(offset, offset + 400));
  }

  const delayWrites: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $set: { availableAt: Date; stepDelayDays?: number } };
    };
  }> = [];
  for (let index = 1; index < sequences.length; index += 1) {
    const sequence = sequences[index];
    if (!previousIds.has(sequence.id)) {
      continue;
    }
    const previous = sequences[index - 1];
    const stored = previousSequences.find((item) => item.id === sequence.id);
    const previousDelay = Math.max(0, Math.round(Number(stored?.delayDays) || 0));
    const nextDelay = Math.max(0, Math.round(Number(sequence.delayDays) || 0));
    const gapChanged = previousDelay !== nextDelay;
    for (const send of keptSends) {
      if (send.sequenceId !== sequence.id || send.status !== "pending") {
        continue;
      }
      const delayDays = gapChanged
        ? nextDelay
        : explicitDelayDays(send.stepDelayDays, nextDelay);
      const email = send.email.trim().toLowerCase();
      const previousSent = keptSends.find(
        (item) =>
          item.sequenceId === previous?.id &&
          item.email.trim().toLowerCase() === email &&
          item.status === "sent" &&
          item.sentAt instanceof Date,
      );
      const availableAt = !previousSent?.sentAt
        ? LOCKED_SEQUENCE_AT
        : useOpenTime
          ? followUpAvailableAt(
              previousSent.sentAt,
              delayDays,
              usualMinutes.get(email),
              blast.timezone,
            )
          : new Date(previousSent.sentAt.getTime() + delayDays * LIVE_EDIT_DAY_MS);
      delayWrites.push({
        updateOne: {
          filter: { _id: send._id },
          update: {
            $set: {
              ...(gapChanged ? { stepDelayDays: nextDelay } : {}),
              availableAt,
            },
          },
        },
      });
    }
  }
  if (delayWrites.length > 0) {
    await db.collection<CampaignSendDoc>("campaign_sends").bulkWrite(delayWrites);
  }

  const emails = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .distinct("email", { blastId: blast._id });
  const first = sequences[0];
  let listDisplayId: number | undefined = blast.listDisplayId;
  if (campaign.listId && ObjectId.isValid(campaign.listId)) {
    const listDoc = await db.collection<ListDoc>("lists").findOne({
      _id: new ObjectId(campaign.listId),
      projectId,
    });
    listDisplayId = listDoc?.displayId;
  }

  await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
    { _id: blast._id },
    {
      $set: {
        name: campaign.name,
        subject: first?.subject?.trim() || campaign.subject || blast.subject,
        previewText: first?.previewText || campaign.previewText,
        html: first?.designHtml?.trim() || campaign.designHtml || blast.html,
        senderId: campaign.senderId || blast.senderId,
        senderName: campaign.senderName,
        senderEmail: campaign.senderEmail || blast.senderEmail,
        ...(campaign.replyToEnabled && campaign.replyToEmail?.trim()
          ? { replyTo: campaign.replyToEmail.trim() }
          : {}),
        cc: campaignCcList(campaign),
        listId: campaign.listId || blast.listId,
        listName: campaign.listName || blast.listName,
        listDisplayId,
        timezone: campaign.timezone || blast.timezone,
        sequences,
        windowStart: campaign.windowStart || blast.windowStart || "09:00",
        windowEnd: campaign.windowEnd || blast.windowEnd || "18:00",
        ...(Number.isInteger(campaign.sendStartDay) ? { sendStartDay: campaign.sendStartDay } : {}),
        ...(Number.isInteger(campaign.sendEndDay) ? { sendEndDay: campaign.sendEndDay } : {}),
        emailGapMinutes: Math.max(0, Number(campaign.emailGapMinutes) || 0),
        scheduleByOpenTime: Boolean(campaign.scheduleByOpenTime),
        recipients: emails.length,
        updatedAt: now,
      },
      ...(campaign.replyToEnabled && campaign.replyToEmail?.trim()
        ? {}
        : { $unset: { replyTo: "" as const } }),
    },
  );
}

function pendingSendRow(input: {
  projectId: ObjectId;
  blast: CampaignBlastDoc;
  campaignId: string;
  contact: {
    email: string;
    fullName: string;
    firstName: string;
    lastName: string;
    companyName: string;
  };
  sequenceId: string;
  sequenceIndex: number;
  availableAt: Date;
}): CampaignSendDoc {
  return {
    _id: new ObjectId(),
    projectId: input.projectId,
    blastId: input.blast._id,
    campaignId: input.campaignId,
    email: input.contact.email,
    fullName: input.contact.fullName,
    firstName: input.contact.firstName,
    lastName: input.contact.lastName,
    companyName: input.contact.companyName,
    token: randomBytes(18).toString("hex"),
    status: "pending",
    openCount: 0,
    clickCount: 0,
    sequenceId: input.sequenceId,
    sequenceIndex: input.sequenceIndex,
    availableAt: input.availableAt,
  };
}

function availableAtForNewStep(
  sends: CampaignSendDoc[],
  sequences: CampaignSequence[],
  index: number,
  email: string,
  now: Date,
  usualMinutes?: Map<string, number>,
  timeZone?: string,
) {
  const zone = timeZone || "Asia/Kolkata";
  if (index === 0) {
    return usualMinutes
      ? snapToUsualOpenTime(now, usualMinutes.get(email), zone)
      : now;
  }
  const previous = sequences[index - 1];
  const previousSent = sends.find(
    (send) =>
      send.sequenceId === previous?.id &&
      send.email.trim().toLowerCase() === email &&
      send.status === "sent" &&
      send.sentAt instanceof Date,
  );
  if (!previousSent?.sentAt) {
    return LOCKED_SEQUENCE_AT;
  }
  const delayDays = Math.max(0, Number(sequences[index]?.delayDays) || 0);
  if (usualMinutes) {
    return followUpAvailableAt(
      previousSent.sentAt,
      delayDays,
      usualMinutes.get(email),
      zone,
    );
  }
  return new Date(previousSent.sentAt.getTime() + delayDays * LIVE_EDIT_DAY_MS);
}

/** Bot-tag / filter window for opens (always-on Action Open for every project). */
export const OPEN_BOT_GRACE_MS = 25_000;
/** Bot-tag window for clicks (always-on Action Click for every project). */
export const CLICK_BOT_GRACE_MS = 25_000;
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

async function getProjectEngagementFlags(_projectId: ObjectId) {
  // Action Open + Click are always on for every project (25s bot-tag window).
  return {
    skipOpenGrace: true,
    skipClickGrace: true,
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
  const prior = input.events
    .map((event) => ({ url: normalizeClickUrl(event.url), at: asTimeMs(event.at) }))
    .filter((event) => Number.isFinite(event.at));
  const withNext = [...prior, { url: nextNorm, at: nowMs }];

  // Simultaneous scanner requests can land slightly before or after this one.
  const inWindow = withNext.filter(
    (event) => Math.abs(event.at - nowMs) <= CLICK_BURST_WINDOW_MS,
  );
  const distinct = new Set(inWindow.map((event) => event.url).filter(Boolean));
  if (distinct.size >= CLICK_BURST_DISTINCT_URLS || inWindow.length >= 3) {
    return { ignore: true, revokeCountedClick: true };
  }

  const lastPrior = prior
    .filter((event) => event.at <= nowMs)
    .reduce<number | null>((latest, event) => Math.max(latest ?? event.at, event.at), null);
  if (lastPrior !== null && nowMs - lastPrior < CLICK_MIN_GAP_MS) {
    return { ignore: true, revokeCountedClick: false };
  }

  return { ignore: false, revokeCountedClick: false };
}

function clickEventsHaveBurst(events: Array<{ url: string; at: Date | string }>) {
  const list = events
    .map((event) => ({ url: normalizeClickUrl(event.url), at: asTimeMs(event.at) }))
    .filter((event) => Number.isFinite(event.at))
    .sort((left, right) => left.at - right.at);
  for (let start = 0; start < list.length; start += 1) {
    const window = list.filter(
      (event) => event.at >= list[start].at && event.at - list[start].at <= CLICK_BURST_WINDOW_MS,
    );
    const distinct = new Set(window.map((event) => event.url).filter(Boolean));
    if (distinct.size >= CLICK_BURST_DISTINCT_URLS || window.length >= 3) {
      return true;
    }
  }
  return false;
}

async function instantClickProjectIds() {
  const db = await getDb();
  const projects = await db
    .collection("projects")
    .find({})
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  return projects.map((project) => project._id);
}

/** Un-ignore every stored click for an instant-click project and recount its campaigns. */
export async function restoreClickBurstsForProject(projectId: ObjectId) {
  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const docs = await sends
    .find({ projectId, $or: [{ clickBurstIgnored: true }, { "clickEvents.ignored": true }] })
    .project<Pick<CampaignSendDoc, "_id" | "blastId" | "clickEvents">>({
      blastId: 1,
      clickEvents: 1,
    })
    .toArray();

  const blastIds = new Map<string, ObjectId>();
  const updates = docs.map((doc) => {
    blastIds.set(doc.blastId.toString(), doc.blastId);
    const events = (doc.clickEvents ?? []).map((event) => ({
      url: event.url,
      at: event.at,
      bot: true as const,
    }));
    const countable = events
      .filter((event) => !isNonNavigationalTrackedUrl(event.url ?? ""))
      .sort((left, right) => asTimeMs(left.at) - asTimeMs(right.at));
    const first = countable[0];
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: first
          ? {
              $set: {
                clickEvents: events,
                clickCount: countable.length,
                clickedAt: new Date(first.at),
                clickedUrl: first.url,
                botClick: true,
              },
              $unset: { clickBurstIgnored: "" as const },
            }
          : {
              $set: { clickEvents: events, botClick: true },
              $unset: { clickBurstIgnored: "" as const },
            },
      },
    };
  });

  for (let index = 0; index < updates.length; index += 500) {
    await sends.bulkWrite(updates.slice(index, index + 500), { ordered: false });
  }
  for (const blastId of blastIds.values()) {
    await refreshBlastCounts(blastId);
  }
  return { restoredSends: updates.length, campaigns: blastIds.size };
}

/** Flag past sends whose stored clicks show a scanner burst and recount their campaigns. */
export async function repairClickBursts(options?: { dryRun?: boolean }) {
  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const trustedProjects = await instantClickProjectIds();
  const cursor = sends
    .find({
      clickBurstIgnored: { $ne: true },
      "clickEvents.1": { $exists: true },
      ...(trustedProjects.length > 0 ? { projectId: { $nin: trustedProjects } } : {}),
    })
    .project<Pick<CampaignSendDoc, "_id" | "blastId" | "clickEvents">>({
      blastId: 1,
      clickEvents: 1,
    });

  let scanned = 0;
  const flaggedIds: ObjectId[] = [];
  const flaggedByBlast = new Map<string, number>();
  for await (const send of cursor) {
    scanned += 1;
    if (!clickEventsHaveBurst(send.clickEvents ?? [])) {
      continue;
    }
    flaggedIds.push(send._id);
    const key = send.blastId.toString();
    flaggedByBlast.set(key, (flaggedByBlast.get(key) ?? 0) + 1);
  }

  const blasts = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({ _id: { $in: [...flaggedByBlast.keys()].map((id) => new ObjectId(id)) } })
    .project<Pick<CampaignBlastDoc, "_id" | "campaignId" | "name" | "clicks">>({
      campaignId: 1,
      name: 1,
      clicks: 1,
    })
    .toArray();

  if (!options?.dryRun && flaggedIds.length > 0) {
    for (let index = 0; index < flaggedIds.length; index += 1000) {
      await sends.updateMany(
        { _id: { $in: flaggedIds.slice(index, index + 1000) } },
        {
          $set: { clickBurstIgnored: true, clickCount: 0 },
          $unset: { clickedAt: "", clickedUrl: "" },
        },
      );
    }
  }

  const campaigns = [];
  for (const blast of blasts) {
    const after = options?.dryRun ? null : await refreshBlastCounts(blast._id);
    campaigns.push({
      campaignId: blast.campaignId,
      name: blast.name,
      flaggedSends: flaggedByBlast.get(blast._id.toString()) ?? 0,
      clicksBefore: blast.clicks ?? 0,
      clicksAfter: after?.clicks,
    });
  }

  return { scanned, flaggedSends: flaggedIds.length, campaigns };
}

function engagementMetaFields(meta?: EngagementClientMeta) {
  const ip = meta?.ip?.trim().slice(0, 64) || undefined;
  const userAgent = meta?.userAgent?.trim().slice(0, 400) || undefined;
  const device = meta?.device;
  return {
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(device ? { device } : {}),
  };
}

export async function recordCampaignOpen(
  token: string,
  meta?: EngagementClientMeta,
) {
  const db = await getDb();
  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
  if (!send) {
    return;
  }
  const { skipOpenGrace } = await getProjectEngagementFlags(send.projectId);
  if (!skipOpenGrace && isWithinBotGracePeriod(send, OPEN_BOT_GRACE_MS)) {
    return;
  }

  const now = new Date();
  const firstOpen = !send.openedAt;
  const client = engagementMetaFields(meta);
  const withinGrace = isWithinBotGracePeriod(send, OPEN_BOT_GRACE_MS);
  await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
    { _id: send._id },
    {
      $inc: { openCount: 1 },
      $set: {
        openedAt: send.openedAt ?? now,
        ...(firstOpen && client.ip ? { openedIp: client.ip } : {}),
        ...(firstOpen && client.device ? { openedDevice: client.device } : {}),
        ...(firstOpen && client.userAgent ? { openedUserAgent: client.userAgent } : {}),
        ...(firstOpen && withinGrace ? { botOpen: true } : {}),
      },
      $push: {
        openEvents: {
          $each: [
            {
              at: now,
              ...client,
              ...(withinGrace ? { bot: true as const } : {}),
            },
          ],
          $slice: -25,
        },
      },
    },
  );
  if (firstOpen) {
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: send.blastId },
      { $inc: { opens: 1 }, $set: { updatedAt: now } },
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
        ...(client.ip ? { ip: client.ip } : {}),
        ...(client.device ? { device: client.device } : {}),
      },
    });
  }
}

export async function getCampaignSendByToken(token: string) {
  const db = await getDb();
  return db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
}

export async function recordCampaignClick(
  token: string,
  url?: string,
  meta?: EngagementClientMeta,
) {
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

  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const client = engagementMetaFields(meta);
  const clickEventBase = { at: now, ...client };

  // Instant-click projects count every click, including multi-link bursts,
  // but tag grace/burst hits as bot clicks for the report toggle.
  if (skipClickGrace) {
    const priorEvents = send.clickEvents ?? [];
    const withinGrace = isWithinBotGracePeriod(send, CLICK_BOT_GRACE_MS);
    const burst = detectClickBurst({
      events: priorEvents,
      now,
      nextUrl: clickedUrl,
    });
    const isBot = withinGrace || burst.ignore;
    await sends.updateOne(
      { _id: send._id },
      {
        ...(clickedUrl
          ? {
              $push: {
                clickEvents: {
                  url: clickedUrl,
                  ...clickEventBase,
                  ...(isBot ? { bot: true as const } : {}),
                },
              },
            }
          : {}),
        $unset: { clickBurstIgnored: "" },
        ...(isBot ? { $set: { botClick: true } } : {}),
      },
    );
    await countClick({ db, send, now, clickedUrl, burstFilter: {}, client });
    return;
  }

  // Already flagged as burst — keep redirect, never count again.
  if (send.clickBurstIgnored) {
    if (clickedUrl) {
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        {
          $push: {
            clickEvents: { url: clickedUrl, ...clickEventBase, ignored: true },
          },
        },
      );
    }
    return;
  }

  // Scanners fire every link at once, so save this event before judging it:
  // whichever request saves last sees the whole burst.
  const saved = clickedUrl
    ? await sends.findOneAndUpdate(
        { _id: send._id },
        { $push: { clickEvents: { url: clickedUrl, ...clickEventBase } } },
        { returnDocument: "after" },
      )
    : send;
  if (!saved) {
    return;
  }
  const events = saved.clickEvents ?? [];
  const ownIndex = clickedUrl
    ? events.findIndex(
        (event) => event.url === clickedUrl && asTimeMs(event.at) === now.getTime(),
      )
    : -1;
  const burst = detectClickBurst({
    events: events.filter((_, index) => index !== ownIndex),
    now,
    nextUrl: clickedUrl,
  });

  const markOwnIgnored = async () => {
    if (!clickedUrl) {
      return;
    }
    await sends.updateOne(
      { _id: send._id, clickEvents: { $elemMatch: { url: clickedUrl, at: now } } },
      { $set: { "clickEvents.$.ignored": true } },
    );
  };

  if (saved.clickBurstIgnored) {
    await markOwnIgnored();
    return;
  }

  if (burst.ignore) {
    await markOwnIgnored();
    if (burst.revokeCountedClick) {
      const before = await sends.findOneAndUpdate(
        { _id: send._id, clickBurstIgnored: { $ne: true } },
        {
          $set: { clickBurstIgnored: true, clickCount: 0 },
          $unset: { clickedAt: "", clickedUrl: "" },
        },
        { returnDocument: "before" },
      );
      if (before?.clickedAt) {
        await refreshBlastCounts(send.blastId);
      }
    }
    return;
  }

  await countClick({
    db,
    send,
    now,
    clickedUrl,
    burstFilter: { clickBurstIgnored: { $ne: true } },
    client,
  });
}

async function countClick(input: {
  db: Awaited<ReturnType<typeof getDb>>;
  send: CampaignSendDoc;
  now: Date;
  clickedUrl: string;
  burstFilter: Record<string, unknown>;
  client?: ReturnType<typeof engagementMetaFields>;
}) {
  const { db, send, now, clickedUrl, burstFilter, client } = input;
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const first = await sends.updateOne(
    { _id: send._id, ...burstFilter, clickedAt: { $exists: false } },
    {
      $inc: { clickCount: 1 },
      $set: {
        clickedAt: now,
        ...(clickedUrl ? { clickedUrl } : {}),
        ...(client?.ip ? { clickedIp: client.ip } : {}),
        ...(client?.device ? { clickedDevice: client.device } : {}),
        ...(client?.userAgent ? { clickedUserAgent: client.userAgent } : {}),
      },
    },
  );
  const firstClick = first.modifiedCount > 0;
  if (!firstClick) {
    await sends.updateOne({ _id: send._id, ...burstFilter }, { $inc: { clickCount: 1 } });
  }
  if (firstClick) {
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: send.blastId },
      { $inc: { clicks: 1 }, $set: { updatedAt: now } },
    );

    // Click without a prior open → images/pixel blocked; still count as open.
    const missingOpen = !send.openedAt && (send.openCount ?? 0) <= 0;
    if (missingOpen) {
      const openClient = client ?? {};
      const openWithinGrace = isWithinBotGracePeriod(send, OPEN_BOT_GRACE_MS);
      const inferred = await sends.updateOne(
        {
          _id: send._id,
          openedAt: { $exists: false },
          $or: [{ openCount: { $exists: false } }, { openCount: { $lte: 0 } }],
        },
        {
          $inc: { openCount: 1 },
          $set: {
            openedAt: now,
            openPixelBlocked: true,
            ...(openWithinGrace ? { botOpen: true } : {}),
            ...(openClient.ip ? { openedIp: openClient.ip } : {}),
            ...(openClient.device ? { openedDevice: openClient.device } : {}),
            ...(openClient.userAgent ? { openedUserAgent: openClient.userAgent } : {}),
          },
          $push: {
            openEvents: {
              $each: [
                {
                  at: now,
                  inferredFromClick: true as const,
                  ...(openWithinGrace ? { bot: true as const } : {}),
                  ...openClient,
                },
              ],
              $slice: -25,
            },
          },
        },
      );
      if (inferred.modifiedCount > 0) {
        await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
          { _id: send.blastId },
          { $inc: { opens: 1 }, $set: { updatedAt: now } },
        );
      }
    }

    const latest = await sends.findOne(
      { _id: send._id },
      { projection: { clickBurstIgnored: 1 } },
    );
    if (latest?.clickBurstIgnored) {
      await refreshBlastCounts(send.blastId);
      return;
    }
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
        ...(client?.ip ? { ip: client.ip } : {}),
        ...(client?.device ? { device: client.device } : {}),
        ...(missingOpen ? { openPixelBlocked: true } : {}),
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
  /** e.g. "Bot open" / "Open not tracked". */
  openTag?: string;
  openPixelBlocked?: boolean;
  botOpen?: boolean;
  clickedAt?: string;
  clickedUrl?: string;
  clickedLinks?: Array<{ url: string; at?: string; sequenceNumber?: number }>;
  /** Client IP from the latest counted click (when available). */
  clickedIp?: string;
  /** Device class from the latest counted click. */
  clickedDevice?: "mobile" | "tablet" | "desktop" | "unknown";
  /** e.g. "Bot click" for grace/burst clicks on instant-click projects. */
  clickTag?: string;
  botClick?: boolean;
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

type ListCampaignSendRecipientsOptions = {
  sequenceIndex?: number;
  uniqueContacts?: boolean;
  /** When true, omit bot opens/clicks from opens and clicks lists. */
  hideBotClicks?: boolean;
  /** Return only the recipient count (skips contact lookup + row mapping). */
  countOnly?: boolean;
};

export async function listCampaignSendRecipients(
  projectId: ObjectId,
  campaignId: string,
  filter: CampaignRecipientFilter,
  kind?: "drip" | "oneone",
  options?: Omit<ListCampaignSendRecipientsOptions, "countOnly"> & {
    countOnly?: false;
  },
): Promise<CampaignSendRecipient[]>;
export async function listCampaignSendRecipients(
  projectId: ObjectId,
  campaignId: string,
  filter: CampaignRecipientFilter,
  kind: "drip" | "oneone" | undefined,
  options: Omit<ListCampaignSendRecipientsOptions, "countOnly"> & {
    countOnly: true;
  },
): Promise<number>;
export async function listCampaignSendRecipients(
  projectId: ObjectId,
  campaignId: string,
  filter: CampaignRecipientFilter,
  kind?: "drip" | "oneone",
  options?: ListCampaignSendRecipientsOptions,
): Promise<CampaignSendRecipient[] | number> {
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
    // Real pixel opens + clicks counted as opens when images were blocked.
    query.$or = [
      { openCount: { $gt: 0 } },
      { openedAt: { $exists: true } },
      { openPixelBlocked: true },
      {
        clickBurstIgnored: { $ne: true },
        $or: [{ clickCount: { $gt: 0 } }, { clickedAt: { $exists: true } }],
      },
    ];
  } else if (filter === "clicks") {
    query.clickCount = { $gt: 0 };
    query.clickBurstIgnored = { $ne: true };
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

  const sequenceIndex = options?.sequenceIndex;
  const scopedQuery =
    typeof sequenceIndex === "number"
      ? {
          $and: [
            query,
            sequenceIndex === 0
              ? {
                  $or: [
                    { sequenceIndex: 0 },
                    { sequenceIndex: { $exists: false } },
                  ],
                }
              : { sequenceIndex },
          ],
        }
      : query;

  const sends = db.collection<CampaignSendDoc>("campaign_sends").find(scopedQuery);
  if (options?.countOnly) {
    sends.project({
      email: 1,
      sentAt: 1,
      openedAt: 1,
      openCount: 1,
      openPixelBlocked: 1,
      botOpen: 1,
      openEvents: 1,
      clickedAt: 1,
      clickedUrl: 1,
      clickCount: 1,
      clickBurstIgnored: 1,
      botClick: 1,
      clickEvents: 1,
      sequenceIndex: 1,
    });
  } else {
    sends.sort({ sequenceIndex: 1, fullName: 1, email: 1 });
  }
  const docs = await sends.toArray();

  if (options?.countOnly) {
    if (filter === "clicks") {
      const hideBotClicks = Boolean(options?.hideBotClicks);
      const emails = new Set<string>();
      for (const doc of docs) {
        const key = doc.email.trim().toLowerCase();
        if (!key) continue;
        const events =
          doc.clickEvents && doc.clickEvents.length > 0
            ? doc.clickEvents
            : doc.clickedAt
              ? [{ url: doc.clickedUrl || "", at: doc.clickedAt }]
              : [];
        const countable = events.filter((event) => {
          if (!isCountableClickEvent(event)) return false;
          if (hideBotClicks && clickEventIsBot(doc, event)) return false;
          return true;
        });
        if (countable.length === 0) continue;
        if (
          hideBotClicks &&
          sendIsBotClick(doc) &&
          countable.every((event) => clickEventIsBot(doc, event))
        ) {
          continue;
        }
        if (countable.some((event) => (event.url || doc.clickedUrl || "").trim())) {
          emails.add(key);
        }
      }
      return emails.size;
    }

    if (filter === "opens") {
      const hideBotOpens = Boolean(options?.hideBotClicks);
      const emails = new Set<string>();
      for (const doc of docs) {
        // Human click upgrades a grace/bot open to a counted human open.
        if (hideBotOpens && sendIsBotOnlyOpen(doc)) continue;
        const key = doc.email.trim().toLowerCase();
        if (!key) continue;
        if (options?.uniqueContacts) {
          emails.add(key);
        } else {
          emails.add(`${key}:${doc._id.toString()}`);
        }
      }
      return emails.size;
    }

    const emails = new Set<string>();
    for (const doc of docs) {
      const key = doc.email.trim().toLowerCase();
      if (!key) continue;
      if (options?.uniqueContacts || filter === "bounces") {
        emails.add(key);
      } else {
        emails.add(`${key}:${doc._id.toString()}`);
      }
    }
    return emails.size;
  }

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
    options?: { hideBotOpens?: boolean },
  ): CampaignSendRecipient {
    const email = doc.email.trim().toLowerCase();
    const sequenceIndex =
      typeof doc.sequenceIndex === "number" ? doc.sequenceIndex : undefined;
    const pixelBlocked = sendOpenPixelBlocked(doc);
    const botOpen = sendIsBotOpen(doc);
    const hideBotOpens = Boolean(options?.hideBotOpens);
    const openedAt =
      doc.openedAt?.toISOString() ||
      (pixelBlocked ? doc.clickedAt?.toISOString() : undefined);
    const openTags: string[] = [];
    if (botOpen && !hideBotOpens) {
      openTags.push(BOT_OPEN_TAG);
    }
    if (pixelBlocked) {
      openTags.push(OPEN_PIXEL_BLOCKED_TAG);
    }
    return {
      id: extra?.id ?? doc._id.toString(),
      email: doc.email,
      fullName: doc.fullName || doc.email,
      companyName: doc.companyName || "",
      contactId: contactIdsByEmail.get(email),
      status: doc.status,
      error: doc.error || "",
      sentAt: doc.sentAt?.toISOString(),
      openedAt,
      ...(pixelBlocked ? { openPixelBlocked: true } : {}),
      ...(botOpen && !hideBotOpens ? { botOpen: true } : {}),
      ...(openTags.length > 0 ? { openTag: openTags.join(" · ") } : {}),
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

  function dedupeByEmail(rows: CampaignSendRecipient[]) {
    if (!options?.uniqueContacts) {
      return rows;
    }
    const seen = new Set<string>();
    const unique: CampaignSendRecipient[] = [];
    for (const row of rows) {
      const key = row.email.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(row);
    }
    return unique;
  }

  if (filter === "clicks") {
    const hideBotClicks = Boolean(options?.hideBotClicks);
    const byEmail = new Map<
      string,
      {
        doc: CampaignSendDoc;
        latestAt: number;
        links: Array<{ url: string; at?: string; sequenceNumber?: number }>;
      }
    >();

    for (const doc of docs) {
      const key = doc.email.trim().toLowerCase();
      if (!key) {
        continue;
      }
      const events =
        doc.clickEvents && doc.clickEvents.length > 0
          ? doc.clickEvents
          : doc.clickedAt
            ? [{ url: doc.clickedUrl || "", at: doc.clickedAt }]
            : [];
      const sequenceNumber =
        typeof doc.sequenceIndex === "number" ? doc.sequenceIndex + 1 : undefined;
      const countable = events.filter((event) => {
        if (!isCountableClickEvent(event)) {
          return false;
        }
        if (hideBotClicks && clickEventIsBot(doc, event)) {
          return false;
        }
        return true;
      });
      if (countable.length === 0) {
        continue;
      }
      if (hideBotClicks && sendIsBotClick(doc) && countable.every((event) => clickEventIsBot(doc, event))) {
        continue;
      }

      const bucket = byEmail.get(key) ?? { doc, latestAt: 0, links: [] };
      for (const event of countable) {
        const atMs = event.at instanceof Date ? event.at.getTime() : new Date(event.at).getTime();
        const at = Number.isFinite(atMs) ? new Date(atMs).toISOString() : undefined;
        const url = (event.url || doc.clickedUrl || "").trim();
        if (!url) {
          continue;
        }
        const existing = bucket.links.find(
          (link) => link.url === url && link.sequenceNumber === sequenceNumber,
        );
        if (!existing) {
          bucket.links.push({ url, at, sequenceNumber });
        } else if ((at ?? "") > (existing.at ?? "")) {
          existing.at = at;
        }
        if (Number.isFinite(atMs) && atMs >= bucket.latestAt) {
          bucket.latestAt = atMs;
          bucket.doc = doc;
        }
      }
      byEmail.set(key, bucket);
    }

    return [...byEmail.values()]
      .filter(({ links }) => links.length > 0)
      .map(({ doc, links }) => {
        const clickedLinks = links
          .slice()
          .sort((left, right) => (right.at ?? "").localeCompare(left.at ?? ""));
        const latest = clickedLinks[0];
        const bot = sendIsBotClick(doc);
        const docEvents =
          doc.clickEvents && doc.clickEvents.length > 0
            ? doc.clickEvents
            : doc.clickedAt
              ? [
                  {
                    url: doc.clickedUrl || "",
                    at: doc.clickedAt,
                    ip: doc.clickedIp,
                    device: doc.clickedDevice,
                  },
                ]
              : [];
        const metaEvent = [...docEvents]
          .filter((event) => {
            if (!isCountableClickEvent(event)) return false;
            if (hideBotClicks && clickEventIsBot(doc, event)) return false;
            return Boolean(event.ip || event.device);
          })
          .sort((left, right) => {
            const leftMs =
              left.at instanceof Date
                ? left.at.getTime()
                : new Date(left.at).getTime();
            const rightMs =
              right.at instanceof Date
                ? right.at.getTime()
                : new Date(right.at).getTime();
            return rightMs - leftMs;
          })[0];
        const clickedIp =
          (typeof metaEvent?.ip === "string" && metaEvent.ip.trim()) ||
          doc.clickedIp?.trim() ||
          "";
        const clickedDevice =
          metaEvent?.device || doc.clickedDevice || undefined;
        return mapRecipient(doc, {
          id: doc.email.trim().toLowerCase(),
          clickedAt: latest?.at,
          clickedUrl: latest?.url ?? "",
          clickedLinks,
          ...(clickedIp ? { clickedIp } : {}),
          ...(clickedDevice ? { clickedDevice } : {}),
          ...(bot && !hideBotClicks
            ? { botClick: true, clickTag: BOT_CLICK_TAG }
            : {}),
          ...(typeof latest?.sequenceNumber === "number"
            ? {
                sequenceIndex: latest.sequenceNumber - 1,
                sequenceNumber: latest.sequenceNumber,
              }
            : { sequenceIndex: undefined, sequenceNumber: undefined }),
        });
      })
      .sort((left, right) => (right.clickedAt ?? "").localeCompare(left.clickedAt ?? ""));
  }

  if (filter === "opens") {
    const hideBotOpens = Boolean(options?.hideBotClicks);
    const rows = docs
      .filter((doc) => {
        if (hideBotOpens && sendIsBotOnlyOpen(doc)) {
          return false;
        }
        return true;
      })
      .map((doc) => mapRecipient(doc, undefined, { hideBotOpens }));
    return dedupeByEmail(rows);
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

  return dedupeByEmail(docs.map((doc) => mapRecipient(doc)));
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
    .find(blast ? { projectId, blastId: blast._id } : { projectId, campaignId }, {
      projection: {
        email: 1,
        fullName: 1,
        firstName: 1,
        lastName: 1,
        companyName: 1,
        status: 1,
        error: 1,
        sentAt: 1,
        openedAt: 1,
        openCount: 1,
        openPixelBlocked: 1,
        botOpen: 1,
        openedDevice: 1,
        openEvents: {
          $map: {
            input: { $slice: [{ $ifNull: ["$openEvents", []] }, 3] },
            as: "event",
            in: {
              at: "$$event.at",
              device: "$$event.device",
              inferredFromClick: "$$event.inferredFromClick",
              bot: "$$event.bot",
            },
          },
        },
        clickedAt: 1,
        clickedUrl: 1,
        clickedIp: 1,
        clickedDevice: 1,
        clickBurstIgnored: 1,
        botClick: 1,
        clickEvents: {
          $map: {
            input: { $slice: [{ $ifNull: ["$clickEvents", []] }, 8] },
            as: "event",
            in: {
              url: "$$event.url",
              at: "$$event.at",
              device: "$$event.device",
              ip: "$$event.ip",
              ignored: "$$event.ignored",
              bot: "$$event.bot",
            },
          },
        },
        clickCount: 1,
        unsubscribedAt: 1,
        sequenceIndex: 1,
      },
    })
    .sort({ fullName: 1, email: 1 })
    .toArray();
}
