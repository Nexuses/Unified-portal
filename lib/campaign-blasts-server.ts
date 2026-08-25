import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc, ListDoc, ListMembershipDoc } from "@/lib/crm";
import type { DripCampaign } from "@/lib/drip-campaigns";
import { formatCampaignClock } from "@/lib/drip-campaigns";
import { getSuppressedEmails } from "@/lib/unsubscribe-server";
import { injectCampaignTracking, trackingOrigin } from "@/lib/campaign-tracking";
import { sendProjectMail } from "@/lib/smtp-senders-server";

export type BlastStatus = "scheduled" | "sending" | "sent";

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
  timeline: BlastTimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
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
  status: "pending" | "sent" | "failed";
  error?: string;
  sentAt?: Date;
  openedAt?: Date;
  openCount: number;
  clickedAt?: Date;
  clickCount: number;
  unsubscribedAt?: Date;
};

export type CampaignReport = {
  campaignId: string;
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
  listId?: string;
  listName?: string;
  listDisplayId?: number;
  timeline: BlastTimelineEvent[];
};

const SEND_BATCH = 25;

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

  return text.replace(/\{\{\s*contact\.([A-Za-z]+)\s*\}\}/g, (_, key: string) => {
    const value = values[key.toUpperCase()] ?? "";
    return forHtml ? escapeHtml(value) : value;
  });
}

async function resolveTrackingOrigin(projectId: ObjectId, senderId: string) {
  const db = await getDb();
  const sender = await db.collection("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId,
  });
  return trackingOrigin(
    (sender as { trackingDomain?: string } | null)?.trackingDomain,
  );
}

function mapReport(doc: CampaignBlastDoc): CampaignReport {
  return {
    campaignId: doc.campaignId,
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
    listId: doc.listId,
    listName: doc.listName,
    listDisplayId: doc.listDisplayId,
    timeline: doc.timeline,
  };
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

async function refreshBlastCounts(blastId: ObjectId) {
  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");
  const [delivered, opens, clicks] = await Promise.all([
    sends.countDocuments({ blastId, status: "sent" }),
    sends.countDocuments({ blastId, openCount: { $gt: 0 } }),
    sends.countDocuments({ blastId, clickCount: { $gt: 0 } }),
  ]);

  const pending = await sends.countDocuments({ blastId, status: "pending" });
  const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    _id: blastId,
  });
  if (!blast) {
    return null;
  }

  const now = new Date();
  const nextStatus: BlastStatus =
    pending === 0 ? "sent" : blast.status === "scheduled" ? "scheduled" : "sending";
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
        status: nextStatus,
        sentAt: nextStatus === "sent" ? blast.sentAt ?? now : blast.sentAt,
        timeline,
        updatedAt: now,
      },
    },
  );

  return db.collection<CampaignBlastDoc>("campaign_blasts").findOne({ _id: blastId });
}

async function sendPendingBatch(
  blast: CampaignBlastDoc,
  limit = SEND_BATCH,
) {
  const db = await getDb();
  const trackingBase = await resolveTrackingOrigin(blast.projectId, blast.senderId);
  const pending = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({ blastId: blast._id, status: "pending" })
    .limit(limit)
    .toArray();
  const suppressed = await getSuppressedEmails(blast.projectId);

  for (const send of pending) {
    if (suppressed.has(send.email.trim().toLowerCase())) {
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        { $set: { status: "failed", error: "Unsubscribed" } },
      );
      continue;
    }
    try {
      const personalized = applyContactVariables(blast.html, send, true);
      const html = injectCampaignTracking(personalized, trackingBase, send.token);
      await sendProjectMail(blast.projectId, blast.senderId, {
        to: send.email,
        subject: applyContactVariables(blast.subject, send, false),
        html,
        fromName: blast.senderName,
        replyTo: blast.replyTo,
      });
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        { $set: { status: "sent", sentAt: new Date(), error: undefined } },
      );
    } catch (error) {
      await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
        { _id: send._id },
        {
          $set: {
            status: "failed",
            error: error instanceof Error ? error.message : "Send failed",
          },
        },
      );
    }
  }

  return refreshBlastCounts(blast._id);
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
  if (!campaign.subject?.trim()) {
    throw new Error("Add a subject line first.");
  }
  if (!campaign.designHtml?.trim()) {
    throw new Error("Save an email design first.");
  }

  const recipients = await resolveRecipients(projectId, campaign);
  const unique = new Map(recipients.map((item) => [item.email, item]));
  const suppressed = await getSuppressedEmails(projectId);
  const list = [...unique.values()].filter((item) => !suppressed.has(item.email));
  if (list.length === 0) {
    throw new Error("This campaign has no recipients to send to.");
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
    subject: campaign.subject,
    previewText: campaign.previewText,
    html: campaign.designHtml,
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
    timeline,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<CampaignBlastDoc>("campaign_blasts").deleteMany({
    projectId,
    campaignId: campaign.id,
  });
  await db.collection<CampaignBlastDoc>("campaign_blasts").insertOne(blast);
  const saved = blast;

  await db.collection<CampaignSendDoc>("campaign_sends").deleteMany({
    projectId,
    campaignId: campaign.id,
  });
  await db.collection<CampaignSendDoc>("campaign_sends").insertMany(
    list.map((contact) => ({
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
    latest = { ...saved, status: "sending" };
  }

  return mapReport(latest);
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
    reports.push(mapReport(latest));
  }

  const rest = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({
      projectId,
      campaignId: { $nin: reports.map((item) => item.campaignId) },
    })
    .toArray();

  return [...reports, ...rest.map(mapReport)];
}

export async function getProjectCampaignReports(projectId: ObjectId) {
  const db = await getDb();
  const docs = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({ projectId })
    .toArray();
  return docs.map(mapReport);
}

export async function getCampaignReport(projectId: ObjectId, campaignId: string) {
  const db = await getDb();
  const doc = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    projectId,
    campaignId,
  });
  return doc ? mapReport(doc) : null;
}

export async function recordCampaignOpen(token: string) {
  const db = await getDb();
  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
  if (!send) {
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
  }
}

export async function getCampaignSendByToken(token: string) {
  const db = await getDb();
  return db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
}

export async function recordCampaignClick(token: string) {
  const db = await getDb();
  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({ token });
  if (!send) {
    return;
  }

  const firstClick = !send.clickedAt;
  await db.collection<CampaignSendDoc>("campaign_sends").updateOne(
    { _id: send._id },
    {
      $inc: { clickCount: 1 },
      $set: { clickedAt: send.clickedAt ?? new Date() },
    },
  );
  if (firstClick) {
    await db.collection<CampaignBlastDoc>("campaign_blasts").updateOne(
      { _id: send.blastId },
      { $inc: { clicks: 1 }, $set: { updatedAt: new Date() } },
    );
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
