import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  CampaignIndividualContact,
  CampaignKind,
  CampaignSequence,
  CampaignStatus,
  DripCampaign,
  RecipientMode,
} from "@/lib/drip-campaigns";
import { createEmptySequence } from "@/lib/drip-campaigns";
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
  kind?: CampaignKind;
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
  shareToken?: string;
  sequences?: CampaignSequence[];
  windowStart?: string;
  windowEnd?: string;
  emailGapMinutes?: number;
  timeline?: DripCampaign["timeline"];
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapCampaign(doc: DripCampaignDoc): DripCampaign {
  return {
    id: doc.campaignId,
    name: doc.name,
    kind: doc.kind === "oneone" ? "oneone" : "drip",
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
    shareToken: doc.shareToken,
    sequences: doc.sequences,
    windowStart: doc.windowStart,
    windowEnd: doc.windowEnd,
    emailGapMinutes: doc.emailGapMinutes,
    timeline: doc.timeline,
  };
}

async function withBlastReport(doc: DripCampaignDoc): Promise<DripCampaign> {
  const campaign = mapCampaign(doc);
  if (campaign.status === "draft" || campaign.status === "paused") {
    return campaign;
  }

  try {
    const reports = await getProjectCampaignReports(doc.projectId);
    const report = reports.find(
      (item) =>
        item.campaignId === doc.campaignId &&
        (item.kind || "drip") === (campaign.kind || "drip"),
    );
    return report ? mergeBlastReport(campaign, report) : campaign;
  } catch {
    return campaign;
  }
}

export function toPublicCampaign(campaign: DripCampaign): DripCampaign {
  return {
    ...campaign,
    senderId: undefined,
    individualContacts: undefined,
    designSourceCampaignId: undefined,
  };
}

function campaignKindFilter(kind?: CampaignKind): Record<string, unknown> {
  if (kind === "oneone") {
    return { kind: "oneone" };
  }
  if (kind === "drip") {
    return { kind: { $ne: "oneone" } };
  }
  return {};
}

async function updateCampaignIdRefs(
  projectId: ObjectId,
  fromId: string,
  toId: string,
  kind: CampaignKind,
) {
  const db = await getDb();
  const kindFilter = campaignKindFilter(kind);
  await db.collection<DripCampaignDoc>("drip_campaigns").updateMany(
    { projectId, campaignId: fromId, ...kindFilter },
    { $set: { campaignId: toId, updatedAt: new Date() } },
  );

  const blasts = await db
    .collection("campaign_blasts")
    .find({ projectId, campaignId: fromId, ...kindFilter })
    .project({ _id: 1 })
    .toArray();
  if (blasts.length === 0) {
    return;
  }

  await db.collection("campaign_blasts").updateMany(
    { _id: { $in: blasts.map((blast) => blast._id) } },
    { $set: { campaignId: toId, updatedAt: new Date() } },
  );
  await db.collection("campaign_sends").updateMany(
    { blastId: { $in: blasts.map((blast) => blast._id) } },
    { $set: { campaignId: toId } },
  );
}

async function resequenceCampaignIds(projectId: ObjectId, kind: CampaignKind) {
  const db = await getDb();
  const docs = await db
    .collection<DripCampaignDoc>("drip_campaigns")
    .find({ projectId, ...campaignKindFilter(kind) })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  if (
    docs.length === 0 ||
    docs.every((doc, index) => doc.campaignId === String(index + 1))
  ) {
    return;
  }

  for (const doc of docs) {
    const tempId = `tmp-${doc._id.toString()}`;
    if (doc.campaignId !== tempId) {
      await updateCampaignIdRefs(projectId, doc.campaignId, tempId, kind);
    }
  }

  for (const [index, doc] of docs.entries()) {
    await updateCampaignIdRefs(
      projectId,
      `tmp-${doc._id.toString()}`,
      String(index + 1),
      kind,
    );
  }
}

async function nextCampaignId(projectId: ObjectId, kind: CampaignKind = "drip") {
  if (kind === "oneone") {
    await resequenceCampaignIds(projectId, "oneone");
  }

  const db = await getDb();
  const latest = await db
    .collection<DripCampaignDoc>("drip_campaigns")
    .find({ projectId, ...campaignKindFilter(kind) })
    .project({ campaignId: 1 })
    .toArray();

  const maxId = latest.reduce(
    (max, doc) => Math.max(max, Number(doc.campaignId) || 0),
    0,
  );
  return String(maxId + 1);
}

export async function listProjectDripCampaigns(
  projectId: ObjectId,
  kind?: CampaignKind,
) {
  if (kind === "oneone") {
    await resequenceCampaignIds(projectId, "oneone");
  }

  const db = await getDb();
  const query: Record<string, unknown> = { projectId, ...campaignKindFilter(kind) };
  const docs = await db
    .collection<DripCampaignDoc>("drip_campaigns")
    .find(query)
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
    const report = reports.find(
      (item) =>
        item.campaignId === campaign.id &&
        (item.kind || "drip") === (campaign.kind || "drip"),
    );
    if (!report || campaign.status === "draft" || campaign.status === "paused") {
      return campaign;
    }
    return mergeBlastReport(campaign, report);
  });
}

