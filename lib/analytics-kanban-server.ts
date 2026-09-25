import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc } from "@/lib/crm";
import type { CampaignKind } from "@/lib/drip-campaigns";
import type { CampaignBlastDoc, CampaignSendDoc } from "@/lib/campaign-blasts-server";
import {
  DEFAULT_KANBAN_STAGES,
  DEFAULT_STAGE_COLOR,
  KANBAN_DOT_COLORS,
  companyBrandLogoUrl,
  companyDomainFromEmail,
  isFreeEmailHost,
  type KanbanBoard,
  type KanbanCampaignRef,
  type KanbanList,
  type KanbanPerson,
  type KanbanStage,
} from "@/lib/analytics-kanban";
import { deriveCompanyDomain } from "@/lib/crm";

const DOT_COLOR_SET = new Set<string>(KANBAN_DOT_COLORS);

function normalizeStageColor(value: unknown) {
  const color = String(value ?? "").trim().toLowerCase();
  return DOT_COLOR_SET.has(color) ? color : DEFAULT_STAGE_COLOR;
}

type KanbanDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  campaigns: KanbanCampaignRef[];
  stages: KanbanStage[];
  placements: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
};

function kindFilter(kind: CampaignKind) {
  return kind === "oneone"
    ? { kind: "oneone" as const }
    : { kind: { $ne: "oneone" as const } };
}

function normalizeStages(value: unknown): KanbanStage[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_KANBAN_STAGES;
  }
  const systemById = new Map(
    DEFAULT_KANBAN_STAGES.map((stage) => [stage.id, stage]),
  );
  const next: KanbanStage[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as KanbanStage;
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    const system = systemById.get(id);
    if (system) {
      next.push(system);
      seen.add(system.id);
      continue;
    }
    if (!name || row.system) {
      continue;
    }
    next.push({ id, name, color: normalizeStageColor(row.color) });
    seen.add(id);
  }
  for (const stage of DEFAULT_KANBAN_STAGES) {
    if (!seen.has(stage.id)) {
      next.push(stage);
    }
  }
  return next.length > 0 ? next : DEFAULT_KANBAN_STAGES;
}

function normalizePlacements(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [email, stageId] of Object.entries(value)) {
    const key = email.trim().toLowerCase();
    const id = String(stageId ?? "").trim();
    if (key && id) {
      next[key] = id;
    }
  }
  return next;
}

function normalizeCampaigns(value: unknown): KanbanCampaignRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Map<string, KanbanCampaignRef>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as KanbanCampaignRef;
    const campaignId = String(row.campaignId ?? "").trim();
    const kind = row.kind === "oneone" ? "oneone" : "drip";
    const name = String(row.name ?? "").trim() || `Campaign ${campaignId}`;
    if (!campaignId) {
      continue;
    }
    unique.set(`${kind}:${campaignId}`, { campaignId, kind, name });
  }
  return [...unique.values()];
}

