import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getDb } from "@/lib/mongodb";
import type { SenderDoc } from "@/lib/smtp-senders";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";

export type InboxMessageDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  senderId: ObjectId;
  senderEmail: string;
  direction: "inbound";
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  threadKey: string;
  relatedSendId?: ObjectId;
  relatedBlastId?: ObjectId;
  relatedCampaignId?: string;
  relatedContactEmail?: string;
  imapUid: number;
  mailbox: string;
  receivedAt: Date;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type InboxMessage = {
  id: string;
  senderId: string;
  senderEmail: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  messageId: string;
  threadKey: string;
  relatedCampaignId?: string;
  relatedContactEmail?: string;
  receivedAt: string;
  readAt?: string;
};

export type InboxThread = {
  threadKey: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  preview: string;
  messageCount: number;
  unreadCount: number;
  latestAt: string;
  relatedCampaignId?: string;
  relatedContactEmail?: string;
  senderId: string;
  senderEmail: string;
};

export type InboxAccount = {
  id: string;
  email: string;
  label: string;
};

function normalizeMessageId(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const trimmed = raw.replace(/^<|>$/g, "").trim().toLowerCase();
  return trimmed;
}

function unwrapMessageId(value?: string | null) {
  const normalized = normalizeMessageId(value);
  return normalized ? `<${normalized}>` : "";
}

function isBounceOrDeliveryNotice(input: {
  fromEmail: string;
  fromName?: string;
  subject?: string;
}) {
  const from = input.fromEmail.trim().toLowerCase();
  const name = String(input.fromName ?? "").trim().toLowerCase();
  const subject = String(input.subject ?? "").trim().toLowerCase();
  if (
    from.includes("mailer-daemon") ||
    from.includes("mail-daemon") ||
    from.startsWith("postmaster@") ||
    from.startsWith("mailerdaemon@") ||
    name.includes("mailer-daemon") ||
    name.includes("mail delivery subsystem")
  ) {
    return true;
  }
  return /undeliverable|delivery status notification|returned mail|mail delivery failed|failure notice|delivery incomplete|delivery failure|could not be delivered|wasn't delivered|was not delivered|delivery notification|permanent failure/.test(
    subject,
  );
}

/** Generate a stable Message-ID for outbound campaign mail (Gmail IMAP matching). */
export function createOutboundMessageId() {
  const id = `${Date.now().toString(36)}.${randomBytes(8).toString("hex")}@unified.nexuses.xyz`;
  return `<${id}>`;
}

export function normalizeStoredMessageId(value?: string | null) {
  return normalizeMessageId(value);
}

function mapInboxMessage(doc: InboxMessageDoc): InboxMessage {
  return {
    id: doc._id.toString(),
    senderId: doc.senderId.toString(),
    senderEmail: doc.senderEmail,
    fromEmail: doc.fromEmail,
    fromName: doc.fromName,
    toEmail: doc.toEmail,
    subject: doc.subject,
    textBody: doc.textBody,
    htmlBody: doc.htmlBody,
    messageId: doc.messageId,
    threadKey: doc.threadKey,
    relatedCampaignId: doc.relatedCampaignId,
    relatedContactEmail: doc.relatedContactEmail,
    receivedAt: doc.receivedAt.toISOString(),
    readAt: doc.readAt?.toISOString(),
  };
}

function extractAddress(
  value:
    | { text?: string; value?: Array<{ address?: string; name?: string }> }
    | Array<{ text?: string; value?: Array<{ address?: string; name?: string }> }>
    | string
    | undefined,
) {
  if (!value) {
    return { email: "", name: "" };
  }
  if (Array.isArray(value)) {
    return extractAddress(value[0]);
  }
  if (typeof value === "string") {
    const match = value.match(/<?([^\s<>]+@[^\s<>]+)>?/);
    return { email: (match?.[1] ?? value).trim().toLowerCase(), name: "" };
  }
  const first = value.value?.[0];
  return {
    email: (first?.address ?? "").trim().toLowerCase(),
    name: (first?.name ?? "").trim(),
  };
}

async function matchOutboundSend(
  projectId: ObjectId,
  referenceIds: string[],
) {
  const normalized = referenceIds.map(normalizeMessageId).filter(Boolean);
  if (normalized.length === 0) {
    return null;
  }

  const db = await getDb();
  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({
    projectId,
    status: "sent",
    messageIdNorm: { $in: normalized },
  });
  return send;
}

