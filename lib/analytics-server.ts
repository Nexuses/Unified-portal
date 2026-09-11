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

function emptyKind(): AnalyticsKindStats {
  return { delivered: 0, opens: 0, clicks: 0, unsubscribed: 0 };
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
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

function wasOpened(send: CampaignSendDoc) {
  return Boolean(send.openedAt) || (send.openCount ?? 0) > 0;
}

function wasClicked(send: CampaignSendDoc) {
  if (send.clickBurstIgnored) {
    return false;
  }
  return Boolean(send.clickedAt) || (send.clickCount ?? 0) > 0;
}

export async function getAnalyticsDashboard(
  projectId: ObjectId,
  fromInput: string,
  toInput: string,
  projectName = "",
  options?: { withShareTokens?: boolean },
): Promise<AnalyticsDashboard> {
  const { from, to } = analyticsRangeIso(fromInput, toInput);
  const db = await getDb();

  const [sends, failed, contactsAdded, automationsCreated] = await Promise.all([
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .find({
        projectId,
        status: "sent",
        sentAt: { $gte: from, $lte: to },
      })
      .toArray(),
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

  const blastIds = [...new Set(sends.map((send) => send.blastId.toString()))].map(
    (id) => new ObjectId(id),
  );
  const blasts = blastIds.length
    ? await db
        .collection<CampaignBlastDoc>("campaign_blasts")
        .find({ _id: { $in: blastIds }, projectId })
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
  const byKind = { drip: emptyKind(), oneone: emptyKind() };
  const dailyMap = new Map<string, AnalyticsDailyPoint>();
  for (const day of eachDay(from, to)) {
    dailyMap.set(day, { date: day, delivered: 0, opens: 0, clicks: 0 });
  }

  const campaignMap = new Map<string, AnalyticsCampaignRow>();

  for (const send of sends) {
    const blast = blastMap.get(send.blastId.toString());
    const kind = blast?.kind === "oneone" ? "oneone" : "drip";
    const opened = wasOpened(send);
    const clicked = wasClicked(send);
    const unsubscribed = Boolean(send.unsubscribedAt);
    totals.delivered += 1;
    byKind[kind].delivered += 1;
    if (opened) {
      totals.opens += 1;
      byKind[kind].opens += 1;
    }
    if (clicked) {
      totals.clicks += 1;
      byKind[kind].clicks += 1;
    }
    if (unsubscribed) {
      totals.unsubscribed += 1;
      byKind[kind].unsubscribed += 1;
    }

    const sentDay = send.sentAt ? dayKey(send.sentAt) : "";
    const point = sentDay ? dailyMap.get(sentDay) : undefined;
    if (point) {
      point.delivered += 1;
      if (opened) {
        point.opens += 1;
      }
      if (clicked) {
        point.clicks += 1;
      }
    }

    const key = `${kind}:${blast?.campaignId ?? send.campaignId}`;
    const existing = campaignMap.get(key);
    const sentAt = send.sentAt?.toISOString();
    if (!existing) {
      campaignMap.set(key, {
        id: send.blastId.toString(),
        campaignId: blast?.campaignId ?? send.campaignId,
        name: blast?.name || `Campaign ${send.campaignId}`,
        kind,
        sentAt,
        delivered: 1,
        opens: opened ? 1 : 0,
        clicks: clicked ? 1 : 0,
        unsubscribed: unsubscribed ? 1 : 0,
      });
    } else {
      existing.delivered += 1;
      if (opened) {
        existing.opens += 1;
      }
      if (clicked) {
        existing.clicks += 1;
      }
      if (unsubscribed) {
        existing.unsubscribed += 1;
      }
      if (sentAt && (!existing.sentAt || sentAt > existing.sentAt)) {
        existing.sentAt = sentAt;
      }
    }
  }

  const campaigns = [...campaignMap.values()].sort((a, b) => b.delivered - a.delivered);
  totals.campaigns = campaigns.length;
  totals.dripCampaigns = campaigns.filter((item) => item.kind === "drip").length;
  totals.oneOneCampaigns = campaigns.filter((item) => item.kind === "oneone").length;

  if (options?.withShareTokens && campaigns.length > 0) {
    const tokens = await ensureCampaignShareTokens(
      projectId,
      campaigns.map((item) => ({ campaignId: item.campaignId, kind: item.kind })),
    );
    for (const campaign of campaigns) {
      campaign.shareToken = tokens.get(`${campaign.kind}:${campaign.campaignId}`);
    }
  }

  return {
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
    await getAnalyticsDashboard(projectId, from, to, projectName, {
      withShareTokens: true,
    }).catch(() => undefined);
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
  await getAnalyticsDashboard(projectId, from, to, projectName, {
    withShareTokens: true,
  }).catch(() => undefined);
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
