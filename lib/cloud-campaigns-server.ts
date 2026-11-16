import { ObjectId, type WithId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CloudColumnMap, CloudColumnStats } from "@/lib/cloud-sheet-csv";
import type {
  CloudCampaign,
  CloudCampaignStatus,
  CloudChromeProfile,
  CloudSendLogEntry,
  CloudSenderProvider,
  CloudSheetSample,
} from "@/lib/cloud-campaigns";
import { cloudMailProductName } from "@/lib/cloud-campaigns";

export type CloudCampaignDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  campaignId: string;
  name: string;
  status: CloudCampaignStatus;
  profileId?: string;
  profileProvider?: CloudSenderProvider;
  profileGmail?: string;
  profileDirectory?: string;
  signatureHtml?: string;
  signatureReady?: boolean;
  customPrompt?: string;
  customPromptReady?: boolean;
  sheetUrl?: string;
  sheetSource?: "csv" | "sheet";
  sheetFileName?: string;
  sheetHeaders?: string[];
  sheetRowCount?: number;
  sheetSamples?: CloudSheetSample[];
  /** Full people rows from CSV (server-only; not mapped to client). */
  sheetRows?: CloudSheetSample[];
  sheetVerifiedAt?: Date;
  computerReady?: boolean;
  gapMinutes: number;
  nextRow: number;
  sentCount: number;
  failedCount: number;
  lastError?: string;
  lastReport?: string;
  sendLog: CloudSendLogEntry[];
  lockPromptId?: string;
  lockConversationId?: string | null;
  /** Row whose script send started but has no definitive outcome yet (duplicate guard). */
  inflightRow?: number;
  /** Which people-list column feeds each email field (user-confirmed). */
  columnMap?: CloudColumnMap;
  columnStats?: CloudColumnStats;
  createdAt: Date;
  updatedAt: Date;
};

export type CloudChromeProfileDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  profileId: string;
  label: string;
  provider?: CloudSenderProvider;
  gmail: string;
  directoryName: string;
  verifiedAt?: Date;
  /** Account signed in to this sender's dedicated script Chrome (no-AI sender). */
  scriptEmail?: string;
  scriptCheckedAt?: Date;
  /** Outlook orgs that require a sensitivity label: the one to apply, and what Outlook offered. */
  sensitivityLabel?: string;
  sensitivityLabels?: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type BoatDesktopLockDoc = {
  _id?: ObjectId;
  projectId: ObjectId;
  campaignId: string;
  campaignName: string;
  lockedAt: Date;
  updatedAt: Date;
};

let indexesReady = false;

async function collections() {
  const db = await getDb();
  const campaigns = db.collection<CloudCampaignDoc>("cloud_campaigns");
  const profiles = db.collection<CloudChromeProfileDoc>("boat_chrome_profiles");
  const locks = db.collection<BoatDesktopLockDoc>("boat_desktop_locks");
  if (!indexesReady) {
    await Promise.all([
      campaigns.createIndex({ projectId: 1, campaignId: 1 }, { unique: true }),
      campaigns.createIndex({ projectId: 1, updatedAt: -1 }),
      profiles.createIndex({ projectId: 1, profileId: 1 }, { unique: true }),
      profiles.createIndex({ projectId: 1, directoryName: 1 }, { unique: true }),
      locks.createIndex({ projectId: 1 }, { unique: true }),
    ]);
    indexesReady = true;
  }
  return { campaigns, profiles, locks };
}

function iso(value?: Date | string | null) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeSheetSamples(value: unknown): CloudSheetSample[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): CloudSheetSample | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (record.cells && typeof record.cells === "object" && !Array.isArray(record.cells)) {
        const cells: Record<string, string> = {};
        for (const [key, cell] of Object.entries(record.cells as Record<string, unknown>)) {
          cells[key] = String(cell ?? "");
        }
        return { cells };
      }
      // Legacy fixed-shape samples → cells map
      const cells: Record<string, string> = {};
      for (const [key, cell] of Object.entries(record)) {
        if (typeof cell === "string" && cell.trim()) cells[key] = cell;
      }
      return Object.keys(cells).length ? { cells } : null;
    })
    .filter((item): item is CloudSheetSample => Boolean(item));
}