/** Cancel later 1-1 sequence steps after a contact replies. */
async function stopLaterSequencesOnReply(send: CampaignSendDoc) {
  const sequenceIndex =
    typeof send.sequenceIndex === "number" ? send.sequenceIndex : 0;
  const db = await getDb();
  const now = new Date();
  await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
    { _id: send._id },
    { $set: { repliedAt: now } },
  );
  await db.collection<CampaignSendDoc>("campaign_sends").updateMany(
    {
      blastId: send.blastId,
      email: send.email,
      sequenceIndex: { $gt: sequenceIndex },
      status: { $in: ["pending", "sending"] },
    },
    {
      $set: { status: "failed", error: "Replied" },
      $unset: { claimedAt: "" },
    },
  );
}

/** Mark matched outbound send as bounced; remove from delivered; stop later steps. */
async function markSendBouncedFromInbox(send: CampaignSendDoc) {
  const sequenceIndex =
    typeof send.sequenceIndex === "number" ? send.sequenceIndex : 0;
  const db = await getDb();
  const now = new Date();
  await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
    { _id: send._id },
    {
      $set: {
        status: "failed",
        error: "Bounced",
        bouncedAt: now,
      },
      $unset: { claimedAt: "" },
    },
  );
  await db.collection<CampaignSendDoc>("campaign_sends").updateMany(
    {
      blastId: send.blastId,
      email: send.email,
      sequenceIndex: { $gt: sequenceIndex },
      status: { $in: ["pending", "sending"] },
    },
    {
      $set: { status: "failed", error: "Bounced" },
      $unset: { claimedAt: "" },
    },
  );
}

/** Keep Master Inbox strictly to replies tied to real campaign sends. */
async function purgeNonCampaignInboxMessages(projectId: ObjectId) {
  const db = await getDb();
  const inbox = db.collection<InboxMessageDoc>("inbox_messages");

  // Anything never linked to a campaign send
  await inbox.deleteMany({
    projectId,
    $or: [
      { relatedSendId: { $exists: false } },
      { relatedSendId: { $eq: null } },
      { relatedCampaignId: { $exists: false } },
      { relatedCampaignId: { $in: [null, ""] } },
    ],
  } as Record<string, unknown>);

  // Bounce / DSN leftovers
  await inbox.deleteMany({
    projectId,
    $or: [
      { fromEmail: /mailer-daemon|mail-daemon|postmaster@|mailerdaemon@/i },
      {
        subject:
          /undeliverable|delivery status notification|returned mail|mail delivery failed|failure notice|delivery incomplete|delivery failure|could not be delivered|wasn't delivered|was not delivered|delivery notification|permanent failure/i,
      },
    ],
  });

  // Drop messages whose campaign send no longer exists (or was never a real send)
  const linked = await inbox
    .find({
      projectId,
      relatedSendId: { $exists: true },
    })
    .project({ _id: 1, relatedSendId: 1 })
    .toArray();

  if (linked.length === 0) {
    return;
  }

  const sendIds = [
    ...new Set(
      linked
        .map((doc) => doc.relatedSendId)
        .filter((id): id is ObjectId => Boolean(id))
        .map((id) => id.toString()),
    ),
  ].map((id) => new ObjectId(id));

  const existingSends = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({
      projectId,
      _id: { $in: sendIds },
      status: "sent",
      messageIdNorm: { $exists: true, $type: "string" },
    })
    .project({ _id: 1 })
    .toArray();

  const valid = new Set(existingSends.map((send) => send._id.toString()));
  const orphanIds = linked
    .filter((doc) => !doc.relatedSendId || !valid.has(doc.relatedSendId.toString()))
    .map((doc) => doc._id);

  if (orphanIds.length > 0) {
    await inbox.deleteMany({ _id: { $in: orphanIds } });
  }
}

function buildThreadKey(input: {
  inReplyTo?: string;
  references: string[];
  messageId: string;
  relatedSendId?: ObjectId;
}) {
  if (input.relatedSendId) {
    return `send:${input.relatedSendId.toString()}`;
  }
  const root = input.references[0] || input.inReplyTo || input.messageId;
  return `msg:${normalizeMessageId(root) || normalizeMessageId(input.messageId)}`;
}

