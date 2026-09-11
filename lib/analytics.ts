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
    contactsAdded: number;
    automationsCreated: number;
  };
  rates: {
    openRate: number;
    clickRate: number;
    unsubscribeRate: number;
  };
  byKind: {
    drip: AnalyticsKindStats;
    oneone: AnalyticsKindStats;
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
