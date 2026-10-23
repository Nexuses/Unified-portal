import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CampaignBlastDoc, CampaignSendDoc } from "@/lib/campaign-blasts-server";
import type { CompanyDoc, ContactDoc, ListDoc } from "@/lib/crm";
import type { DripCampaignDoc } from "@/lib/drip-campaigns-server";
import type { SenderDoc } from "@/lib/smtp-senders";
import {
  formatEngagementDevice,
  isEngagementDevice,
  type EngagementDevice,
} from "@/lib/engagement-client-meta";
import {
  OPEN_PIXEL_BLOCKED_TAG,
  sendOpenPixelBlocked,
} from "@/lib/open-pixel";

export type ActivityFeedType =
  | "campaign_opened"
  | "campaign_clicked"
  | "campaign_launched"
  | "campaign_scheduled"
  | "campaign_created"
  | "list_created"
  | "sender_added"
  | "company_created"
  | "pipeline_created";

export type ActivityFeedGroup =
  | "all"
  | "engagement"
  | "campaigns"
  | "lists"
  | "senders"
  | "pipeline";

export type ActivityFeedKind = "drip" | "oneone";

export type ActivityFeedItem = {
  id: string;
  type: ActivityFeedType;
  at: string;
  title: string;
  description: string;
  email?: string;
  fullName?: string;
  companyName?: string;
  campaignId?: string;
  campaignName?: string;
  campaignKind?: ActivityFeedKind;
  listId?: string;
  listName?: string;
  listDisplayId?: number;
  senderId?: string;
  senderEmail?: string;
  senderName?: string;
  pipelineId?: string;
  pipelineName?: string;
  companyId?: string;
  device?: EngagementDevice;
  deviceLabel?: string;
  ip?: string;
  clickedUrl?: string;
  contactId?: string;
  openTag?: string;
};