async function syncGmailSender(
  projectId: ObjectId,
  sender: SenderDoc,
  options?: { sinceDays?: number },
) {
  const user = sender.smtpUser || sender.fromEmail;
  const pass = sender.smtpPassword;
  if (!user || !pass) {
    return { imported: 0, skipped: 0, error: "Missing Gmail username or password" };
  }

  const sinceDays = Math.min(30, Math.max(1, options?.sinceDays ?? 14));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  let imported = 0;
  let skipped = 0;

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX");
    if (!mailbox || mailbox.exists === 0) {
      return { imported: 0, skipped: 0 };
    }

    const db = await getDb();
    const uids = await client.search({ since }, { uid: true });
    if (!uids || uids.length === 0) {
      return { imported: 0, skipped: 0 };
    }

    // Cap per sync to avoid long requests
    const limited = uids.slice(-200);

    for await (const message of client.fetch(
      limited,
      { uid: true, source: true, envelope: true },
      { uid: true },
    )) {
      if (!message.source || !message.uid) {
        skipped += 1;
        continue;
      }

      const existing = await db.collection<InboxMessageDoc>("inbox_messages").findOne({
        projectId,
        senderId: sender._id,
        imapUid: message.uid,
        mailbox: "INBOX",
      });
      if (existing) {
        // Re-evaluate old imports that were stored before campaign-only filtering
        if (!existing.relatedSendId || !existing.relatedCampaignId) {
          await db.collection<InboxMessageDoc>("inbox_messages").deleteOne({
            _id: existing._id,
          });
        } else {
          const relatedSend = await db.collection<CampaignSendDoc>("campaign_sends").findOne({
            _id: existing.relatedSendId,
          });
          if (relatedSend) {
            await stopLaterSequencesOnReply(relatedSend);
          }
          skipped += 1;
          continue;
        }
      }

      const parsed = await simpleParser(message.source);
      const messageId = normalizeMessageId(parsed.messageId);
      if (!messageId) {
        skipped += 1;
        continue;
      }

      const already = await db.collection<InboxMessageDoc>("inbox_messages").findOne({
        projectId,
        messageId,
      });
      if (already) {
        skipped += 1;
        continue;
      }

      const from = extractAddress(parsed.from);
      const to = extractAddress(parsed.to);
      const subject =
        String(parsed.subject ?? "(no subject)").trim() || "(no subject)";
      const inReplyTo = normalizeMessageId(
        Array.isArray(parsed.inReplyTo) ? parsed.inReplyTo[0] : parsed.inReplyTo,
      );
      const references = (
        Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : []
      )
        .map((item) => normalizeMessageId(item))
        .filter(Boolean);

      const related = await matchOutboundSend(projectId, [
        inReplyTo,
        ...references,
      ]);

      const isBounce = isBounceOrDeliveryNotice({
        fromEmail: from.email,
        fromName: from.name,
        subject,
      });

      // Bounce/DSN: count on campaign, remove from delivered, never show in Master Inbox
      if (isBounce) {
        if (related?._id) {
          await markSendBouncedFromInbox(related);
        }
        skipped += 1;
        continue;
      }

      // Only keep human replies that match a campaign send from this project
      if (!related?._id) {
        skipped += 1;
        continue;
      }

      // 1-1: stop sequence 2+ for this contact once they reply
      await stopLaterSequencesOnReply(related);

      const now = new Date();
      const receivedAt =
        parsed.date instanceof Date && Number.isFinite(parsed.date.getTime())
          ? parsed.date
          : now;

      const doc: InboxMessageDoc = {
        _id: new ObjectId(),
        projectId,
        senderId: sender._id,
        senderEmail: sender.fromEmail,
        direction: "inbound",
        fromEmail: from.email,
        fromName: from.name,
        toEmail: to.email || sender.fromEmail,
        subject,
        textBody: String(parsed.text ?? "").trim(),
        htmlBody: typeof parsed.html === "string" ? parsed.html : "",
        messageId,
        inReplyTo: inReplyTo || undefined,
        references,
        threadKey: buildThreadKey({
          inReplyTo,
          references,
          messageId,
          relatedSendId: related._id,
        }),
        relatedSendId: related._id,
        relatedBlastId: related.blastId,
        relatedCampaignId: related.campaignId,
        relatedContactEmail: related.email || from.email,
        imapUid: message.uid,
        mailbox: "INBOX",
        receivedAt,
        createdAt: now,
        updatedAt: now,
      };

      await db.collection<InboxMessageDoc>("inbox_messages").insertOne(doc);
      imported += 1;
    }

    await db.collection("smtp_senders").updateOne(
      { _id: sender._id },
      { $set: { inboxSyncedAt: new Date(), updatedAt: new Date() } },
    );

    return { imported, skipped };
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore logout errors
    }
  }
}

