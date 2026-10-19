import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  analyticsShareExpiresAt,
  isAnalyticsShareExpired,
  resolveAnalyticsShareExpiry,
} from "@/lib/analytics";
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
  isKanbanStageRule,
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
      next.push({
        ...system,
        // Keep default stages editable by name; rule/color stay system defaults.
        name: (name || system.name).slice(0, 40),
      });
      seen.add(system.id);
      continue;
    }
    if (!name || row.system) {
      continue;
    }
    next.push({
      id,
      name: name.slice(0, 40),
      color: normalizeStageColor(row.color),
      ...(isKanbanStageRule(row.rule) ? { rule: row.rule } : {}),
    });
    seen.add(id);
  }
  // Older boards always carry the three default stages; boards built with
  // custom stages do not.
  if (next.some((stage) => stage.system)) {
    for (const stage of DEFAULT_KANBAN_STAGES) {
      if (!seen.has(stage.id)) {
        next.push(stage);
      }
    }
  }
  return next.length > 0 ? next : DEFAULT_KANBAN_STAGES;
}

function stagesFromSetup(value: unknown): KanbanStage[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_KANBAN_STAGES;
  }
  const usedRules = new Set<string>();
  const usedNames = new Set<string>();
  const stages: KanbanStage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Partial<KanbanStage>;
    const name = String(row.name ?? "").trim().slice(0, 40);
    if (!name || !isKanbanStageRule(row.rule)) {
      throw new Error("Each stage needs a name and a trigger");
    }
    if (usedRules.has(row.rule)) {
      throw new Error("Each trigger can only be used by one stage");
    }
    if (usedNames.has(name.toLowerCase())) {
      throw new Error(`Stage "${name}" is listed twice`);
    }
    usedRules.add(row.rule);
    usedNames.add(name.toLowerCase());
    stages.push({
      id: `stage-${new ObjectId().toString().slice(-8)}`,
      name,
      color: normalizeStageColor(row.color),
      rule: row.rule,
    });
  }
  return stages.length > 0 ? stages : DEFAULT_KANBAN_STAGES;
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

let kanbanIndexesPromise: Promise<void> | null = null;

function ensureKanbanIndexes() {
  if (!kanbanIndexesPromise) {
    kanbanIndexesPromise = (async () => {
      const db = await getDb();
      await Promise.all([
        db.collection("contacts").createIndex(
          { projectId: 1, email: 1 },
          { name: "contacts_project_email", background: true },
        ),
        db.collection("contacts").createIndex(
          { projectId: 1, companyId: 1 },
          { name: "contacts_project_company", background: true },
        ),
        db.collection("campaign_sends").createIndex(
          { blastId: 1, status: 1 },
          { name: "sends_blast_status", background: true },
        ),
      ]);
    })().catch((error) => {
      console.error("Failed to ensure kanban indexes:", error);
    });
  }
  return kanbanIndexesPromise;
}

const PEOPLE_FRESH_MS = 2 * 60 * 1000;
const PEOPLE_CACHE_MAX = 40_000;

type PeopleCacheEntry = { people: KanbanPerson[]; computedAt: number };
type PeopleCacheState = {
  memory: Map<string, PeopleCacheEntry>;
  inflight: Map<string, Promise<KanbanPerson[]>>;
};

const peopleCacheGlobal = globalThis as typeof globalThis & {
  __kanbanPeopleCache?: PeopleCacheState;
};
const peopleCache: PeopleCacheState = (peopleCacheGlobal.__kanbanPeopleCache ??= {
  memory: new Map(),
  inflight: new Map(),
});

function peopleCacheKey(projectId: ObjectId, campaigns: KanbanCampaignRef[]) {
  const ids = campaigns
    .map((campaign) => `${campaign.kind}:${campaign.campaignId}:${campaign.name}`)
    .sort();
  return `${projectId.toString()}|${ids.join(",")}`;
}