function mapCampaign(doc: WithId<CloudCampaignDoc>): CloudCampaign {
  return {
    id: doc.campaignId,
    name: doc.name,
    status: doc.status,
    profileId: doc.profileId,
    profileProvider: doc.profileId
      ? doc.profileProvider === "outlook"
        ? "outlook"
        : "gmail"
      : undefined,
    profileGmail: doc.profileGmail,
    profileDirectory: doc.profileDirectory,
    signatureHtml: doc.signatureHtml || "",
    signatureReady: doc.signatureReady === true,
    customPrompt: doc.customPrompt || "",
    customPromptReady: doc.customPromptReady === true,
    sheetUrl: doc.sheetUrl,
    sheetSource: doc.sheetSource === "csv" ? "csv" : doc.sheetSource === "sheet" ? "sheet" : undefined,
    sheetFileName: doc.sheetFileName,
    sheetHeaders: doc.sheetHeaders,
    columnMap: doc.columnMap,
    columnStats: doc.columnStats,
    sheetRowCount: doc.sheetRowCount,
    sheetSamples: normalizeSheetSamples(doc.sheetSamples),
    sheetVerifiedAt: iso(doc.sheetVerifiedAt),
    computerReady: doc.computerReady === true,
    // Preserve 0 — `Number(x) || 3` incorrectly turns a 0-minute gap into 3.
    gapMinutes: (() => {
      const raw = Number(doc.gapMinutes);
      if (!Number.isFinite(raw)) return 3;
      return Math.max(0, Math.min(120, Math.round(raw)));
    })(),
    nextRow: Math.max(0, Number(doc.nextRow) || 0),
    sentCount: Math.max(0, Number(doc.sentCount) || 0),
    failedCount: Math.max(0, Number(doc.failedCount) || 0),
    lastError: doc.lastError,
    lastReport: doc.lastReport,
    sendLog: Array.isArray(doc.sendLog) ? doc.sendLog : [],
    createdAt: iso(doc.createdAt) || new Date().toISOString(),
    updatedAt: iso(doc.updatedAt) || new Date().toISOString(),
  };
}

function mapProfile(doc: WithId<CloudChromeProfileDoc>): CloudChromeProfile {
  return {
    id: doc.profileId,
    label: doc.label,
    provider: doc.provider === "outlook" ? "outlook" : "gmail",
    gmail: doc.gmail,
    directoryName: doc.directoryName,
    verifiedAt: iso(doc.verifiedAt),
    scriptEmail: doc.scriptEmail || undefined,
    scriptCheckedAt: iso(doc.scriptCheckedAt),
    sensitivityLabel: doc.sensitivityLabel || undefined,
    sensitivityLabels: Array.isArray(doc.sensitivityLabels) ? doc.sensitivityLabels : undefined,
    createdAt: iso(doc.createdAt) || new Date().toISOString(),
  };
}

async function nextCampaignId(projectId: ObjectId) {
  const { campaigns } = await collections();
  const count = await campaigns.countDocuments({ projectId });
  return `cloud-${count + 1}-${Date.now().toString(36)}`;
}

export async function listCloudCampaigns(projectId: ObjectId) {
  const { campaigns } = await collections();
  const docs = await campaigns
    .find({ projectId })
    .sort({ updatedAt: -1 })
    .limit(200)
    .toArray();
  return docs.map(mapCampaign);
}

export async function getCloudCampaign(projectId: ObjectId, campaignId: string) {
  const { campaigns } = await collections();
  const doc = await campaigns.findOne({ projectId, campaignId });
  return doc ? mapCampaign(doc) : null;
}

export async function getCloudCampaignDoc(projectId: ObjectId, campaignId: string) {
  const { campaigns } = await collections();
  return campaigns.findOne({ projectId, campaignId });
}

