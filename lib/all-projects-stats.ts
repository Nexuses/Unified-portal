/** Shared types/constants for admin All projects stats + weekly report. */

export type WeeklyProjectStats = {
  projectId: string;
  projectName: string;
  logoUrl?: string;
  delivered: number;
  opens: number;
  clicks: number;
  replies: number;
  contactsAdded: number;
  unsubscribed: number;
  failed: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
};

export type ProjectsEngagementReport = {
  from: string;
  to: string;
  rangeKey: string;
  days: number;
  timezone: string;
  generatedAt: string;
  projects: WeeklyProjectStats[];
  totals: Omit<WeeklyProjectStats, "projectId" | "projectName">;
};

/** Allowed day windows for the admin All projects stats page. */
export const ALL_PROJECTS_STATS_DAYS = [7, 15, 30] as const;
export type AllProjectsStatsDays = (typeof ALL_PROJECTS_STATS_DAYS)[number];

export type AllProjectsStatsRange =
  | { mode: "preset"; days: AllProjectsStatsDays }
  | { mode: "custom"; from: string; to: string };

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

export function parseAllProjectsStatsDays(value: unknown): AllProjectsStatsDays {
  const n = typeof value === "string" ? Number(value) : Number(value);
  if (ALL_PROJECTS_STATS_DAYS.includes(n as AllProjectsStatsDays)) {
    return n as AllProjectsStatsDays;
  }
  return 7;
}

export function isAllProjectsStatsDate(value: string) {
  return DATE_INPUT.test(value.trim());
}

/** Query: either `from`+`to` (custom) or `days` (preset). */
export function parseAllProjectsStatsQuery(searchParams: {
  get(name: string): string | null;
}): AllProjectsStatsRange {
  const from = String(searchParams.get("from") ?? "").trim();
  const to = String(searchParams.get("to") ?? "").trim();
  if (from && to && isAllProjectsStatsDate(from) && isAllProjectsStatsDate(to)) {
    return { mode: "custom", from, to };
  }
  return { mode: "preset", days: parseAllProjectsStatsDays(searchParams.get("days")) };
}

export function allProjectsStatsQueryString(range: AllProjectsStatsRange) {
  if (range.mode === "custom") {
    return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  }
  return `days=${range.days}`;
}
