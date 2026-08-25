import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  CampaignIndividualContact,
  CampaignStatus,
  DripCampaign,
  RecipientMode,
} from "@/lib/drip-campaigns";
import {
  getProjectCampaignReports,
  type CampaignReport,
} from "@/lib/campaign-blasts-server";
import { mergeBlastReport } from "@/lib/drip-campaigns";

export type DripCampaignDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  campaignId: string;
  name: string;
  status: CampaignStatus;
  scheduledAt?: string;
  sentAt?: string;
  tags: string[];
  recipients: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
  conversions: number;
  delivered?: number;
  senderId?: string;
  senderName?: string;
  senderEmail?: string;
  listId?: string;
  listName?: string;
  recipientMode?: RecipientMode;
  individualContacts?: CampaignIndividualContact[];
  subject?: string;
  previewText?: string;
  hasDesign?: boolean;
  designHtml?: string;
  designSourceCampaignId?: string;
  replyToEnabled?: boolean;
  replyToEmail?: string;
  attachmentEnabled?: boolean;
  attachmentName?: string;
  timezoneEnabled?: boolean;
  timezone?: string;
  listDisplayId?: number;
  timeline?: DripCampaign["timeline"];
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapCampaign(doc: DripCampaignDoc): DripCampaign {
  return {
    id: doc.campaignId,
    name: doc.name,
    status: doc.status,
    scheduledAt: doc.scheduledAt,
    sentAt: doc.sentAt,
    tags: doc.tags ?? [],
    recipients: doc.recipients ?? 0,
    opens: doc.opens ?? 0,
    clicks: doc.clicks ?? 0,
    unsubscribed: doc.unsubscribed ?? 0,
    conversions: doc.conversions ?? 0,
    delivered: doc.delivered,
    senderId: doc.senderId,
    senderName: doc.senderName,
    senderEmail: doc.senderEmail,
    listId: doc.listId,
    listName: doc.listName,
    recipientMode: doc.recipientMode,
    individualContacts: doc.individualContacts,
    subject: doc.subject,
    previewText: doc.previewText,
    hasDesign: doc.hasDesign,
    designHtml: doc.designHtml,
    designSourceCampaignId: doc.designSourceCampaignId,
    replyToEnabled: doc.replyToEnabled,
    replyToEmail: doc.replyToEmail,
    attachmentEnabled: doc.attachmentEnabled,
    attachmentName: doc.attachmentName,
    timezoneEnabled: doc.timezoneEnabled,
    timezone: doc.timezone,
    listDisplayId: doc.listDisplayId,
    timeline: doc.timeline,
  };
}

async function nextCampaignId(projectId: ObjectId) {
  const db = await getDb();
  const latest = await db
    .collection<DripCampaignDoc>("drip_campaigns")
    .find({ projectId })
    .project({ campaignId: 1 })
    .toArray();

  const maxId = latest.reduce(
    (max, doc) => Math.max(max, Number(doc.campaignId) || 0),
    0,
  );
  return String(maxId + 1);
}

export async function listProjectDripCampaigns(projectId: ObjectId) {
  const db = await getDb();
  const docs = await db
    .collection<DripCampaignDoc>("drip_campaigns")
    .find({ projectId })
    .sort({ createdAt: -1 })
    .toArray();

  const campaigns = docs.map(mapCampaign);
  let reports: CampaignReport[] = [];
  try {
    reports = await getProjectCampaignReports(projectId);
  } catch {
    reports = [];
  }

  return campaigns.map((campaign) => {
    const report = reports.find((item) => item.campaignId === campaign.id);
    if (!report || campaign.status === "draft" || campaign.status === "paused") {
      return campaign;
    }
    return mergeBlastReport(campaign, report);
  });
}

export async function getProjectDripCampaign(
  projectId: ObjectId,
  campaignId: string,
) {
  const db = await getDb();
  const doc = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
  });
  if (!doc) {
    return null;
  }

  const campaign = mapCampaign(doc);
  if (campaign.status === "draft" || campaign.status === "paused") {
    return campaign;
  }

  try {
    const reports = await getProjectCampaignReports(projectId);
    const report = reports.find((item) => item.campaignId === campaignId);
    return report ? mergeBlastReport(campaign, report) : campaign;
  } catch {
    return campaign;
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertUniqueCampaignName(
  projectId: ObjectId,
  name: string,
  excludeCampaignId?: string,
) {
  const db = await getDb();
  const query: Record<string, unknown> = {
    projectId,
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  };
  if (excludeCampaignId) {
    query.campaignId = { $ne: excludeCampaignId };
  }

  const conflict = await db
    .collection<DripCampaignDoc>("drip_campaigns")
    .findOne(query, { projection: { _id: 1 } });

  if (conflict) {
    throw new Error("A campaign with this name already exists");
  }
}

export async function createProjectDripCampaign(
  projectId: ObjectId,
  userId: ObjectId | null,
  name: string,
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Campaign name is required");
  }

  await assertUniqueCampaignName(projectId, trimmed);

  const db = await getDb();
  const now = new Date();
  const campaignId = await nextCampaignId(projectId);

  const doc: DripCampaignDoc = {
    _id: new ObjectId(),
    projectId,
    campaignId,
    name: trimmed,
    status: "draft",
    tags: [],
    recipients: 0,
    opens: 0,
    clicks: 0,
    unsubscribed: 0,
    conversions: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<DripCampaignDoc>("drip_campaigns").insertOne(doc);
  return mapCampaign(doc);
}

const PATCHABLE_KEYS: Array<keyof DripCampaign> = [
  "name",
  "status",
  "scheduledAt",
  "sentAt",
  "tags",
  "recipients",
  "opens",
  "clicks",
  "unsubscribed",
  "conversions",
  "delivered",
  "senderId",
  "senderName",
  "senderEmail",
  "listId",
  "listName",
  "recipientMode",
  "individualContacts",
  "subject",
  "previewText",
  "hasDesign",
  "designHtml",
  "designSourceCampaignId",
  "replyToEnabled",
  "replyToEmail",
  "attachmentEnabled",
  "attachmentName",
  "timezoneEnabled",
  "timezone",
  "listDisplayId",
  "timeline",
];

export async function updateProjectDripCampaign(
  projectId: ObjectId,
  campaignId: string,
  patch: Partial<DripCampaign>,
) {
  const db = await getDb();
  const existing = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
  });
  if (!existing) {
    return null;
  }

  const updates: Partial<DripCampaignDoc> = { updatedAt: new Date() };
  for (const key of PATCHABLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) {
      continue;
    }
    const value = patch[key];
    if (value !== undefined) {
      (updates as Record<string, unknown>)[key] = value;
    }
  }

  if (typeof updates.name === "string") {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error("Campaign name is required");
    }
    updates.name = trimmed;
    if (trimmed.toLowerCase() !== existing.name.trim().toLowerCase()) {
      await assertUniqueCampaignName(projectId, trimmed, campaignId);
    }
  }

  await db.collection<DripCampaignDoc>("drip_campaigns").updateOne(
    { projectId, campaignId },
    { $set: updates },
  );

  return getProjectDripCampaign(projectId, campaignId);
}

export async function deleteProjectDripCampaign(
  projectId: ObjectId,
  campaignId: string,
) {
  const db = await getDb();
  const existing = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
  });
  if (!existing) {
    return false;
  }

  await db.collection("campaign_sends").deleteMany({ projectId, campaignId });
  await db.collection("campaign_blasts").deleteMany({ projectId, campaignId });
  await db.collection<DripCampaignDoc>("drip_campaigns").deleteOne({
    projectId,
    campaignId,
  });

  return true;
}