export async function createCloudCampaign(projectId: ObjectId, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Campaign name is required");
  }
  const { campaigns } = await collections();
  const now = new Date();
  const campaignId = await nextCampaignId(projectId);
  const doc: CloudCampaignDoc = {
    _id: new ObjectId(),
    projectId,
    campaignId,
    name: trimmed,
    status: "draft",
    gapMinutes: 3,
    nextRow: 0,
    sentCount: 0,
    failedCount: 0,
    sendLog: [],
    createdAt: now,
    updatedAt: now,
  };
  await campaigns.insertOne(doc);
  return mapCampaign(doc as WithId<CloudCampaignDoc>);
}

async function nextDuplicateCloudName(projectId: ObjectId, baseName: string) {
  const { campaigns } = await collections();
  const root = baseName.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, "").trim() || baseName;
  const existing = await campaigns
    .find({ projectId }, { projection: { name: 1 } })
    .toArray();
  const names = new Set(existing.map((item) => String(item.name || "").trim().toLowerCase()));
  let candidate = `${root} (copy)`;
  let index = 2;
  while (names.has(candidate.toLowerCase())) {
    candidate = `${root} (copy ${index})`;
    index += 1;
  }
  return candidate;
}

/** Copy setup (sender, signature, sheet, prompt, gap). Fresh send progress. */
export async function duplicateCloudCampaign(projectId: ObjectId, campaignId: string) {
  const existing = await getCloudCampaignDoc(projectId, campaignId);
  if (!existing) {
    throw new Error("Campaign not found");
  }
  const { campaigns } = await collections();
  const now = new Date();
  const newId = await nextCampaignId(projectId);
  const name = await nextDuplicateCloudName(projectId, existing.name);

  const gapRaw = Number(existing.gapMinutes);
  const gapMinutes = Number.isFinite(gapRaw)
    ? Math.max(0, Math.min(120, Math.round(gapRaw)))
    : 3;

  const doc: CloudCampaignDoc = {
    _id: new ObjectId(),
    projectId,
    campaignId: newId,
    name,
    status: "draft",
    profileId: existing.profileId,
    profileProvider: existing.profileProvider,
    profileGmail: existing.profileGmail,
    profileDirectory: existing.profileDirectory,
    signatureHtml: existing.signatureHtml,
    signatureReady: existing.signatureReady === true,
    customPrompt: existing.customPrompt,
    customPromptReady: existing.customPromptReady === true,
    sheetUrl: existing.sheetUrl,
    sheetSource: existing.sheetSource,
    sheetFileName: existing.sheetFileName,
    sheetHeaders: Array.isArray(existing.sheetHeaders)
      ? [...existing.sheetHeaders]
      : undefined,
    sheetRowCount: existing.sheetRowCount,
    sheetSamples: Array.isArray(existing.sheetSamples)
      ? existing.sheetSamples.map((sample) => ({
          cells: { ...(sample.cells || {}) },
        }))
      : undefined,
    sheetRows: Array.isArray(existing.sheetRows)
      ? existing.sheetRows.map((row) => ({
          cells: { ...(row.cells || {}) },
        }))
      : undefined,
    sheetVerifiedAt: existing.sheetVerifiedAt,
    computerReady: existing.computerReady === true,
    gapMinutes,
    nextRow: 0,
    sentCount: 0,
    failedCount: 0,
    sendLog: [],
    lastError: undefined,
    lastReport: `Duplicated from “${existing.name}”.`,
    lockPromptId: undefined,
    lockConversationId: null,
    createdAt: now,
    updatedAt: now,
  };

  const mappedPreview = mapCampaign(doc as WithId<CloudCampaignDoc>);
  doc.status = campaignIsReady(mappedPreview) ? "ready" : "draft";

  await campaigns.insertOne(doc);
  return mapCampaign(doc as WithId<CloudCampaignDoc>);
}