function rebuildPeople(
  projectId: ObjectId,
  campaigns: KanbanCampaignRef[],
  key: string,
) {
  const running = peopleCache.inflight.get(key);
  if (running) {
    return running;
  }
  const task = (async () => {
    const people = await loadPeople(projectId, campaigns);
    const entry = { people, computedAt: Date.now() };
    peopleCache.memory.delete(key);
    peopleCache.memory.set(key, entry);
    while (peopleCache.memory.size > 30) {
      const oldest = peopleCache.memory.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      peopleCache.memory.delete(oldest);
    }
    if (people.length <= PEOPLE_CACHE_MAX) {
      const db = await getDb();
      await db
        .collection<{ _id: string; people: KanbanPerson[]; computedAt: Date }>(
          "analytics_kanban_people_cache",
        )
        .updateOne(
          { _id: key },
          { $set: { people, computedAt: new Date(entry.computedAt) } },
          { upsert: true },
        )
        .catch((error) => console.error("Failed to cache kanban people:", error));
    }
    return people;
  })().finally(() => {
    peopleCache.inflight.delete(key);
  });
  peopleCache.inflight.set(key, task);
  return task;
}

/** Serve cached board people; refresh in the background once stale. */
async function loadPeopleCached(projectId: ObjectId, campaigns: KanbanCampaignRef[]) {
  if (campaigns.length === 0) {
    return [];
  }
  const key = peopleCacheKey(projectId, campaigns);
  let entry = peopleCache.memory.get(key);
  if (!entry) {
    const db = await getDb();
    const stored = await db
      .collection<{ _id: string; people: KanbanPerson[]; computedAt: Date }>(
        "analytics_kanban_people_cache",
      )
      .findOne({ _id: key });
    if (stored && Array.isArray(stored.people)) {
      entry = { people: stored.people, computedAt: stored.computedAt.getTime() };
      peopleCache.memory.set(key, entry);
    }
  }
  if (!entry) {
    return rebuildPeople(projectId, campaigns, key);
  }
  if (Date.now() - entry.computedAt > PEOPLE_FRESH_MS) {
    void rebuildPeople(projectId, campaigns, key).catch((error) =>
      console.error("Failed to refresh kanban people:", error),
    );
  }
  return entry.people;
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
      replied: boolean;
      campaigns: string[];
      lastActivityAt?: string;
    }
  >();

  function activityIso(doc: CampaignSendDoc) {
    const latest = [doc.repliedAt, doc.clickedAt, doc.openedAt, doc.sentAt]
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

  void ensureKanbanIndexes();
  const sendsByCampaign = await Promise.all(
    campaigns.map(async (campaign) => {
      const blast = await db
        .collection<CampaignBlastDoc>("campaign_blasts")
        .findOne(
          {
            projectId,
            campaignId: campaign.campaignId,
            ...kindFilter(campaign.kind),
          },
          { projection: { _id: 1 } },
        );
      const docs = (await db
        .collection<CampaignSendDoc>("campaign_sends")
        .find({
          projectId,
          status: "sent",
          ...(blast ? { blastId: blast._id } : { campaignId: campaign.campaignId }),
        })
        .project({
          email: 1,
          fullName: 1,
          companyName: 1,
          openCount: 1,
          openedAt: 1,
          clickCount: 1,
          clickedAt: 1,
          clickBurstIgnored: 1,
          sentAt: 1,
          repliedAt: 1,
        })
        .toArray()) as CampaignSendDoc[];
      return { campaign, docs };
    }),
  );

  for (const { campaign, docs } of sendsByCampaign) {
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
      const replied = Boolean(doc.repliedAt);
      const lastActivityAt = activityIso(doc);
      if (!current) {
        merged.set(email, {
          id: doc._id.toString(),
          email: doc.email,
          fullName: doc.fullName || doc.email,
          companyName: doc.companyName || "",
          opened,
          clicked,
          replied,
          campaigns: [campaign.name],
          lastActivityAt,
        });
        continue;
      }
      current.opened = current.opened || opened;
      current.clicked = current.clicked || clicked;
      current.replied = current.replied || replied;
      current.lastActivityAt = laterIso(current.lastActivityAt, lastActivityAt);
      if (!current.campaigns.includes(campaign.name)) {
        current.campaigns.push(campaign.name);
      }
    }
  }

  const emails = [
    ...new Set(
      [...merged.values()].flatMap((person) => [
        person.email,
        person.email.trim().toLowerCase(),
      ]),
    ),
  ];
  const contacts =
    emails.length === 0
      ? []
      : await db
          .collection<ContactDoc>("contacts")
          .find({ projectId, email: { $in: emails } })
          .project({ _id: 1, email: 1, companyName: 1, companyId: 1 })
          .toArray();

  const companyIds = [
    ...new Map(
      contacts
        .filter(
          (contact) =>
            contact.companyId && !companyDomainFromEmail(String(contact.email ?? "")),
        )
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
        companyDomainFromEmail(emailKey) ||
        (contact?.companyId ? companyDomainById.get(contact.companyId) : undefined);
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
  input: { name: string; campaigns: KanbanCampaignRef[]; stages?: unknown },
): Promise<KanbanBoard> {
  const name = input.name.trim();
  const campaigns = normalizeCampaigns(input.campaigns);
  if (!name) {
    throw new Error("List name is required");
  }
  if (campaigns.length === 0) {
    throw new Error("Select at least one sent or running campaign");
  }
  const stages = stagesFromSetup(input.stages);
  const db = await getDb();
  const now = new Date();
  const doc: KanbanDoc = {
    _id: new ObjectId(),
    projectId,
    name,
    campaigns,
    stages,
    placements: {},
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<KanbanDoc>("analytics_kanban").insertOne(doc);
  const people = await loadPeopleCached(projectId, campaigns);
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
  const people = await loadPeopleCached(projectId, doc.campaigns || []);
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
  options?: { skipPeople?: boolean },
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
  const people = options?.skipPeople ? [] : await loadPeopleCached(projectId, campaigns);
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

export type KanbanShareDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  boardId: ObjectId;
  token: string;
  projectName: string;
  createdBy: ObjectId | null;
  createdAt: Date;
  expiresAt: Date;
};

/** Reuses the board's live public link, or creates one that expires like analytics reports. */
export async function createKanbanShare(
  projectId: ObjectId,
  boardId: string,
  projectName: string,
  userId: ObjectId | null,
): Promise<KanbanShareDoc | null> {
  if (!ObjectId.isValid(boardId)) {
    return null;
  }
  const db = await getDb();
  const board = await db
    .collection<KanbanDoc>("analytics_kanban")
    .findOne({ _id: new ObjectId(boardId), projectId }, { projection: { name: 1 } });
  if (!board?.name) {
    return null;
  }
  const shares = db.collection<KanbanShareDoc>("analytics_kanban_shares");
  void shares.createIndex({ token: 1 }, { unique: true, background: true }).catch(() => {});
  const existing = (
    await shares.find({ projectId, boardId: board._id }).sort({ createdAt: -1 }).toArray()
  ).find((share) => !isAnalyticsShareExpired(share));
  if (existing) {
    return existing;
  }
  const createdAt = new Date();
  const doc: KanbanShareDoc = {
    _id: new ObjectId(),
    projectId,
    boardId: board._id,
    token: randomBytes(18).toString("base64url"),
    projectName,
    createdBy: userId,
    createdAt,
    expiresAt: analyticsShareExpiresAt(createdAt),
  };
  await shares.insertOne(doc);
  return doc;
}

export async function findKanbanShareByToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const db = await getDb();
  return db.collection<KanbanShareDoc>("analytics_kanban_shares").findOne({ token: trimmed });
}

export function kanbanShareExpiresAt(share: KanbanShareDoc) {
  return resolveAnalyticsShareExpiry(share);
}

/** Board for a public link, without contact ids so the page never links into the portal. */
export async function getSharedKanbanBoard(share: KanbanShareDoc): Promise<KanbanBoard | null> {
  if (isAnalyticsShareExpired(share)) {
    return null;
  }
  const board = await getProjectKanbanBoard(share.projectId, share.boardId.toString());
  if (!board) {
    return null;
  }
  return {
    ...board,
    people: board.people.map((person) => ({ ...person, contactId: undefined })),
  };
}

/** Card moves from a public link; stages and campaigns stay owner-only. */
export async function moveSharedKanbanCards(
  share: KanbanShareDoc,
  placements: Record<string, string>,
): Promise<Record<string, string> | null> {
  if (isAnalyticsShareExpired(share)) {
    return null;
  }
  const board = await patchProjectKanbanBoard(
    share.projectId,
    share.boardId.toString(),
    { placements },
    { skipPeople: true },
  );
  return board?.placements ?? null;
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
