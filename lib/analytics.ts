export type AnalyticsKindStats = {
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
};

export type AnalyticsCampaignRow = {
  id: string;
  campaignId: string;
  name: string;
  kind: "drip" | "oneone";
  personalise?: boolean;
  sentAt?: string;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
  shareToken?: string;
};

export type AnalyticsDailyPoint = {
  date: string;
  delivered: number;
  opens: number;
  clicks: number;
};

export type AnalyticsDashboard = {
  from: string;
  to: string;
  projectName: string;
  totals: AnalyticsKindStats & {
    failed: number;
    campaigns: number;
    dripCampaigns: number;
    oneOneCampaigns: number;
    personaliseCampaigns?: number;
    contactsAdded: number;
    automationsCreated: number;
  };
  rates: {
    openRate: number;
    clickRate: number;
    unsubscribeRate: number;
  };
  byKind: {
    /** Omitted on public shares when that campaign type was not selected. */
    drip?: AnalyticsKindStats;
    oneone?: AnalyticsKindStats;
    personalise?: AnalyticsKindStats;
  };
  daily: AnalyticsDailyPoint[];
  campaigns: AnalyticsCampaignRow[];
};

export type AnalyticsShareResult = {
  token: string;
  url: string;
  from: string;
  to: string;
  expiresAt: string;
};

/** Campaign kinds included in a public analytics share. */
export type AnalyticsIncludeKinds = {
  drip: boolean;
  oneone: boolean;
  personalise: boolean;
};

export const DEFAULT_ANALYTICS_INCLUDE_KINDS: AnalyticsIncludeKinds = {
  drip: true,
  oneone: true,
  personalise: true,
};

export function normalizeAnalyticsIncludeKinds(
  input?: Partial<AnalyticsIncludeKinds> | null,
): AnalyticsIncludeKinds {
  return {
    drip: input?.drip !== false,
    oneone: input?.oneone !== false,
    personalise: input?.personalise !== false,
  };
}

export function campaignMatchesIncludeKinds(
  campaign: Pick<AnalyticsCampaignRow, "kind" | "personalise">,
  kinds: AnalyticsIncludeKinds,
) {
  if (campaign.personalise) {
    return kinds.personalise;
  }
  if (campaign.kind === "oneone") {
    return kinds.oneone;
  }
  return kinds.drip;
}

function emptyKindStats(): AnalyticsKindStats {
  return { delivered: 0, opens: 0, clicks: 0, unsubscribed: 0 };
}

/** Filter a dashboard to the campaign kinds selected for a public share. */
export function filterAnalyticsDashboardByKinds(
  dashboard: AnalyticsDashboard,
  kindsInput?: Partial<AnalyticsIncludeKinds> | null,
): AnalyticsDashboard {
  const kinds = normalizeAnalyticsIncludeKinds(kindsInput);
  if (kinds.drip && kinds.oneone && kinds.personalise) {
    return dashboard;
  }

  const campaigns = dashboard.campaigns.filter((campaign) =>
    campaignMatchesIncludeKinds(campaign, kinds),
  );
  const byKind: AnalyticsDashboard["byKind"] = {};
  if (kinds.drip) {
    byKind.drip = dashboard.byKind.drip ?? emptyKindStats();
  }
  if (kinds.oneone) {
    byKind.oneone = dashboard.byKind.oneone ?? emptyKindStats();
  }
  if (kinds.personalise) {
    byKind.personalise = dashboard.byKind.personalise ?? emptyKindStats();
  }
  const drip = byKind.drip ?? emptyKindStats();
  const oneone = byKind.oneone ?? emptyKindStats();
  const personalise = byKind.personalise ?? emptyKindStats();
  const delivered = drip.delivered + oneone.delivered + personalise.delivered;
  const opens = drip.opens + oneone.opens + personalise.opens;
  const clicks = drip.clicks + oneone.clicks + personalise.clicks;
  const unsubscribed =
    drip.unsubscribed + oneone.unsubscribed + personalise.unsubscribed;
  const dripCampaigns = campaigns.filter((item) => item.kind === "drip").length;
  const personaliseCampaigns = campaigns.filter((item) => item.personalise).length;
  const oneOneCampaigns =
    campaigns.filter((item) => item.kind === "oneone").length - personaliseCampaigns;

  return {
    ...dashboard,
    totals: {
      ...dashboard.totals,
      delivered,
      opens,
      clicks,
      unsubscribed,
      campaigns: campaigns.length,
      dripCampaigns,
      oneOneCampaigns,
      personaliseCampaigns,
    },
    rates: {
      openRate: delivered ? opens / delivered : 0,
      clickRate: delivered ? clicks / delivered : 0,
      unsubscribeRate: delivered ? unsubscribed / delivered : 0,
    },
    byKind,
    campaigns,
  };
}

export const ANALYTICS_SHARE_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function analyticsShareExpiresAt(from = new Date()) {
  return new Date(from.getTime() + ANALYTICS_SHARE_TTL_DAYS * DAY_MS);
}

export function resolveAnalyticsShareExpiry(share: {
  expiresAt?: Date | string;
  createdAt: Date | string;
}) {
  if (share.expiresAt) {
    const expires = new Date(share.expiresAt);
    if (!Number.isNaN(expires.getTime())) {
      return expires;
    }
  }
  return analyticsShareExpiresAt(new Date(share.createdAt));
}

export function isAnalyticsShareExpired(share: {
  expiresAt?: Date | string;
  createdAt: Date | string;
}) {
  return resolveAnalyticsShareExpiry(share).getTime() <= Date.now();
}

export function formatAnalyticsExpiry(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultAnalyticsRange() {
  return presetAnalyticsRange("30d");
}

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsRangeError extends Error {}

export function isAnalyticsDate(value: string) {
  return DATE_INPUT.test(value);
}

export function analyticsRangeIso(from: string, to: string) {
  if (!isAnalyticsDate(from) || !isAnalyticsDate(to)) {
    throw new AnalyticsRangeError("Choose a valid date range.");
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AnalyticsRangeError("Choose a valid date range.");
  }
  if (start.getTime() > end.getTime()) {
    throw new AnalyticsRangeError("Start date must be before the end date.");
  }
  return { from: start, to: end };
}

export function formatAnalyticsRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  };
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
}

export type AnalyticsPreset = "7d" | "30d" | "90d" | "month";

export function presetAnalyticsRange(preset: AnalyticsPreset) {
  const to = new Date();
  if (preset === "month") {
    return {
      from: toDateInputValue(new Date(to.getFullYear(), to.getMonth(), 1)),
      to: toDateInputValue(to),
    };
  }
  const days = preset === "7d" ? 6 : preset === "90d" ? 89 : 29;
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - days);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

export function formatPercent(part: number, total: number) {
  if (!total) {
    return "0%";
  }
  const pct = (part / total) * 100;
  const label = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  return label;
}

export function formatInt(value: number) {
  return value.toLocaleString("en-US");
}