export async function patchCloudCampaignDoc(
  projectId: ObjectId,
  campaignId: string,
  patch: Partial<CloudCampaignDoc>,
) {
  const { campaigns } = await collections();
  const { _id: _ignored, projectId: _p, campaignId: _c, createdAt: _created, ...rest } =
    patch;
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) {
      $unset[key] = "";
    } else {
      $set[key] = value;
    }
  }
  const update: Record<string, unknown> = { $set };
  if (Object.keys($unset).length > 0) {
    update.$unset = $unset;
  }
  const result = await campaigns.findOneAndUpdate(
    { projectId, campaignId },
    update,
    { returnDocument: "after" },
  );
  return result ? mapCampaign(result) : null;
}

export async function deleteCloudCampaign(projectId: ObjectId, campaignId: string) {
  const { campaigns, locks } = await collections();
  await locks.deleteOne({ projectId, campaignId });
  const result = await campaigns.deleteOne({ projectId, campaignId });
  return result.deletedCount > 0;
}

export async function listChromeProfiles(projectId: ObjectId) {
  const { profiles } = await collections();
  const docs = await profiles.find({ projectId }).sort({ createdAt: 1 }).toArray();
  return docs.map(mapProfile);
}

export async function getChromeProfile(projectId: ObjectId, profileId: string) {
  const { profiles } = await collections();
  const doc = await profiles.findOne({ projectId, profileId });
  return doc ? mapProfile(doc) : null;
}

/** Prefer stored inbox email; fall back to a label that looks like an address. */
export function resolveChromeProfileEmail(
  profile: { gmail?: string; label?: string } | null | undefined,
) {
  const gmail = typeof profile?.gmail === "string" ? profile.gmail.trim().toLowerCase() : "";
  if (gmail.includes("@")) return gmail;
  const label = typeof profile?.label === "string" ? profile.label.trim().toLowerCase() : "";
  return label.includes("@") ? label : "";
}

export async function createChromeProfile(
  projectId: ObjectId,
  options?: { label?: string; gmail?: string; provider?: CloudSenderProvider },
) {
  const { profiles } = await collections();
  const provider = options?.provider === "outlook" ? "outlook" : "gmail";
  const product = cloudMailProductName(provider);
  const existing = await profiles.find({ projectId }).toArray();
  const used = new Set(existing.map((item) => item.directoryName));
  let index = 1;
  let directoryName = "Default";
  if (used.has("Default") || existing.length > 0) {
    while (used.has(`Profile ${index}`)) {
      index += 1;
    }
    directoryName = `Profile ${index}`;
  }
  const now = new Date();
  const profileId = new ObjectId().toHexString();
  const gmail = options?.gmail?.trim().toLowerCase() || "";
  const label =
    options?.label?.trim() ||
    (directoryName === "Default" ? `New ${product}` : `New ${product} ${index}`);
  const doc: CloudChromeProfileDoc = {
    _id: new ObjectId(),
    projectId,
    profileId,
    label,
    provider,
    gmail,
    directoryName,
    createdAt: now,
    updatedAt: now,
  };
  await profiles.insertOne(doc);
  return mapProfile(doc as WithId<CloudChromeProfileDoc>);
}

/** Record (or clear) which account the sender's dedicated script Chrome is signed in to. */
export async function markChromeProfileScriptState(
  projectId: ObjectId,
  profileId: string,
  scriptEmail: string | null,
) {
  const { profiles } = await collections();
  const now = new Date();
  const update = scriptEmail
    ? { $set: { scriptEmail: scriptEmail.trim().toLowerCase(), scriptCheckedAt: now, updatedAt: now } }
    : { $set: { scriptCheckedAt: now, updatedAt: now }, $unset: { scriptEmail: "" as const } };
  const result = await profiles.findOneAndUpdate({ projectId, profileId }, update, {
    returnDocument: "after",
  });
  return result ? mapProfile(result) : null;
}

