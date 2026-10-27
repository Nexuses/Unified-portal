import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  analyticsRangeIso,
  analyticsShareExpiresAt,
  isAnalyticsShareExpired,
  resolveAnalyticsShareExpiry,
  type AnalyticsCampaignRow,
  type AnalyticsDashboard,
  type AnalyticsDailyPoint,
  type AnalyticsKindStats,
} from "@/lib/analytics";
import {
  sendHasCountableClick,
  type CampaignBlastDoc,
  type CampaignSendDoc,
} from "@/lib/campaign-blasts-server";
import { sendCountsAsOpen } from "@/lib/open-pixel";
import { sendIsBotOnlyOpen } from "@/lib/bot-open";
import { sendHasHumanClick } from "@/lib/bot-click";
import type { ContactDoc } from "@/lib/crm";
import type { AutomationDoc } from "@/lib/automations-server";
import { ensureCampaignShareTokens } from "@/lib/drip-campaigns-server";

export type AnalyticsShareDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  token: string;
  from: string;
  to: string;
  projectName: string;
  createdBy: ObjectId | null;
  createdAt: Date;
  expiresAt?: Date;
  /** When true, linked public campaign reports hide bot clicks / tags. */
  hideBotClicks?: boolean;
};

const DASHBOARD_CACHE_TTL_MS = 45_000;

type DashboardCacheEntry = {
  expiresAt: number;
  value: AnalyticsDashboard;
};

const dashboardCache = new Map<string, DashboardCacheEntry>();

let analyticsIndexesPromise: Promise<void> | null = null;

function emptyKind(): AnalyticsKindStats {
  return { delivered: 0, opens: 0, clicks: 0, unsubscribed: 0 };
}

