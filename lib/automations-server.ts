import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  AutomationStatus,
  AutomationStep,
  CreateAutomationInput,
  PatchAutomationInput,
  PortalAutomation,
} from "@/lib/automations";
import type { CampaignKind } from "@/lib/drip-campaigns";

export type AutomationDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  kind: CampaignKind;
  status: AutomationStatus;
  steps: AutomationStep[];
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapAutomation(doc: AutomationDoc): PortalAutomation {
  return {
    id: doc._id.toString(),
    name: doc.name,
    kind: doc.kind === "oneone" ? "oneone" : "drip",
    status: doc.status || "draft",
    steps: Array.isArray(doc.steps) ? doc.steps : [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function parseKind(value: unknown): CampaignKind {
  return value === "oneone" ? "oneone" : "drip";
}

function parseStatus(value: unknown): AutomationStatus {
  if (
    value === "scheduled" ||
    value === "running" ||
    value === "completed" ||
    value === "draft"
  ) {
    return value;
  }
  return "draft";
}

export async function listProjectAutomations(
  projectId: ObjectId,
): Promise<PortalAutomation[]> {
  const db = await getDb();
  const docs = await db
    .collection<AutomationDoc>("automations")
    .find({ projectId })
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map(mapAutomation);
}

export async function getProjectAutomation(
  projectId: ObjectId,
  id: string,
): Promise<PortalAutomation | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  const db = await getDb();
  const doc = await db.collection<AutomationDoc>("automations").findOne({
    _id: new ObjectId(id),
    projectId,
  });
  return doc ? mapAutomation(doc) : null;
}

export async function createProjectAutomation(
  projectId: ObjectId,
  createdBy: ObjectId | null,
  input: CreateAutomationInput = {},
): Promise<PortalAutomation> {
  const db = await getDb();
  const now = new Date();
  const name = String(input.name ?? "").trim() || "Untitled automation";
  const doc: AutomationDoc = {
    _id: new ObjectId(),
    projectId,
    name,
    kind: parseKind(input.kind),
    status: parseStatus(input.status),
    steps: Array.isArray(input.steps) ? input.steps : [],
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<AutomationDoc>("automations").insertOne(doc);
  return mapAutomation(doc);
}

export async function patchProjectAutomation(
  projectId: ObjectId,
  id: string,
  patch: PatchAutomationInput,
): Promise<PortalAutomation | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  const db = await getDb();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.name === "string") {
    const name = patch.name.trim();
    if (!name) {
      throw new Error("Automation name is required");
    }
    $set.name = name;
  }
  if (patch.kind !== undefined) {
    $set.kind = parseKind(patch.kind);
  }
  if (patch.status !== undefined) {
    $set.status = parseStatus(patch.status);
  }
  if (patch.steps !== undefined) {
    if (!Array.isArray(patch.steps)) {
      throw new Error("Invalid steps");
    }
    $set.steps = patch.steps;
  }

  const result = await db.collection<AutomationDoc>("automations").findOneAndUpdate(
    { _id: new ObjectId(id), projectId },
    { $set },
    { returnDocument: "after" },
  );
  return result ? mapAutomation(result) : null;
}

export async function deleteProjectAutomation(
  projectId: ObjectId,
  id: string,
): Promise<boolean> {
  if (!ObjectId.isValid(id)) {
    return false;
  }
  const db = await getDb();
  const result = await db.collection<AutomationDoc>("automations").deleteOne({
    _id: new ObjectId(id),
    projectId,
  });
  return result.deletedCount > 0;
}
