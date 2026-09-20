import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  AutomationEngagement,
  AutomationStatus,
  AutomationStep,
  CreateAutomationInput,
  PatchAutomationInput,
  PortalAutomation,
} from "@/lib/automations";
import {
  mergeBlastReport,
  type CampaignIndividualContact,
  type CampaignKind,
} from "@/lib/drip-campaigns";
import {
  getProjectDripCampaign,
  updateProjectDripCampaign,
} from "@/lib/drip-campaigns-server";
import {
  launchCampaignBlast,
  type CampaignBlastDoc,
  type CampaignSendDoc,
} from "@/lib/campaign-blasts-server";
import { emitWebhookEventBackground } from "@/lib/webhooks-server";

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
  options?: { nonEmptyOnly?: boolean },
): Promise<PortalAutomation[]> {
  const db = await getDb();
  const query: Record<string, unknown> = { projectId };
  if (options?.nonEmptyOnly) {
    query["steps.0"] = { $exists: true };
  }
  const docs = await db
    .collection<AutomationDoc>("automations")
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map(mapAutomation);
}

/** Best-effort cleanup of empty automation shells created before the first step. */
export async function purgeEmptyProjectAutomations(projectId: ObjectId) {
  const db = await getDb();
  await db.collection<AutomationDoc>("automations").deleteMany({
    projectId,
    $or: [{ steps: { $exists: false } }, { steps: { $size: 0 } }],
  });
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
  let name = String(input.name ?? "").trim() || "Untitled automation";

  if (/^untitled automation( \d+)?$/i.test(name)) {
    const existing = await db
      .collection<AutomationDoc>("automations")
      .find(
        {
          projectId,
          name: { $regex: /^untitled automation( \d+)?$/i },
        },
        { projection: { name: 1 } },
      )
      .toArray();

    const existingNames = new Set(
      existing.map((doc) => doc.name.trim().toLowerCase()),
    );
    if (existingNames.has(name.toLowerCase())) {
      let count = 2;
      while (existingNames.has(`untitled automation ${count}`.toLowerCase())) {
        count += 1;
      }
      name = `Untitled automation ${count}`;
    }
  }

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

function blastKindFilter(kind?: CampaignKind) {
  return kind === "oneone"
    ? { kind: "oneone" as const }
    : { kind: { $ne: "oneone" as const } };
}

function resolveStepKind(
  step?: Pick<AutomationStep, "campaignKind"> | null,
  fallback?: CampaignKind,
): CampaignKind {
  if (step?.campaignKind === "oneone" || step?.campaignKind === "drip") {
    return step.campaignKind;
  }
  return fallback === "oneone" ? "oneone" : "drip";
}

function sendMatchesEngagement(
  send: CampaignSendDoc,
  engagement: AutomationEngagement,
) {
  const opened = (send.openCount ?? 0) > 0 || Boolean(send.openedAt);
  const clicked = (send.clickCount ?? 0) > 0 || Boolean(send.clickedAt);
  if (engagement === "opens") {
    return opened;
  }
  if (engagement === "clicks") {
    return clicked;
  }
  return opened || clicked;
}

async function findSourceBlast(
  projectId: ObjectId,
  campaignId: string,
  kind?: CampaignKind,
) {
  const db = await getDb();
  return db.collection<CampaignBlastDoc>("campaign_blasts").findOne(
    {
      projectId,
      campaignId,
      ...blastKindFilter(kind),
    },
    { sort: { updatedAt: -1 } },
  );
}

async function loadEngagers(
  projectId: ObjectId,
  campaignId: string,
  kind: CampaignKind | undefined,
  engagement: AutomationEngagement,
): Promise<CampaignIndividualContact[]> {
  const blast = await findSourceBlast(projectId, campaignId, kind);
  if (!blast) {
    return [];
  }
  const db = await getDb();
  const sends = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({
      projectId,
      blastId: blast._id,
      status: "sent",
    })
    .toArray();

  const unique = new Map<string, CampaignIndividualContact>();
  for (const send of sends) {
    if (!sendMatchesEngagement(send, engagement)) {
      continue;
    }
    const email = String(send.email ?? "")
      .trim()
      .toLowerCase();
    if (!email || unique.has(email)) {
      continue;
    }
    unique.set(email, {
      id: email,
      email,
      fullName: send.fullName?.trim() || email,
    });
  }
  return [...unique.values()];
}

export async function processDueAutomationFollowUps(
  projectId: ObjectId,
  origin: string,
) {
  const db = await getDb();
  const automations = await db
    .collection<AutomationDoc>("automations")
    .find({
      projectId,
      status: { $in: ["running", "scheduled"] },
    })
    .toArray();

  const now = Date.now();
  let launched = 0;

  for (const automation of automations) {
    const steps = Array.isArray(automation.steps) ? automation.steps : [];
    let launchedThisRun = false;
    let pendingFollowUps = 0;

    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index];
      if (!step.campaignId) {
        pendingFollowUps += 1;
        continue;
      }

      const followKind = resolveStepKind(step, automation.kind);
      const followUp = await getProjectDripCampaign(
        projectId,
        step.campaignId,
        followKind,
      );
      if (!followUp) {
        pendingFollowUps += 1;
        continue;
      }
      if (followUp.status !== "draft") {
        if (
          followUp.status !== "sent" &&
          followUp.status !== "sending" &&
          followUp.status !== "scheduled"
        ) {
          pendingFollowUps += 1;
        }
        continue;
      }

      pendingFollowUps += 1;
      const previous = steps[index - 1];
      const whoSource = step.whoSource === "past" ? "past" : "current";
      const sourceId =
        whoSource === "past" ? step.pastCampaignId : previous?.campaignId;
      const sourceKind =
        whoSource === "past"
          ? resolveStepKind(
              { campaignKind: step.pastCampaignKind },
              "drip",
            )
          : resolveStepKind(previous, automation.kind);
      if (!sourceId) {
        continue;
      }

      const sourceBlast = await findSourceBlast(projectId, sourceId, sourceKind);
      if (!sourceBlast || sourceBlast.status !== "sent" || !sourceBlast.sentAt) {
        continue;
      }

      const waitDays = Math.max(0, Number(step.waitDays) || 0);
      const waitHours = Math.max(0, Number(step.waitHours) || 0);
      const readyAt =
        sourceBlast.sentAt.getTime() +
        waitDays * 24 * 60 * 60 * 1000 +
        waitHours * 60 * 60 * 1000;
      if (now < readyAt) {
        continue;
      }

      const engagement: AutomationEngagement =
        step.engagement === "opens" || step.engagement === "clicks"
          ? step.engagement
          : "opens_or_clicks";
      const contacts = await loadEngagers(
        projectId,
        sourceId,
        sourceKind,
        engagement,
      );
      if (contacts.length === 0) {
        continue;
      }

      const claimed = await db.collection("drip_campaigns").findOneAndUpdate(
        {
          projectId,
          campaignId: followUp.id,
          status: "draft",
          ...blastKindFilter(followKind),
        },
        { $set: { status: "sending", updatedAt: new Date() } },
      );
      if (!claimed) {
        continue;
      }

      try {
        const prepared = await updateProjectDripCampaign(
          projectId,
          followUp.id,
          {
            recipientMode: "individual",
            individualContacts: contacts,
            listId: "",
            listName: "",
          },
          followKind,
        );
        if (!prepared) {
          throw new Error("Follow-up campaign not found");
        }

        const report = await launchCampaignBlast({
          projectId,
          campaign: prepared,
          mode: "now",
          origin,
        });
        const launchedCampaign = mergeBlastReport(prepared, report);
        await updateProjectDripCampaign(
          projectId,
          followUp.id,
          launchedCampaign,
          followKind,
        );
        emitWebhookEventBackground({
          projectId,
          type: "campaign.launched",
          data: {
            campaignId: followUp.id,
            kind: followKind,
            name: followUp.name,
            mode: "now",
            status: report.status,
            recipients: report.recipients,
            automationId: automation._id.toString(),
            automationStep: index + 1,
          },
        });
        launched += 1;
        launchedThisRun = true;
        pendingFollowUps -= 1;
      } catch (error) {
        console.error("Failed to launch automation follow-up:", error);
        await db.collection("drip_campaigns").updateOne(
          { projectId, campaignId: followUp.id, ...blastKindFilter(followKind) },
          { $set: { status: "draft", updatedAt: new Date() } },
        );
      }
    }

    const nextStatus: AutomationStatus =
      pendingFollowUps === 0 && steps.length > 1
        ? "completed"
        : launchedThisRun || automation.status === "running"
          ? "running"
          : automation.status;
    if (nextStatus !== automation.status) {
      await db.collection<AutomationDoc>("automations").updateOne(
        { _id: automation._id, projectId },
        { $set: { status: nextStatus, updatedAt: new Date() } },
      );
    }
  }

  return { launched };
}
