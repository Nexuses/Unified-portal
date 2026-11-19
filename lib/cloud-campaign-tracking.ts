import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";

/**
 * Cloud campaign sends are recorded in the shared `campaign_sends` collection so the existing
 * open / click / unsubscribe routes, webhooks and activity feed work for them unchanged.
 * Cloud rows are marked with `cloudRow` (the people-list row) and `source: "cloud"`.
 */
type CloudSendDoc = CampaignSendDoc & { cloudRow: number; source: "cloud"; bounceReason?: string };

async function sends() {
  const db = await getDb();
  return db.collection<CloudSendDoc>("campaign_sends");
}

const blastIds = new Map<string, ObjectId | null>();

/**
 * Filter for one cloud campaign's sends. Includes `blastId` (the campaign's _id) so queries use
 * the existing { blastId, status } index on the shared, large `campaign_sends` collection.
 */
export async function cloudSendsFilter(projectId: ObjectId, campaignId: string) {
  const key = `${projectId.toHexString()}:${campaignId}`;
  if (!blastIds.has(key)) {
    const db = await getDb();
    const campaign = await db
      .collection<{ _id: ObjectId }>("cloud_campaigns")
      .findOne({ projectId, campaignId }, { projection: { _id: 1 } });
    blastIds.set(key, campaign?._id ?? null);
  }
  const blastId = blastIds.get(key);
  return { ...(blastId ? { blastId } : {}), projectId, campaignId, source: "cloud" as const };
}

/** Create (or reuse, on a retry of the same row) the tracking record for one email. */
export async function prepareCloudSend(input: {
  projectId: ObjectId;
  campaignObjectId: ObjectId;
  campaignId: string;
  row: number;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  position?: string;
  subject: string;
}) {
  const collection = await sends();
  const existing = await collection.findOne({
    blastId: input.campaignObjectId,
    projectId: input.projectId,
    campaignId: input.campaignId,
    cloudRow: input.row,
    email: input.email.toLowerCase(),
    status: "sending",
  });
  if (existing) return { sendId: existing._id, token: existing.token };
  const firstName = input.firstName || "";
  const lastName = input.lastName || "";
  const doc: CloudSendDoc = {
    _id: new ObjectId(),
    projectId: input.projectId,
    blastId: input.campaignObjectId,
    campaignId: input.campaignId,
    email: input.email.toLowerCase(),
    fullName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    companyName: input.companyName || "",
    position: input.position || undefined,
    token: randomBytes(18).toString("hex"),
    status: "sending",
    openCount: 0,
    clickCount: 0,
    sequenceIndex: 0,
    subjectLine: input.subject,
    cloudRow: input.row,
    source: "cloud",
  };
  await collection.insertOne(doc);
  return { sendId: doc._id, token: doc.token };
}

export async function markCloudSendSent(sendId: ObjectId, gmailMessageId?: string) {
  const collection = await sends();
  await collection.updateOne(
    { _id: sendId },
    // The Gmail message id lets follow-ups open the thread directly.
    { $set: { status: "sent", sentAt: new Date(), ...(gmailMessageId ? { gmailMessageId } : {}) } },
  );
}

/** Nothing went out: drop the record so it never shows in the report. */
export async function discardCloudSend(sendId: ObjectId) {
  const collection = await sends();
  await collection.deleteOne({ _id: sendId, status: "sending" });
}

export async function deleteCloudSends(projectId: ObjectId, campaignId: string) {
  const collection = await sends();
  await collection.deleteMany(await cloudSendsFilter(projectId, campaignId));
}

/** Mark replies / bounces found in the sender's inbox. Returns how many were new. */
export async function recordCloudInboxEvents(
  projectId: ObjectId,
  campaignId: string,
  events: { replied: string[]; bounced: string[]; bounceDetails?: { email: string; reason: string }[] },
) {
  const collection = await sends();
  const base = await cloudSendsFilter(projectId, campaignId);
  const now = new Date();
  const replied = events.replied.map((e) => e.toLowerCase());
  const bounced = events.bounced.map((e) => e.toLowerCase());
  const r = replied.length
    ? await collection.updateMany(
        { ...base, status: "sent", email: { $in: replied }, repliedAt: { $exists: false } },
        { $set: { repliedAt: now } },
      )
    : { modifiedCount: 0 };
  const b = bounced.length
    ? await collection.updateMany(
        { ...base, status: "sent", email: { $in: bounced }, bouncedAt: { $exists: false } },
        { $set: { bouncedAt: now } },
      )
    : { modifiedCount: 0 };
  // Why it bounced, for the bounce report (kept from the first notice seen).
  for (const detail of events.bounceDetails || []) {
    const reason = String(detail.reason || "").trim().slice(0, 300);
    if (!reason) continue;
    await collection.updateMany(
      { ...base, status: "sent", email: String(detail.email).toLowerCase(), bounceReason: { $exists: false } },
      { $set: { bounceReason: reason } },
    );
  }
  return { replied: r.modifiedCount, bounced: b.modifiedCount };
}

export type CloudReportRecipient = {
  row: number;
  email: string;
  name: string;
  company: string;
  subject: string;
  sentAt?: string;
  repliedAt?: string;
  bouncedAt?: string;
  /** Why it bounced, from the bounce notice in the sender's mailbox. */
  bounceReason?: string;
};

const iso = (value?: Date) => (value ? new Date(value).toISOString() : undefined);

/**
 * Everything the Report tab needs for one cloud campaign. Cloud emails carry no tracking code,
 * so this is what the sender's own mailbox shows: sent, replied, bounced.
 */
export async function cloudCampaignReport(projectId: ObjectId, campaignId: string) {
  const collection = await sends();
  const docs = await collection
    .find({ ...(await cloudSendsFilter(projectId, campaignId)), status: "sent" })
    .sort({ sentAt: -1 })
    .limit(5000)
    .toArray();
  const recipients: CloudReportRecipient[] = docs.map((doc) => ({
    row: doc.cloudRow,
    email: doc.email,
    name: doc.fullName,
    company: doc.companyName,
    subject: doc.subjectLine || "",
    sentAt: iso(doc.sentAt),
    repliedAt: iso(doc.repliedAt),
    bouncedAt: iso(doc.bouncedAt),
    bounceReason: doc.bouncedAt ? doc.bounceReason || undefined : undefined,
  }));
  const count = (pick: (r: CloudReportRecipient) => unknown) => recipients.filter((r) => pick(r)).length;
  return {
    totals: {
      sent: recipients.length,
      replied: count((r) => r.repliedAt),
      bounced: count((r) => r.bouncedAt),
    },
    recipients,
  };
}

/** Sent emails that could still get a reply/bounce (for the inbox check). */
export async function cloudSentEmails(projectId: ObjectId, campaignId: string) {
  const collection = await sends();
  const docs = await collection
    .find(
      { ...(await cloudSendsFilter(projectId, campaignId)), status: "sent" },
      { projection: { email: 1, sentAt: 1, subjectLine: 1 } },
    )
    .toArray();
  return docs.map((doc) => ({ email: doc.email, sentAt: doc.sentAt, subject: doc.subjectLine || "" }));
}