export async function listGmailInboxAccounts(
  projectId: ObjectId,
): Promise<InboxAccount[]> {
  const db = await getDb();
  const senders = await db
    .collection<SenderDoc>("smtp_senders")
    .find({
      projectId,
      provider: "gmail",
      noInbox: { $ne: true },
    })
    .sort({ fromEmail: 1 })
    .toArray();

  return senders.map((sender) => ({
    id: sender._id.toString(),
    email: sender.fromEmail,
    label: sender.fromEmail,
  }));
}

export async function syncProjectGmailInbox(
  projectId: ObjectId,
  options?: { sinceDays?: number; senderId?: string },
) {
  const db = await getDb();
  const filter: Record<string, unknown> = {
    projectId,
    provider: "gmail",
    noInbox: { $ne: true },
  };
  if (options?.senderId && ObjectId.isValid(options.senderId)) {
    filter._id = new ObjectId(options.senderId);
  }

  const senders = await db.collection<SenderDoc>("smtp_senders").find(filter).toArray();

  if (senders.length === 0) {
    return {
      senders: 0,
      imported: 0,
      skipped: 0,
      errors: [
        options?.senderId
          ? "Selected Gmail inbox was not found or has no inbox access."
          : "No Gmail senders with inbox access. Add a Gmail sender (not no-inbox).",
      ],
    };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  await purgeNonCampaignInboxMessages(projectId);

  for (const sender of senders) {
    try {
      const result = await syncGmailSender(projectId, sender, options);
      imported += result.imported;
      skipped += result.skipped;
      if (result.error) {
        errors.push(`${sender.fromEmail}: ${result.error}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "IMAP sync failed";
      errors.push(`${sender.fromEmail}: ${message}`);
    }
  }

  return { senders: senders.length, imported, skipped, errors };
}

export async function listProjectInboxThreads(
  projectId: ObjectId,
  options?: { senderId?: string },
) {
  const db = await getDb();
  await purgeNonCampaignInboxMessages(projectId);

  const filter: Record<string, unknown> = {
    projectId,
    relatedSendId: { $exists: true },
    relatedCampaignId: { $exists: true, $type: "string", $ne: "" },
  };
  if (options?.senderId && ObjectId.isValid(options.senderId)) {
    filter.senderId = new ObjectId(options.senderId);
  }

  const messages = await db
    .collection<InboxMessageDoc>("inbox_messages")
    .find(filter)
    .sort({ receivedAt: -1 })
    .limit(500)
    .toArray();

  const threads = new Map<string, InboxThread>();
  for (const message of messages) {
    if (
      isBounceOrDeliveryNotice({
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        subject: message.subject,
      })
    ) {
      continue;
    }
    const existing = threads.get(message.threadKey);
    const preview =
      message.textBody.replace(/\s+/g, " ").trim().slice(0, 140) ||
      "(no preview)";
    if (!existing) {
      threads.set(message.threadKey, {
        threadKey: message.threadKey,
        subject: message.subject,
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        preview,
        messageCount: 1,
        unreadCount: message.readAt ? 0 : 1,
        latestAt: message.receivedAt.toISOString(),
        relatedCampaignId: message.relatedCampaignId,
        relatedContactEmail: message.relatedContactEmail,
        senderId: message.senderId.toString(),
        senderEmail: message.senderEmail,
      });
      continue;
    }
    existing.messageCount += 1;
    if (!message.readAt) {
      existing.unreadCount += 1;
    }
  }

  return [...threads.values()].sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
  );
}

export async function listProjectInboxThreadMessages(
  projectId: ObjectId,
  threadKey: string,
) {
  const db = await getDb();
  const docs = await db
    .collection<InboxMessageDoc>("inbox_messages")
    .find({
      projectId,
      threadKey,
      relatedSendId: { $exists: true },
    })
    .sort({ receivedAt: 1 })
    .toArray();
  return docs.map(mapInboxMessage);
}

export async function markInboxThreadRead(
  projectId: ObjectId,
  threadKey: string,
) {
  const db = await getDb();
  const now = new Date();
  await db.collection<InboxMessageDoc>("inbox_messages").updateMany(
    { projectId, threadKey, readAt: { $exists: false } },
    { $set: { readAt: now, updatedAt: now } },
  );
  return listProjectInboxThreadMessages(projectId, threadKey);
}