export async function getProjectDripCampaign(
  projectId: ObjectId,
  campaignId: string,
  kind?: CampaignKind,
) {
  const db = await getDb();
  const doc = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
    ...campaignKindFilter(kind),
  });
  if (!doc) {
    return null;
  }

  return withBlastReport(doc);
}

export async function getDripCampaignByShareToken(shareToken: string) {
  const token = shareToken.trim();
  if (!token) {
    return null;
  }

  const db = await getDb();
  const doc = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    shareToken: token,
  });
  if (!doc) {
    return null;
  }

  return {
    projectId: doc.projectId,
    campaign: toPublicCampaign(await withBlastReport(doc)),
  };
}

export async function ensureCampaignShareToken(
  projectId: ObjectId,
  campaignId: string,
  kind?: CampaignKind,
) {
  const db = await getDb();
  const existing = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
    ...campaignKindFilter(kind),
  });
  if (!existing) {
    return null;
  }
  if (existing.shareToken) {
    return existing.shareToken;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareToken = randomBytes(18).toString("base64url");
    const taken = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
      shareToken,
    }, { projection: { _id: 1 } });
    if (taken) {
      continue;
    }

    const result = await db.collection<DripCampaignDoc>("drip_campaigns").updateOne(
      { _id: existing._id, shareToken: { $exists: false } },
      { $set: { shareToken, updatedAt: new Date() } },
    );
    if (result.modifiedCount > 0 || result.matchedCount === 0) {
      const fresh = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
        _id: existing._id,
      });
      return fresh?.shareToken ?? shareToken;
    }
  }

  throw new Error("Could not create a share link");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertUniqueCampaignName(
  projectId: ObjectId,
  name: string,
  options?: { excludeCampaignId?: string; kind?: CampaignKind },
) {
  const db = await getDb();
  const query: Record<string, unknown> = {
    projectId,
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...campaignKindFilter(options?.kind),
  };
  if (options?.excludeCampaignId) {
    query.campaignId = { $ne: options.excludeCampaignId };
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
  kind: CampaignKind = "drip",
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Campaign name is required");
  }

  await assertUniqueCampaignName(projectId, trimmed, { kind });

  const db = await getDb();
  const now = new Date();
  const campaignId = await nextCampaignId(projectId, kind);
  const isOneOne = kind === "oneone";

  const doc: DripCampaignDoc = {
    _id: new ObjectId(),
    projectId,
    campaignId,
    name: trimmed,
    kind: isOneOne ? "oneone" : "drip",
    status: "draft",
    tags: [],
    recipients: 0,
    opens: 0,
    clicks: 0,
    unsubscribed: 0,
    conversions: 0,
    ...(isOneOne
      ? {
          sequences: [createEmptySequence(0)],
          windowStart: "09:00",
          windowEnd: "18:00",
          emailGapMinutes: 5,
        }
      : {}),
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
  "sequences",
  "windowStart",
  "windowEnd",
  "emailGapMinutes",
  "timeline",
];

export async function updateProjectDripCampaign(
  projectId: ObjectId,
  campaignId: string,
  patch: Partial<DripCampaign>,
  kind?: CampaignKind,
) {
  const db = await getDb();
  const existing = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
    ...campaignKindFilter(kind),
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
      await assertUniqueCampaignName(projectId, trimmed, {
        excludeCampaignId: campaignId,
        kind: kind ?? (existing.kind === "oneone" ? "oneone" : "drip"),
      });
    }
  }

  await db.collection<DripCampaignDoc>("drip_campaigns").updateOne(
    { _id: existing._id },
    { $set: updates },
  );

  return getProjectDripCampaign(projectId, campaignId, kind ?? (existing.kind === "oneone" ? "oneone" : "drip"));
}

export async function deleteProjectDripCampaign(
  projectId: ObjectId,
  campaignId: string,
  kind?: CampaignKind,
) {
  const db = await getDb();
  const existing = await db.collection<DripCampaignDoc>("drip_campaigns").findOne({
    projectId,
    campaignId,
    ...campaignKindFilter(kind),
  });
  if (!existing) {
    return false;
  }

  const blasts = await db
    .collection("campaign_blasts")
    .find({
      projectId,
      campaignId,
      ...campaignKindFilter(existing.kind === "oneone" ? "oneone" : "drip"),
    })
    .project({ _id: 1 })
    .toArray();
  const blastIds = blasts.map((blast) => blast._id);
  if (blastIds.length > 0) {
    await db.collection("campaign_sends").deleteMany({ blastId: { $in: blastIds } });
    await db.collection("campaign_blasts").deleteMany({ _id: { $in: blastIds } });
  }
  await db.collection<DripCampaignDoc>("drip_campaigns").deleteOne({
    _id: existing._id,
  });

  return true;
}