function mapList(doc: KanbanDoc): KanbanList {
  return {
    id: doc._id.toString(),
    name: doc.name,
    campaigns: Array.isArray(doc.campaigns) ? doc.campaigns : [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function loadPeople(
  projectId: ObjectId,
  campaigns: KanbanCampaignRef[],
): Promise<KanbanPerson[]> {
  const db = await getDb();
  const merged = new Map<
    string,
    {
      id: string;
      email: string;
      fullName: string;
      companyName: string;
      opened: boolean;
      clicked: boolean;
      campaigns: string[];
      lastActivityAt?: string;
    }
  >();

  function activityIso(doc: CampaignSendDoc) {
    const latest = [doc.clickedAt, doc.openedAt, doc.sentAt]
      .map((value) => (value ? new Date(value).getTime() : NaN))
      .filter((value) => Number.isFinite(value));
    if (latest.length === 0) {
      return undefined;
    }
    return new Date(Math.max(...latest)).toISOString();
  }

  function laterIso(left?: string, right?: string) {
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    return left > right ? left : right;
  }

  for (const campaign of campaigns) {
    const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
      projectId,
      campaignId: campaign.campaignId,
      ...kindFilter(campaign.kind),
    });
    const docs = await db
      .collection<CampaignSendDoc>("campaign_sends")
      .find({
        projectId,
        status: "sent",
        ...(blast ? { blastId: blast._id } : { campaignId: campaign.campaignId }),
      })
      .toArray();

    for (const doc of docs) {
      const email = String(doc.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) {
        continue;
      }
      const opened = (doc.openCount ?? 0) > 0 || Boolean(doc.openedAt);
      const clicked =
        !doc.clickBurstIgnored &&
        ((doc.clickCount ?? 0) > 0 || Boolean(doc.clickedAt));
      const current = merged.get(email);
      const lastActivityAt = activityIso(doc);
      if (!current) {
        merged.set(email, {
          id: doc._id.toString(),
          email: doc.email,
          fullName: doc.fullName || doc.email,
          companyName: doc.companyName || "",
          opened,
          clicked,
          campaigns: [campaign.name],
          lastActivityAt,
        });
        continue;
      }
      current.opened = current.opened || opened;
      current.clicked = current.clicked || clicked;
      current.lastActivityAt = laterIso(current.lastActivityAt, lastActivityAt);
      if (!current.campaigns.includes(campaign.name)) {
        current.campaigns.push(campaign.name);
      }
    }
  }

  const emails = [...merged.keys()];
  const contacts =
    emails.length === 0
      ? []
      : await db
          .collection<ContactDoc>("contacts")
          .find({
            projectId,
            $expr: { $in: [{ $toLower: "$email" }, emails] },
          })
          .project({ _id: 1, email: 1, companyName: 1, companyId: 1 })
          .toArray();

  const companyIds = [
    ...new Map(
      contacts
        .filter((contact) => contact.companyId)
        .map((contact) => [contact.companyId!.toString(), contact.companyId!]),
    ).values(),
  ];

  const companyEmails =
    companyIds.length === 0
      ? []
      : await db
          .collection<ContactDoc>("contacts")
          .find({
            projectId,
            companyId: { $in: companyIds },
          })
          .project({ email: 1, companyId: 1 })
          .toArray();

  const emailsByCompanyId = new Map<string, string[]>();
  for (const contact of companyEmails) {
    if (!contact.companyId) {
      continue;
    }
    const key = contact.companyId.toString();
    const list = emailsByCompanyId.get(key) ?? [];
    list.push(contact.email);
    emailsByCompanyId.set(key, list);
  }

  const companyDomainById = new Map<string, string>();
  for (const [companyId, companyMails] of emailsByCompanyId) {
    const corporate = companyMails
      .map((value) => companyDomainFromEmail(value))
      .filter((value): value is string => Boolean(value));
    const domain =
      corporate[0] ||
      deriveCompanyDomain(companyMails).toLowerCase() ||
      "";
    if (domain && !isFreeEmailHost(domain)) {
      companyDomainById.set(companyId, domain);
    }
  }

  const contactByEmail = new Map(
    contacts.map((contact) => [
      contact.email.trim().toLowerCase(),
      {
        id: contact._id.toString(),
        companyName: String(contact.companyName ?? "").trim(),
        companyId: contact.companyId?.toString() ?? "",
      },
    ]),
  );

  return [...merged.values()]
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((person) => {
      const emailKey = person.email.trim().toLowerCase();
      const contact = contactByEmail.get(emailKey);
      const companyName = person.companyName.trim() || contact?.companyName || "";
      const companyDomain =
        (contact?.companyId
          ? companyDomainById.get(contact.companyId)
          : undefined) || companyDomainFromEmail(emailKey);
      return {
        ...person,
        companyName,
        companyDomain,
        companyLogoUrl: companyDomain
          ? companyBrandLogoUrl(companyDomain)
          : undefined,
        delivered: true,
        contactId: contact?.id,
      };
    });
}

export async function listProjectKanbanBoards(
  projectId: ObjectId,
): Promise<KanbanList[]> {
  const db = await getDb();
  const docs = await db
    .collection<KanbanDoc>("analytics_kanban")
    .find({ projectId, name: { $exists: true, $ne: "" } })
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map(mapList);
}

export async function createProjectKanbanBoard(
  projectId: ObjectId,
  input: { name: string; campaigns: KanbanCampaignRef[] },
): Promise<KanbanBoard> {
  const name = input.name.trim();
  const campaigns = normalizeCampaigns(input.campaigns);
  if (!name) {
    throw new Error("List name is required");
  }
  if (campaigns.length === 0) {
    throw new Error("Select at least one sent or running campaign");
  }
  const db = await getDb();
  const now = new Date();
  const doc: KanbanDoc = {
    _id: new ObjectId(),
    projectId,
    name,
    campaigns,
    stages: DEFAULT_KANBAN_STAGES,
    placements: {},
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<KanbanDoc>("analytics_kanban").insertOne(doc);
  const people = await loadPeople(projectId, campaigns);
  return {
    ...mapList(doc),
    stages: doc.stages,
    placements: {},
    people,
  };
}

export async function getProjectKanbanBoard(
  projectId: ObjectId,
  id: string,
): Promise<KanbanBoard | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  const db = await getDb();
  const doc = await db.collection<KanbanDoc>("analytics_kanban").findOne({
    _id: new ObjectId(id),
    projectId,
  });
  if (!doc?.name) {
    return null;
  }
  const people = await loadPeople(projectId, doc.campaigns || []);
  return {
    ...mapList(doc),
    stages: normalizeStages(doc.stages),
    placements: normalizePlacements(doc.placements),
    people,
  };
}

export async function patchProjectKanbanBoard(
  projectId: ObjectId,
  id: string,
  patch: {
    stages?: KanbanStage[];
    placements?: Record<string, string>;
    campaigns?: KanbanCampaignRef[];
  },
): Promise<KanbanBoard | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  const db = await getDb();
  const current = await db.collection<KanbanDoc>("analytics_kanban").findOne({
    _id: new ObjectId(id),
    projectId,
  });
  if (!current?.name) {
    return null;
  }
  const stages =
    patch.stages !== undefined
      ? normalizeStages(patch.stages)
      : normalizeStages(current.stages);
  const placements =
    patch.placements !== undefined
      ? normalizePlacements(patch.placements)
      : normalizePlacements(current.placements);
  const campaigns =
    patch.campaigns !== undefined
      ? normalizeCampaigns(patch.campaigns)
      : current.campaigns || [];
  if (campaigns.length === 0) {
    throw new Error("Select at least one campaign");
  }
  const validIds = new Set(stages.map((stage) => stage.id));
  const cleaned: Record<string, string> = {};
  for (const [email, stageId] of Object.entries(placements)) {
    if (validIds.has(stageId)) {
      cleaned[email] = stageId;
    }
  }

  await db.collection<KanbanDoc>("analytics_kanban").updateOne(
    { _id: current._id, projectId },
    {
      $set: {
        stages,
        placements: cleaned,
        campaigns,
        updatedAt: new Date(),
      },
    },
  );
  const people = await loadPeople(projectId, campaigns);
  return {
    ...mapList({
      ...current,
      campaigns,
      stages,
      placements: cleaned,
      updatedAt: new Date(),
    }),
    stages,
    placements: cleaned,
    people,
  };
}

export async function deleteProjectKanbanBoard(
  projectId: ObjectId,
  id: string,
): Promise<boolean> {
  if (!ObjectId.isValid(id)) {
    return false;
  }
  const db = await getDb();
  const result = await db.collection<KanbanDoc>("analytics_kanban").deleteOne({
    _id: new ObjectId(id),
    projectId,
  });
  return result.deletedCount > 0;
}