/** Save the chosen Outlook sensitivity label and/or the labels Outlook offered. */
export async function setChromeProfileSensitivity(
  projectId: ObjectId,
  profileId: string,
  input: { label?: string | null; labels?: string[] },
) {
  const { profiles } = await collections();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, ""> = {};
  if (input.label !== undefined) {
    const label = String(input.label || "").trim().slice(0, 80);
    if (label) $set.sensitivityLabel = label;
    else $unset.sensitivityLabel = "";
  }
  if (Array.isArray(input.labels)) {
    $set.sensitivityLabels = input.labels.map((l) => String(l).trim().slice(0, 80)).filter(Boolean).slice(0, 30);
  }
  const update: Record<string, unknown> = { $set };
  if (Object.keys($unset).length) update.$unset = $unset;
  const result = await profiles.findOneAndUpdate({ projectId, profileId }, update, {
    returnDocument: "after",
  });
  return result ? mapProfile(result) : null;
}

export async function markChromeProfileVerified(
  projectId: ObjectId,
  profileId: string,
  gmail: string,
) {
  const { profiles } = await collections();
  const trimmed = gmail.trim().toLowerCase();
  const result = await profiles.findOneAndUpdate(
    { projectId, profileId },
    {
      $set: {
        gmail: trimmed,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  return result ? mapProfile(result) : null;
}

export async function renameChromeProfile(
  projectId: ObjectId,
  profileId: string,
  label: string,
) {
  const trimmed = label.trim().slice(0, 80);
  if (!trimmed) {
    throw new Error("Sender name is required");
  }
  const { profiles } = await collections();
  const result = await profiles.findOneAndUpdate(
    { projectId, profileId },
    {
      $set: {
        label: trimmed,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  return result ? mapProfile(result) : null;
}

export async function deleteChromeProfile(projectId: ObjectId, profileId: string) {
  const { profiles, campaigns, locks } = await collections();
  const profile = await profiles.findOne({ projectId, profileId });
  if (!profile) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const sending = await campaigns.findOne({
    projectId,
    profileId,
    status: "sending",
  });
  if (sending) {
    return { ok: false as const, reason: "in_use_sending" as const };
  }

  const lock = await locks.findOne({ projectId });
  if (lock) {
    const lockedCampaign = await campaigns.findOne({
      projectId,
      campaignId: lock.campaignId,
    });
    if (lockedCampaign?.profileId === profileId) {
      return { ok: false as const, reason: "in_use_sending" as const };
    }
  }

  await profiles.deleteOne({ projectId, profileId });
  await campaigns.updateMany(
    { projectId, profileId },
    {
      $unset: {
        profileId: "",
        profileProvider: "",
        profileGmail: "",
        profileDirectory: "",
      },
      $set: {
        status: "draft",
        updatedAt: new Date(),
        lastError: "Sender profile was deleted. Pick a sender again.",
      },
    },
  );
  return { ok: true as const, reason: "deleted" as const };
}

export async function lockBoatDesktop(
  projectId: ObjectId,
  campaignId: string,
  campaignName: string,
) {
  const { locks } = await collections();
  const now = new Date();
  await locks.updateOne(
    { projectId },
    {
      $set: {
        campaignId,
        campaignName,
        lockedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { projectId },
    },
    { upsert: true },
  );
}

export async function unlockBoatDesktop(projectId: ObjectId, campaignId?: string) {
  const { locks } = await collections();
  if (campaignId) {
    await locks.deleteOne({ projectId, campaignId });
    return;
  }
  await locks.deleteOne({ projectId });
}

export async function getBoatDesktopLock(projectId: ObjectId) {
  const { locks } = await collections();
  const lock = await locks.findOne({ projectId });
  if (!lock) return null;
  return {
    campaignId: lock.campaignId,
    campaignName: lock.campaignName,
    lockedAt: iso(lock.lockedAt),
  };
}

export function campaignIsReady(campaign: CloudCampaign) {
  return Boolean(
    campaign.computerReady &&
      campaign.profileId &&
      campaign.profileDirectory &&
      campaign.profileGmail &&
      campaign.profileGmail.includes("@") &&
      campaign.signatureReady &&
      campaign.sheetVerifiedAt &&
      (campaign.sheetRowCount ?? 0) > 0 &&
      (Boolean(campaign.sheetUrl?.trim()) || campaign.sheetSource === "csv"),
  );
}