export type ActivityFeedResult = {
  items: ActivityFeedItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 40;
const ENGAGE_CAP = 250;
const PLATFORM_CAP = 120;

const GROUP_TYPES: Record<Exclude<ActivityFeedGroup, "all">, ActivityFeedType[]> = {
  engagement: ["campaign_opened", "campaign_clicked"],
  campaigns: ["campaign_created", "campaign_scheduled", "campaign_launched"],
  lists: ["list_created"],
  senders: ["sender_added"],
  pipeline: ["pipeline_created"],
};

function toIso(value?: Date | string | null) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function asDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDevice(value?: string): EngagementDevice | undefined {
  return isEngagementDevice(value) && value !== "unknown" ? value : undefined;
}

function campaignKind(
  kind?: "drip" | "oneone" | string | null,
): ActivityFeedKind {
  return kind === "oneone" ? "oneone" : "drip";
}

function wantedTypes(
  group: ActivityFeedGroup,
  type?: ActivityFeedType | "all",
): Set<ActivityFeedType> | null {
  if (type && type !== "all") {
    return new Set([type]);
  }
  if (group === "all") {
    return null;
  }
  return new Set(GROUP_TYPES[group]);
}

function includesType(
  wanted: Set<ActivityFeedType> | null,
  type: ActivityFeedType,
) {
  return !wanted || wanted.has(type);
}

function matchesQuery(item: ActivityFeedItem, q: string) {
  if (!q) {
    return true;
  }
  const hay = [
    item.title,
    item.description,
    item.email,
    item.fullName,
    item.companyName,
    item.campaignName,
    item.campaignId,
    item.listName,
    item.senderEmail,
    item.senderName,
    item.pipelineName,
    item.clickedUrl,
    item.ip,
    item.deviceLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

async function loadEngagement(
  projectId: ObjectId,
  wanted: Set<ActivityFeedType> | null,
): Promise<ActivityFeedItem[]> {
  if (
    wanted &&
    !wanted.has("campaign_opened") &&
    !wanted.has("campaign_clicked")
  ) {
    return [];
  }

  const db = await getDb();
  const sends = db.collection<CampaignSendDoc>("campaign_sends");

  const openPromise = includesType(wanted, "campaign_opened")
    ? sends
        .find({ projectId, openedAt: { $exists: true } })
        .project({
          email: 1,
          fullName: 1,
          companyName: 1,
          campaignId: 1,
          blastId: 1,
          openedAt: 1,
          openedIp: 1,
          openedDevice: 1,
          openEvents: 1,
          openPixelBlocked: 1,
          clickedAt: 1,
          clickCount: 1,
          clickBurstIgnored: 1,
        })
        .sort({ openedAt: -1 })
        .limit(ENGAGE_CAP)
        .toArray()
    : Promise.resolve([] as CampaignSendDoc[]);

  const clickPromise = includesType(wanted, "campaign_clicked")
    ? sends
        .find({
          projectId,
          clickedAt: { $exists: true },
          clickBurstIgnored: { $ne: true },
        })
        .project({
          email: 1,
          fullName: 1,
          companyName: 1,
          campaignId: 1,
          blastId: 1,
          openedAt: 1,
          openCount: 1,
          openPixelBlocked: 1,
          clickedAt: 1,
          clickedUrl: 1,
          clickedIp: 1,
          clickedDevice: 1,
          clickEvents: 1,
          clickCount: 1,
          clickBurstIgnored: 1,
        })
        .sort({ clickedAt: -1 })
        .limit(ENGAGE_CAP)
        .toArray()
    : Promise.resolve([] as CampaignSendDoc[]);

  const [openSends, clickSends] = await Promise.all([openPromise, clickPromise]);
  const allSends = [...openSends, ...clickSends];
  const blastIds = [
    ...new Set(
      allSends
        .map((send) => send.blastId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const blasts =
    blastIds.length === 0
      ? ([] as Array<Pick<CampaignBlastDoc, "_id" | "name" | "kind" | "campaignId">>)
      : await db
          .collection<CampaignBlastDoc>("campaign_blasts")
          .find({ _id: { $in: blastIds.map((id) => new ObjectId(id)) } })
          .project<Pick<CampaignBlastDoc, "_id" | "name" | "kind" | "campaignId">>({
            name: 1,
            kind: 1,
            campaignId: 1,
          })
          .toArray();
  const blastMap = new Map(blasts.map((blast) => [blast._id.toString(), blast]));

  const emails = [
    ...new Set(
      allSends
        .map((send) => String(send.email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const contacts =
    emails.length === 0
      ? []
      : await db
          .collection<ContactDoc>("contacts")
          .find({ projectId, email: { $in: emails } })
          .project({ _id: 1, email: 1 })
          .toArray();
  const contactByEmail = new Map(
    contacts.map((contact) => [
      contact.email.trim().toLowerCase(),
      contact._id.toString(),
    ]),
  );

  const items: ActivityFeedItem[] = [];

  for (const send of openSends) {
    const blast = blastMap.get(send.blastId?.toString() || "");
    const email = String(send.email || "").trim();
    const campaignName = blast?.name || `Campaign #${send.campaignId}`;
    const kind = campaignKind(blast?.kind);
    const events =
      send.openEvents && send.openEvents.length > 0
        ? send.openEvents
        : send.openedAt
          ? [{ at: send.openedAt, ip: send.openedIp, device: send.openedDevice }]
          : [];

    for (const [index, event] of events.entries()) {
      const at = toIso(event.at);
      if (!at) continue;
      const device = normalizeDevice(event.device || send.openedDevice);
      const name = (send.fullName || email).trim();
      const pixelBlocked =
        Boolean(event.inferredFromClick) || sendOpenPixelBlocked(send);
      items.push({
        id: `open-${send._id.toString()}-${index}-${at}`,
        type: "campaign_opened",
        at,
        title: pixelBlocked ? "Email opened (pixel blocked)" : "Email opened",
        description: pixelBlocked
          ? `${name} opened ${campaignName} (${OPEN_PIXEL_BLOCKED_TAG})`
          : `${name} opened ${campaignName}`,
        email,
        fullName: name,
        companyName: String(send.companyName || "").trim(),
        campaignId: send.campaignId,
        campaignName,
        campaignKind: kind,
        contactId: contactByEmail.get(email.toLowerCase()),
        ...(pixelBlocked ? { openTag: OPEN_PIXEL_BLOCKED_TAG } : {}),
        ...(device ? { device, deviceLabel: formatEngagementDevice(device) } : {}),
        ...((event.ip || send.openedIp) ? { ip: event.ip || send.openedIp } : {}),
      });
    }
  }

  // Historical clicks with no open row yet → still emit an open activity.
  if (includesType(wanted, "campaign_opened")) {
    for (const send of clickSends) {
      if (!sendOpenPixelBlocked(send)) {
        continue;
      }
      if (send.openedAt || (send.openCount ?? 0) > 0) {
        continue;
      }
      const blast = blastMap.get(send.blastId?.toString() || "");
      const email = String(send.email || "").trim();
      const campaignName = blast?.name || `Campaign #${send.campaignId}`;
      const kind = campaignKind(blast?.kind);
      const at = toIso(send.clickedAt);
      if (!at) continue;
      const name = (send.fullName || email).trim();
      const device = normalizeDevice(send.clickedDevice);
      items.push({
        id: `open-inferred-${send._id.toString()}-${at}`,
        type: "campaign_opened",
        at,
        title: "Email opened (pixel blocked)",
        description: `${name} opened ${campaignName} (${OPEN_PIXEL_BLOCKED_TAG})`,
        email,
        fullName: name,
        companyName: String(send.companyName || "").trim(),
        campaignId: send.campaignId,
        campaignName,
        campaignKind: kind,
        contactId: contactByEmail.get(email.toLowerCase()),
        openTag: OPEN_PIXEL_BLOCKED_TAG,
        ...(device ? { device, deviceLabel: formatEngagementDevice(device) } : {}),
        ...(send.clickedIp ? { ip: send.clickedIp } : {}),
      });
    }
  }

  for (const send of clickSends) {
    const blast = blastMap.get(send.blastId?.toString() || "");
    const email = String(send.email || "").trim();
    const campaignName = blast?.name || `Campaign #${send.campaignId}`;
    const kind = campaignKind(blast?.kind);
    type ClickEvent = NonNullable<CampaignSendDoc["clickEvents"]>[number];
    const events: ClickEvent[] =
      send.clickEvents && send.clickEvents.length > 0
        ? send.clickEvents.filter((event: ClickEvent) => !event.ignored)
        : send.clickedAt
          ? [
              {
                url: send.clickedUrl || "",
                at: send.clickedAt,
                ip: send.clickedIp,
                device: send.clickedDevice,
              },
            ]
          : [];

    for (const [index, event] of events.entries()) {
      const at = toIso(event.at);
      if (!at) continue;
      const device = normalizeDevice(event.device || send.clickedDevice);
      const url = (event.url || send.clickedUrl || "").trim();
      const name = (send.fullName || email).trim();
      items.push({
        id: `click-${send._id.toString()}-${index}-${at}`,
        type: "campaign_clicked",
        at,
        title: "Link clicked",
        description: `${name} clicked in ${campaignName}`,
        email,
        fullName: name,
        companyName: String(send.companyName || "").trim(),
        campaignId: send.campaignId,
        campaignName,
        campaignKind: kind,
        contactId: contactByEmail.get(email.toLowerCase()),
        ...(device ? { device, deviceLabel: formatEngagementDevice(device) } : {}),
        ...((event.ip || send.clickedIp) ? { ip: event.ip || send.clickedIp } : {}),
        ...(url ? { clickedUrl: url } : {}),
      });
    }
  }

  return items;
}

async function loadCampaignPlatform(
  projectId: ObjectId,
  wanted: Set<ActivityFeedType> | null,
): Promise<ActivityFeedItem[]> {
  const needCreated = includesType(wanted, "campaign_created");
  const needScheduled = includesType(wanted, "campaign_scheduled");
  const needLaunched = includesType(wanted, "campaign_launched");
  if (!needCreated && !needScheduled && !needLaunched) {
    return [];
  }

  const db = await getDb();
  const items: ActivityFeedItem[] = [];

  if (needCreated || needScheduled) {
    const campaigns = await db
      .collection<DripCampaignDoc>("drip_campaigns")
      .find({ projectId })
      .project({
        campaignId: 1,
        name: 1,
        kind: 1,
        status: 1,
        scheduledAt: 1,
        createdAt: 1,
        tags: 1,
        listName: 1,
      })
      .sort({ createdAt: -1 })
      .limit(PLATFORM_CAP)
      .toArray();

    for (const campaign of campaigns) {
      const kind = campaignKind(campaign.kind);
      const name = campaign.name || `Campaign #${campaign.campaignId}`;
      const createdAt = toIso(campaign.createdAt);
      if (needCreated && createdAt) {
        items.push({
          id: `campaign-created-${campaign._id.toString()}`,
          type: "campaign_created",
          at: createdAt,
          title: "Campaign created",
          description: `${name} was created as a ${kind === "oneone" ? "1-1" : "drip"} campaign`,
          campaignId: campaign.campaignId,
          campaignName: name,
          campaignKind: kind,
          listName: campaign.listName,
        });
      }
      if (
        needScheduled &&
        (campaign.status === "scheduled" || campaign.scheduledAt)
      ) {
        const at = toIso(campaign.scheduledAt) || createdAt;
        if (at) {
          items.push({
            id: `campaign-scheduled-doc-${campaign._id.toString()}`,
            type: "campaign_scheduled",
            at,
            title: "Campaign scheduled",
            description: campaign.scheduledAt
              ? `${name} was scheduled to send`
              : `${name} was marked scheduled`,
            campaignId: campaign.campaignId,
            campaignName: name,
            campaignKind: kind,
            listName: campaign.listName,
          });
        }
      }
    }
  }

  if (needScheduled || needLaunched) {
    const blasts = await db
      .collection<CampaignBlastDoc>("campaign_blasts")
      .find({ projectId })
      .project({
        campaignId: 1,
        name: 1,
        kind: 1,
        status: 1,
        scheduledFor: 1,
        sentAt: 1,
        createdAt: 1,
        recipients: 1,
        listName: 1,
        senderName: 1,
        senderEmail: 1,
        timeline: 1,
      })
      .sort({ createdAt: -1 })
      .limit(PLATFORM_CAP)
      .toArray();

    for (const blast of blasts) {
      const kind = campaignKind(blast.kind);
      const name = blast.name || `Campaign #${blast.campaignId}`;
      const recipients =
        typeof blast.recipients === "number" ? blast.recipients : undefined;

      if (needScheduled) {
        const scheduledEvent = blast.timeline?.find(
          (event: CampaignBlastDoc["timeline"][number]) => event.type === "scheduled",
        );
        const at =
          toIso(scheduledEvent?.at) ||
          toIso(blast.scheduledFor) ||
          (blast.status === "scheduled" ? toIso(blast.createdAt) : "");
        if (at) {
          items.push({
            id: `blast-scheduled-${blast._id.toString()}`,
            type: "campaign_scheduled",
            at,
            title: "Campaign scheduled",
            description: recipients
              ? `${name} was scheduled for ${recipients.toLocaleString()} recipients`
              : `${name} was scheduled`,
            campaignId: blast.campaignId,
            campaignName: name,
            campaignKind: kind,
            listName: blast.listName,
            senderEmail: blast.senderEmail,
            senderName: blast.senderName,
          });
        }
      }

      if (needLaunched && blast.status !== "scheduled") {
        const sentEvent = blast.timeline?.find(
          (event: CampaignBlastDoc["timeline"][number]) => event.type === "sent",
        );
        const at =
          toIso(sentEvent?.at) ||
          toIso(blast.sentAt) ||
          toIso(blast.createdAt);
        if (at) {
          items.push({
            id: `blast-launched-${blast._id.toString()}`,
            type: "campaign_launched",
            at,
            title: "Campaign rolled out",
            description: recipients
              ? `${name} was launched to ${recipients.toLocaleString()} recipients`
              : `${name} was launched`,
            campaignId: blast.campaignId,
            campaignName: name,
            campaignKind: kind,
            listName: blast.listName,
            senderEmail: blast.senderEmail,
            senderName: blast.senderName,
          });
        }
      }
    }
  }

  return items;
}

async function loadCrmPlatform(
  projectId: ObjectId,
  wanted: Set<ActivityFeedType> | null,
): Promise<ActivityFeedItem[]> {
  const db = await getDb();
  const items: ActivityFeedItem[] = [];

  if (includesType(wanted, "list_created")) {
    const lists = await db
      .collection<ListDoc>("lists")
      .find({ projectId })
      .project({ name: 1, displayId: 1, contactCount: 1, importFileName: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(PLATFORM_CAP)
      .toArray();
    for (const list of lists) {
      const at = toIso(list.createdAt);
      if (!at) continue;
      const via = list.importFileName ? ` via ${list.importFileName}` : "";
      items.push({
        id: `list-${list._id.toString()}`,
        type: "list_created",
        at,
        title: "List added",
        description: `List (#${list.displayId}) ${list.name} was added${via}${
          list.contactCount ? ` · ${list.contactCount.toLocaleString()} contacts` : ""
        }`,
        listId: list._id.toString(),
        listName: list.name,
        listDisplayId: list.displayId,
      });
    }
  }

  if (includesType(wanted, "company_created")) {
    const companies = await db
      .collection<CompanyDoc>("companies")
      .find({ projectId })
      .project({ name: 1, contactCount: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(PLATFORM_CAP)
      .toArray();
    for (const company of companies) {
      const at = toIso(company.createdAt);
      if (!at) continue;
      items.push({
        id: `company-${company._id.toString()}`,
        type: "company_created",
        at,
        title: "Company added",
        description: `${company.name} was added${
          company.contactCount
            ? ` · ${company.contactCount.toLocaleString()} contacts`
            : ""
        }`,
        companyId: company._id.toString(),
        companyName: company.name,
      });
    }
  }

  return items;
}

async function loadSenders(
  projectId: ObjectId,
  wanted: Set<ActivityFeedType> | null,
): Promise<ActivityFeedItem[]> {
  if (!includesType(wanted, "sender_added")) {
    return [];
  }
  const db = await getDb();
  const senders = await db
    .collection<SenderDoc>("smtp_senders")
    .find({ projectId })
    .project({ fromEmail: 1, provider: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(PLATFORM_CAP)
    .toArray();

  return senders.flatMap((sender) => {
    const at = toIso(sender.createdAt);
    if (!at) return [];
    return [
      {
        id: `sender-${sender._id.toString()}`,
        type: "sender_added" as const,
        at,
        title: "Sender added",
        description: `${sender.fromEmail} was added as an SMTP sender (${sender.provider})`,
        senderId: sender._id.toString(),
        senderEmail: sender.fromEmail,
      },
    ];
  });
}

async function loadPipelines(
  projectId: ObjectId,
  wanted: Set<ActivityFeedType> | null,
): Promise<ActivityFeedItem[]> {
  if (!includesType(wanted, "pipeline_created")) {
    return [];
  }
  const db = await getDb();
  const boards = await db
    .collection<{ _id: ObjectId; name: string; createdAt: Date }>("analytics_kanban")
    .find({ projectId, name: { $exists: true, $ne: "" } })
    .project({ name: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(PLATFORM_CAP)
    .toArray();

  return boards.flatMap((board) => {
    const at = toIso(board.createdAt);
    if (!at) return [];
    return [
      {
        id: `pipeline-${board._id.toString()}`,
        type: "pipeline_created" as const,
        at,
        title: "Pipeline created",
        description: `Pipeline “${board.name}” was created`,
        pipelineId: board._id.toString(),
        pipelineName: board.name,
      },
    ];
  });
}

export async function getProjectActivityFeed(
  projectId: ObjectId,
  options?: {
    group?: ActivityFeedGroup;
    type?: ActivityFeedType | "all";
    q?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<ActivityFeedResult> {
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(options?.pageSize || DEFAULT_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(options?.page || 1));
  const group = options?.group || "all";
  const type = options?.type || "all";
  const q = (options?.q || "").trim().toLowerCase();
  const wanted = wantedTypes(group, type);

  const [engagement, campaigns, crm, senders, pipelines] = await Promise.all([
    loadEngagement(projectId, wanted),
    loadCampaignPlatform(projectId, wanted),
    loadCrmPlatform(projectId, wanted),
    loadSenders(projectId, wanted),
    loadPipelines(projectId, wanted),
  ]);

  const filtered = [...engagement, ...campaigns, ...crm, ...senders, ...pipelines]
    .filter((item) => matchesQuery(item, q))
    .sort((a, b) => {
      const left = asDate(b.at)?.getTime() ?? 0;
      const right = asDate(a.at)?.getTime() ?? 0;
      if (left !== right) return left - right;
      return a.id.localeCompare(b.id);
    });

  // Deduplicate scheduled events that appear from both drip_campaigns + blasts
  const seen = new Set<string>();
  const deduped = filtered.filter((item) => {
    if (item.type !== "campaign_scheduled" || !item.campaignId) {
      return true;
    }
    const key = `scheduled:${item.campaignId}:${item.at.slice(0, 16)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const total = deduped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: deduped.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}
