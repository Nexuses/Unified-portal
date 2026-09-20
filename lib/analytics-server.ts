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
import type { CampaignBlastDoc, CampaignSendDoc } from "@/lib/campaign-blasts-server";
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
  return `${projectId.toString()}|${fromInput}|${toInput}|${withShareTokens ? "1" : "0"}`;
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

type SendAggFacet = {
  totals: Array<{
    delivered: number;
    opens: number;
    clicks: number;
    unsubscribed: number;
  }>;
  daily: Array<{
    _id: string;
    delivered: number;
    opens: number;
    clicks: number;
  }>;
  byBlast: Array<{
    _id: ObjectId;
    campaignId: string;
    delivered: number;
    opens: number;
    clicks: number;
    unsubscribed: number;
    sentAt?: Date;
  }>;
};

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

  const sendMatch = {
    projectId,
    status: "sent" as const,
    sentAt: { $gte: from, $lte: to },
  };

  const openedExpr = {
    $or: [
      { $ne: [{ $ifNull: ["$openedAt", null] }, null] },
      { $gt: [{ $ifNull: ["$openCount", 0] }, 0] },
    ],
  };
  const clickedExpr = {
    $and: [
      { $ne: [{ $ifNull: ["$clickBurstIgnored", false] }, true] },
      {
        $or: [
          { $ne: [{ $ifNull: ["$clickedAt", null] }, null] },
          { $gt: [{ $ifNull: ["$clickCount", 0] }, 0] },
        ],
      },
    ],
  };
  const unsubscribedExpr = {
    $ne: [{ $ifNull: ["$unsubscribedAt", null] }, null],
  };

  const [sendFacet, failed, contactsAdded, automationsCreated] = await Promise.all([
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .aggregate<SendAggFacet>(
        [
          { $match: sendMatch },
          {
            $project: {
              blastId: 1,
              campaignId: 1,
              sentAt: 1,
              opened: openedExpr,
              clicked: clickedExpr,
              unsubscribed: unsubscribedExpr,
              day: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$sentAt",
                  timezone: "UTC",
                },
              },
            },
          },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    delivered: { $sum: 1 },
                    opens: { $sum: { $cond: ["$opened", 1, 0] } },
                    clicks: { $sum: { $cond: ["$clicked", 1, 0] } },
                    unsubscribed: { $sum: { $cond: ["$unsubscribed", 1, 0] } },
                  },
                },
              ],
              daily: [
                {
                  $group: {
                    _id: "$day",
                    delivered: { $sum: 1 },
                    opens: { $sum: { $cond: ["$opened", 1, 0] } },
                    clicks: { $sum: { $cond: ["$clicked", 1, 0] } },
                  },
                },
              ],
              byBlast: [
                {
                  $group: {
                    _id: "$blastId",
                    campaignId: { $first: "$campaignId" },
                    delivered: { $sum: 1 },
                    opens: { $sum: { $cond: ["$opened", 1, 0] } },
                    clicks: { $sum: { $cond: ["$clicked", 1, 0] } },
                    unsubscribed: { $sum: { $cond: ["$unsubscribed", 1, 0] } },
                    sentAt: { $max: "$sentAt" },
                  },
                },
              ],
            },
          },
        ],
        { allowDiskUse: true },
      )
      .next(),
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

  const facet = sendFacet ?? { totals: [], daily: [], byBlast: [] };
  const totalRow = facet.totals[0];
  const byBlast = facet.byBlast;

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

  const totals = {
    ...emptyKind(),
    failed,
    campaigns: 0,
    dripCampaigns: 0,
    oneOneCampaigns: 0,
    contactsAdded,
    automationsCreated,
  };
  if (totalRow) {
    totals.delivered = totalRow.delivered;
    totals.opens = totalRow.opens;
    totals.clicks = totalRow.clicks;
    totals.unsubscribed = totalRow.unsubscribed;
  }

  const byKind = { drip: emptyKind(), oneone: emptyKind() };
  const dailyMap = new Map<string, AnalyticsDailyPoint>();
  for (const day of eachDay(from, to)) {
    dailyMap.set(day, { date: day, delivered: 0, opens: 0, clicks: 0 });
  }
  for (const point of facet.daily) {
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
    byKind[kind].delivered += row.delivered;
    byKind[kind].opens += row.opens;
    byKind[kind].clicks += row.clicks;
    byKind[kind].unsubscribed += row.unsubscribed;

    const campaignId = blast?.campaignId ?? row.campaignId;
    const key = `${kind}:${campaignId}`;
    const sentAt = row.sentAt?.toISOString();
    const existing = campaignMap.get(key);
    if (!existing) {
      campaignMap.set(key, {
        id: row._id.toString(),
        campaignId,
        name: blast?.name || `Campaign ${campaignId}`,
        kind,
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
  totals.oneOneCampaigns = campaigns.filter((item) => item.kind === "oneone").length;

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
) {
  analyticsRangeIso(from, to);
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
    const next: AnalyticsShareDoc = { ...existing, expiresAt };
    const patch: Partial<AnalyticsShareDoc> = {};
    if (existing.projectName !== projectName) {
      patch.projectName = projectName;
      next.projectName = projectName;
    }
    if (!existing.expiresAt) {
      patch.expiresAt = expiresAt;
    }
    if (Object.keys(patch).length > 0) {
      await shares.updateOne({ _id: existing._id }, { $set: patch });
    }
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
