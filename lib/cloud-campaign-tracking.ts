import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";
import { injectCampaignTracking, resolveUsableTrackingOrigin } from "@/lib/campaign-tracking";

/**
 * Cloud campaign sends are recorded in the shared `campaign_sends` collection so the existing
 * open / click / unsubscribe routes, webhooks and activity feed work for them unchanged.
 * Cloud rows are marked with `cloudRow` (the people-list row) and `source: "cloud"`.
 */
type CloudSendDoc = CampaignSendDoc & { cloudRow: number; source: "cloud" };

async function sends() {
  const db = await getDb();
  return db.collection<CloudSendDoc>("campaign_sends");
}

export type CloudTrackingOptions = {
  trackOpens: boolean;
  trackClicks: boolean;
  unsubscribeFooter: boolean;
};

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

/** Add the open pixel / tracked links / unsubscribe footer the campaign asked for. */
export async function trackCloudHtml(
  html: string,
  token: string,
  options: CloudTrackingOptions,
  campaignName: string,
) {
  if (!options.trackOpens && !options.trackClicks && !options.unsubscribeFooter) return html;
  const origin = await resolveUsableTrackingOrigin(null);
  return injectCampaignTracking(html, origin, token, {
    campaignName,
    trackOpens: options.trackOpens,
    trackClicks: options.trackClicks,
    autoUnsubscribeFooter: options.unsubscribeFooter,
  });
}

export async function markCloudSendSent(sendId: ObjectId) {
  const collection = await sends();
  await collection.updateOne(
    { _id: sendId },
    { $set: { status: "sent", sentAt: new Date() } },
  );
}

/** Nothing went out: drop the record so it never shows in the report. */
export async function discardCloudSend(sendId: ObjectId) {
  const collection = await sends();
  await collection.deleteOne({ _id: sendId, status: "sending" });
}

export async function deleteCloudSends(projectId: ObjectId, campaignId: string) {
  const collection = await sends();
  await collection.deleteMany({ projectId, campaignId, source: "cloud" });
}

/** Mark replies / bounces found in the sender's inbox. Returns how many were new. */
export async function recordCloudInboxEvents(
  projectId: ObjectId,
  campaignId: string,
  events: { replied: string[]; bounced: string[] },
) {
  const collection = await sends();
  const now = new Date();
  const replied = events.replied.map((e) => e.toLowerCase());
  const bounced = events.bounced.map((e) => e.toLowerCase());
  const r = replied.length
    ? await collection.updateMany(
        { projectId, campaignId, source: "cloud", status: "sent", email: { $in: replied }, repliedAt: { $exists: false } },
        { $set: { repliedAt: now } },
      )
    : { modifiedCount: 0 };
  const b = bounced.length
    ? await collection.updateMany(
        { projectId, campaignId, source: "cloud", status: "sent", email: { $in: bounced }, bouncedAt: { $exists: false } },
        { $set: { bouncedAt: now } },
      )
    : { modifiedCount: 0 };
  return { replied: r.modifiedCount, bounced: b.modifiedCount };
}

export type CloudReportRecipient = {
  row: number;
  email: string;
  name: string;
  company: string;
  subject: string;
  sentAt?: string;
  openedAt?: string;
  openCount: number;
  clickedAt?: string;
  clickCount: number;
  repliedAt?: string;
  bouncedAt?: string;
  unsubscribedAt?: string;
  botOpen?: boolean;
  /** Clicks made by link scanners (hidden trap link or a burst of clicks). Not counted as clicks. */
  botClicks: number;
};

const iso = (value?: Date) => (value ? new Date(value).toISOString() : undefined);

/** Everything the Report tab needs for one cloud campaign. */
export async function cloudCampaignReport(projectId: ObjectId, campaignId: string) {
  const collection = await sends();
  const docs = await collection
    .find({ projectId, campaignId, source: "cloud", status: "sent" })
    .sort({ sentAt: -1 })
    .limit(5000)
    .toArray();
  const recipients: CloudReportRecipient[] = docs.map((doc) => {
    // Human clicks only: the hidden trap link and scanner bursts are tagged `bot` / `ignored`.
    const events = doc.clickEvents || [];
    const humanEvents = events.filter((e) => !e.bot && !e.ignored);
    const botClicks = events.filter((e) => e.bot || e.ignored).length;
    const humanClick = events.length ? humanEvents.length > 0 : Boolean(doc.clickedAt);
    return {
    row: doc.cloudRow,
    email: doc.email,
    name: doc.fullName,
    company: doc.companyName,
    subject: doc.subjectLine || "",
    sentAt: iso(doc.sentAt),
    openedAt: doc.botOpen ? undefined : iso(doc.openedAt),
    openCount: doc.botOpen ? 0 : doc.openCount || 0,
    clickedAt: humanClick ? iso(humanEvents[0]?.at || doc.clickedAt) : undefined,
    clickCount: humanClick ? (events.length ? humanEvents.length : doc.clickCount || 0) : 0,
    botClicks,
    repliedAt: iso(doc.repliedAt),
    bouncedAt: iso(doc.bouncedAt),
    unsubscribedAt: iso(doc.unsubscribedAt),
    botOpen: doc.botOpen,
    };
  });
  const count = (pick: (r: CloudReportRecipient) => unknown) => recipients.filter((r) => pick(r)).length;
  return {
    totals: {
      sent: recipients.length,
      opened: count((r) => r.openedAt),
      clicked: count((r) => r.clickedAt),
      replied: count((r) => r.repliedAt),
      bounced: count((r) => r.bouncedAt),
      unsubscribed: count((r) => r.unsubscribedAt),
      botClicked: count((r) => r.botClicks > 0),
    },
    recipients,
  };
}

/** Sent emails that could still get a reply/bounce (for the inbox check). */
export async function cloudSentEmails(projectId: ObjectId, campaignId: string) {
  const collection = await sends();
  const docs = await collection
    .find(
      { projectId, campaignId, source: "cloud", status: "sent" },
      { projection: { email: 1, sentAt: 1, subjectLine: 1 } },
    )
    .toArray();
  return docs.map((doc) => ({ email: doc.email, sentAt: doc.sentAt, subject: doc.subjectLine || "" }));
}
