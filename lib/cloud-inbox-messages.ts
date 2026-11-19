import { createHash } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { InboxMessageDoc } from "@/lib/master-inbox-server";
import type { CloudReplyMessage } from "@/lib/cloud-sender";
import { cloudSendsFilter } from "@/lib/cloud-campaign-tracking";

/**
 * Replies to cloud campaign emails, copied into the Master Inbox (`inbox_messages`).
 * Cloud senders have no IMAP: the reply is read from the sender's own Gmail/Outlook on the
 * cloud computer, then stored here linked to the cloud send (`relatedSendId`) so it threads
 * with that recipient and shows the campaign. Marked `source: "cloud"`.
 */
export type CloudInboxMessageDoc = InboxMessageDoc & { source: "cloud" };

function stripActiveContent(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function parseMailDate(value: string) {
  const time = Date.parse(String(value || "").replace(/\s+at\s+/i, " "));
  return Number.isFinite(time) ? new Date(time) : null;
}

/** Save replies read from the sender's mailbox. Returns how many were new. */
export async function saveCloudReplies(input: {
  projectId: ObjectId;
  campaignId: string;
  campaignObjectId: ObjectId;
  senderProfileId?: string;
  senderEmail: string;
  replies: CloudReplyMessage[];
}) {
  if (!input.replies.length) return 0;
  const db = await getDb();
  const sends = db.collection<{ _id: ObjectId; email: string; subjectLine?: string; sentAt?: Date }>("campaign_sends");
  const inbox = db.collection<CloudInboxMessageDoc>("inbox_messages");
  const base = await cloudSendsFilter(input.projectId, input.campaignId);
  const senderId =
    input.senderProfileId && ObjectId.isValid(input.senderProfileId)
      ? new ObjectId(input.senderProfileId)
      : input.campaignObjectId;
  const sendByEmail = new Map<string, { _id: ObjectId; subjectLine?: string } | null>();
  let added = 0;
  for (const reply of input.replies) {
    const fromEmail = String(reply.fromEmail || "").trim().toLowerCase();
    const text = String(reply.text || "").trim();
    if (!fromEmail.includes("@") || !text) continue;
    if (!sendByEmail.has(fromEmail)) {
      const send = await sends.findOne(
        { ...base, status: "sent", email: fromEmail },
        { sort: { sentAt: -1 }, projection: { _id: 1, subjectLine: 1 } },
      );
      sendByEmail.set(fromEmail, send);
    }
    const send = sendByEmail.get(fromEmail);
    if (!send) continue;
    const fingerprint = createHash("sha1")
      .update(`${fromEmail}|${reply.date}|${text.replace(/\s+/g, " ").slice(0, 500)}`)
      .digest("hex")
      .slice(0, 20);
    const messageId = `cloud:${send._id.toHexString()}:${fingerprint}`;
    const now = new Date();
    const doc: Omit<CloudInboxMessageDoc, "_id"> = {
      projectId: input.projectId,
      senderId,
      senderEmail: input.senderEmail,
      direction: "inbound",
      fromEmail,
      fromName: String(reply.fromName || "").trim(),
      toEmail: input.senderEmail,
      subject: String(reply.subject || "").trim() || `Re: ${send.subjectLine || ""}`.trim(),
      textBody: text,
      htmlBody: stripActiveContent(String(reply.html || "")),
      messageId,
      references: [],
      threadKey: `send:${send._id.toHexString()}`,
      relatedSendId: send._id,
      relatedBlastId: input.campaignObjectId,
      relatedCampaignId: input.campaignId,
      relatedContactEmail: fromEmail,
      imapUid: 0,
      mailbox: "cloud",
      receivedAt: parseMailDate(reply.date) || now,
      createdAt: now,
      updatedAt: now,
      source: "cloud",
    };
    const result = await inbox.updateOne(
      { projectId: input.projectId, messageId },
      { $setOnInsert: { _id: new ObjectId(), ...doc } },
      { upsert: true },
    );
    if (result.upsertedCount) added += 1;
  }
  return added;
}