function eachDay(from: Date, to: Date) {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function dashboardCacheKey(
  projectId: ObjectId,
  fromInput: string,
  toInput: string,
  withShareTokens: boolean,
) {
  // v2: unique-contact counts aligned with campaign report (bots hidden).
  return `${projectId.toString()}|v2|${fromInput}|${toInput}|${withShareTokens ? "1" : "0"}`;
}

/** Match portal campaign report default (Show bot opens/clicks off). */
function sendCountsAsReportOpen(send: CampaignSendDoc) {
  return sendCountsAsOpen(send) && !sendIsBotOnlyOpen(send);
}

function sendCountsAsReportClick(send: CampaignSendDoc) {
  if (!sendHasCountableClick(send)) {
    return false;
  }
  return sendHasHumanClick(send);
}

function utcDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

type UniqueBucket = {
  delivered: Set<string>;
  opens: Set<string>;
  clicks: Set<string>;
  unsubscribed: Set<string>;
  sentAt?: Date;
  campaignId?: string;
};

function emptyUniqueBucket(): UniqueBucket {
  return {
    delivered: new Set(),
    opens: new Set(),
    clicks: new Set(),
    unsubscribed: new Set(),
  };
}

function readDashboardCache(key: string) {
  const entry = dashboardCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    dashboardCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeDashboardCache(key: string, value: AnalyticsDashboard) {
  dashboardCache.set(key, {
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
    value,
  });
}

async function ensureAnalyticsIndexes() {
  if (!analyticsIndexesPromise) {
    analyticsIndexesPromise = (async () => {
      const db = await getDb();
      await Promise.all([
        db.collection("campaign_sends").createIndex(
          { projectId: 1, status: 1, sentAt: 1 },
          { name: "analytics_sends_project_status_sentAt", background: true },
        ),
        db.collection("campaign_sends").createIndex(
          { projectId: 1, status: 1, updatedAt: 1 },
          { name: "analytics_sends_project_status_updatedAt", background: true },
        ),
        db.collection("contacts").createIndex(
          { projectId: 1, createdAt: 1 },
          { name: "analytics_contacts_project_createdAt", background: true },
        ),
        db.collection("automations").createIndex(
          { projectId: 1, createdAt: 1 },
          { name: "analytics_automations_project_createdAt", background: true },
        ),
        db.collection("analytics_shares").createIndex(
          { token: 1 },
          { name: "analytics_shares_token", unique: true, background: true },
        ),
        db.collection("analytics_shares").createIndex(
          { projectId: 1, from: 1, to: 1, createdAt: -1 },
          { name: "analytics_shares_project_range", background: true },
        ),
      ]);
    })().catch((error) => {
      analyticsIndexesPromise = null;
      console.error("Failed to ensure analytics indexes:", error);
    });
  }
  await analyticsIndexesPromise;
}

export async function getAnalyticsDashboard(
  projectId: ObjectId,
  fromInput: string,
  toInput: string,
  projectName = "",
  options?: { withShareTokens?: boolean },
): Promise<AnalyticsDashboard> {
  const withShareTokens = Boolean(options?.withShareTokens);
  const cacheKey = dashboardCacheKey(projectId, fromInput, toInput, withShareTokens);
  const cached = readDashboardCache(cacheKey);
  if (cached) {
    return {
      ...cached,
      projectName: projectName || cached.projectName,
    };
  }

  const { from, to } = analyticsRangeIso(fromInput, toInput);
  const db = await getDb();
  void ensureAnalyticsIndexes();

  const [sendDocs, failed, contactsAdded, automationsCreated] = await Promise.all([
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .find({
        projectId,
        status: "sent",
        sentAt: { $gte: from, $lte: to },
      })
      .project({
        blastId: 1,
        campaignId: 1,
        email: 1,
        sentAt: 1,
        bouncedAt: 1,
        openCount: 1,
        openedAt: 1,
        openEvents: 1,
        openPixelBlocked: 1,
        botOpen: 1,
        clickCount: 1,
        clickedAt: 1,
        clickedUrl: 1,
        clickEvents: 1,
        clickBurstIgnored: 1,
        botClick: 1,
        unsubscribedAt: 1,
      })
      .toArray() as Promise<CampaignSendDoc[]>,
    db.collection<CampaignSendDoc>("campaign_sends").countDocuments({
      projectId,
      status: "failed",
      updatedAt: { $gte: from, $lte: to },
    }),
    db.collection<ContactDoc>("contacts").countDocuments({
      projectId,
      createdAt: { $gte: from, $lte: to },
    }),
    db.collection<AutomationDoc>("automations").countDocuments({
      projectId,
      createdAt: { $gte: from, $lte: to },
    }),
  ]);

  const totalsBucket = emptyUniqueBucket();
  const dailyBuckets = new Map<string, UniqueBucket>();
  const blastBuckets = new Map<string, UniqueBucket & { blastId: ObjectId }>();

  for (const doc of sendDocs) {
    const email = String(doc.email ?? "")
      .trim()
      .toLowerCase();
    if (!email || !doc.sentAt) {
      continue;
    }
    const sentAt = doc.sentAt instanceof Date ? doc.sentAt : new Date(doc.sentAt);
    if (Number.isNaN(sentAt.getTime())) {
      continue;
    }
    const delivered = !doc.bouncedAt;
    const opened = sendCountsAsReportOpen(doc);
    const clicked = sendCountsAsReportClick(doc);
    const unsubscribed = Boolean(doc.unsubscribedAt);
    const day = utcDayKey(sentAt);
    const blastKey = doc.blastId.toString();

    let blast = blastBuckets.get(blastKey);
    if (!blast) {
      blast = { ...emptyUniqueBucket(), blastId: doc.blastId, campaignId: doc.campaignId };
      blastBuckets.set(blastKey, blast);
    }
    let daily = dailyBuckets.get(day);
    if (!daily) {
      daily = emptyUniqueBucket();
      dailyBuckets.set(day, daily);
    }

    if (delivered) {
      totalsBucket.delivered.add(email);
      blast.delivered.add(email);
      daily.delivered.add(email);
    }
    if (opened) {
      totalsBucket.opens.add(email);
      blast.opens.add(email);
      daily.opens.add(email);
    }
    if (clicked) {
      totalsBucket.clicks.add(email);
      blast.clicks.add(email);
      daily.clicks.add(email);
    }
    if (unsubscribed) {
      totalsBucket.unsubscribed.add(email);
      blast.unsubscribed.add(email);
      daily.unsubscribed.add(email);
    }
    if (!blast.sentAt || sentAt > blast.sentAt) {
      blast.sentAt = sentAt;
    }
  }

  const byBlast = [...blastBuckets.values()].map((row) => ({
    _id: row.blastId,
    campaignId: row.campaignId || "",
    delivered: row.delivered.size,
    opens: row.opens.size,
    clicks: row.clicks.size,
    unsubscribed: row.unsubscribed.size,
    sentAt: row.sentAt,
  }));
  const totalRow = {
    delivered: totalsBucket.delivered.size,
    opens: totalsBucket.opens.size,
    clicks: totalsBucket.clicks.size,
    unsubscribed: totalsBucket.unsubscribed.size,
  };
  const facetDaily = [...dailyBuckets.entries()].map(([day, row]) => ({
    _id: day,
    delivered: row.delivered.size,
    opens: row.opens.size,
    clicks: row.clicks.size,
  }));

  const blastIds = byBlast.map((row) => row._id);
  const blasts = blastIds.length
    ? await db
        .collection<CampaignBlastDoc>("campaign_blasts")
        .find(
          { _id: { $in: blastIds }, projectId },
          { projection: { name: 1, kind: 1, campaignId: 1 } },
        )
        .toArray()
    : [];
  const blastMap = new Map(blasts.map((blast) => [blast._id.toString(), blast]));

  const oneOneCampaignIds = [
    ...new Set(
      blasts.filter((blast) => blast.kind === "oneone").map((blast) => blast.campaignId),
    ),
  ];
  const personaliseIds = new Set(
    oneOneCampaignIds.length
      ? (
          await db
            .collection("drip_campaigns")
            .find({
              projectId,
              kind: "oneone",
              campaignId: { $in: oneOneCampaignIds },
              tags: "personalise",
            })
            .project<{ campaignId: string }>({ campaignId: 1 })
            .toArray()
        ).map((campaign) => campaign.campaignId)
      : [],
  );

  const totals = {
    ...emptyKind(),
    failed,
    campaigns: 0,
    dripCampaigns: 0,
    oneOneCampaigns: 0,
    personaliseCampaigns: 0,
    contactsAdded,
    automationsCreated,
  };
  if (totalRow) {
    totals.delivered = totalRow.delivered;
    totals.opens = totalRow.opens;
    totals.clicks = totalRow.clicks;
    totals.unsubscribed = totalRow.unsubscribed;
  }

  const byKind = { drip: emptyKind(), oneone: emptyKind(), personalise: emptyKind() };
  const dailyMap = new Map<string, AnalyticsDailyPoint>();
  for (const day of eachDay(from, to)) {
    dailyMap.set(day, { date: day, delivered: 0, opens: 0, clicks: 0 });
  }
  for (const point of facetDaily) {
    if (!point._id) {
      continue;
    }
    dailyMap.set(point._id, {
      date: point._id,
      delivered: point.delivered,
      opens: point.opens,
      clicks: point.clicks,
    });
  }

  const campaignMap = new Map<string, AnalyticsCampaignRow>();
  for (const row of byBlast) {
    const blast = blastMap.get(row._id.toString());
    const kind = blast?.kind === "oneone" ? "oneone" : "drip";
    const campaignId = blast?.campaignId ?? row.campaignId;
    const personalise = kind === "oneone" && personaliseIds.has(campaignId);
    const bucket = byKind[personalise ? "personalise" : kind];
    bucket.delivered += row.delivered;
    bucket.opens += row.opens;
    bucket.clicks += row.clicks;
    bucket.unsubscribed += row.unsubscribed;

    const key = `${kind}:${campaignId}`;
    const sentAt = row.sentAt?.toISOString();
    const existing = campaignMap.get(key);
    if (!existing) {
      campaignMap.set(key, {
        id: row._id.toString(),
        campaignId,
        name: blast?.name || `Campaign ${campaignId}`,
        kind,
        ...(personalise ? { personalise: true } : {}),
        sentAt,
        delivered: row.delivered,
        opens: row.opens,
        clicks: row.clicks,
        unsubscribed: row.unsubscribed,
      });
    } else {
      existing.delivered += row.delivered;
      existing.opens += row.opens;
      existing.clicks += row.clicks;
      existing.unsubscribed += row.unsubscribed;
      if (sentAt && (!existing.sentAt || sentAt > existing.sentAt)) {
        existing.sentAt = sentAt;
      }
    }
  }

  const campaigns = [...campaignMap.values()].sort((a, b) => b.delivered - a.delivered);
  totals.campaigns = campaigns.length;
  totals.dripCampaigns = campaigns.filter((item) => item.kind === "drip").length;
  totals.personaliseCampaigns = campaigns.filter((item) => item.personalise).length;
  totals.oneOneCampaigns =
    campaigns.filter((item) => item.kind === "oneone").length - totals.personaliseCampaigns;

  if (withShareTokens && campaigns.length > 0) {
    const tokens = await ensureCampaignShareTokens(
      projectId,
      campaigns.map((item) => ({ campaignId: item.campaignId, kind: item.kind })),
    );
    for (const campaign of campaigns) {
      campaign.shareToken = tokens.get(`${campaign.kind}:${campaign.campaignId}`);
    }
  }

  const dashboard: AnalyticsDashboard = {
    from: fromInput,
    to: toInput,
    projectName,
    totals,
    rates: {
      openRate: totals.delivered ? totals.opens / totals.delivered : 0,
      clickRate: totals.delivered ? totals.clicks / totals.delivered : 0,
      unsubscribeRate: totals.delivered ? totals.unsubscribed / totals.delivered : 0,
    },
    byKind,
    daily: [...dailyMap.values()],
    campaigns,
  };

  writeDashboardCache(cacheKey, dashboard);
  return dashboard;
}

export async function createAnalyticsShare(
  projectId: ObjectId,
  projectName: string,
  userId: ObjectId | null,
  from: string,
  to: string,
  options?: { hideBotClicks?: boolean },
) {
  analyticsRangeIso(from, to);
  const hideBotClicks = Boolean(options?.hideBotClicks);
  const db = await getDb();
  void ensureAnalyticsIndexes();
  const shares = db.collection<AnalyticsShareDoc>("analytics_shares");
  const candidates = await shares
    .find({ projectId, from, to })
    .sort({ createdAt: -1 })
    .toArray();
  const existing = candidates.find((item) => !isAnalyticsShareExpired(item));
  if (existing && !isAnalyticsShareExpired(existing)) {
    const expiresAt = resolveAnalyticsShareExpiry(existing);
    const next: AnalyticsShareDoc = { ...existing, expiresAt, hideBotClicks };
    const patch: Partial<AnalyticsShareDoc> = { hideBotClicks };
    if (existing.projectName !== projectName) {
      patch.projectName = projectName;
      next.projectName = projectName;
    }
    if (!existing.expiresAt) {
      patch.expiresAt = expiresAt;
    }
    await shares.updateOne({ _id: existing._id }, { $set: patch });
    return next;
  }

  const createdAt = new Date();
  const token = randomBytes(18).toString("base64url");
  const doc: AnalyticsShareDoc = {
    _id: new ObjectId(),
    projectId,
    token,
    from,
    to,
    projectName,
    createdBy: userId,
    createdAt,
    expiresAt: analyticsShareExpiresAt(createdAt),
    hideBotClicks,
  };
  await shares.insertOne(doc);
  return doc;
}

export async function findAnalyticsShareByToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const db = await getDb();
  return db.collection<AnalyticsShareDoc>("analytics_shares").findOne({ token: trimmed });
}

export async function getAnalyticsShareByToken(token: string) {
  const share = await findAnalyticsShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return null;
  }
  return share;
}
