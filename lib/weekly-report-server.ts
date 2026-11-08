import nodemailer from "nodemailer";
import { ObjectId } from "mongodb";
import { analyticsRangeIso } from "@/lib/analytics";
import type {
  ProjectsEngagementReport,
  WeeklyProjectStats,
} from "@/lib/all-projects-stats";
import { sendHasHumanClick } from "@/lib/bot-click";
import { sendIsBotOnlyOpen } from "@/lib/bot-open";
import {
  sendHasCountableClick,
  type CampaignSendDoc,
} from "@/lib/campaign-blasts-server";
import type { ContactDoc } from "@/lib/crm";
import { getDb } from "@/lib/mongodb";
import { sendCountsAsOpen } from "@/lib/open-pixel";
import { NEXUSES_LOGO_URL } from "@/lib/nexuses-logo";

export type {
  AllProjectsStatsDays,
  ProjectsEngagementReport,
  WeeklyProjectStats,
} from "@/lib/all-projects-stats";
export {
  ALL_PROJECTS_STATS_DAYS,
  parseAllProjectsStatsDays,
} from "@/lib/all-projects-stats";

const WEEKLY_REPORT_META = "weekly_report_meta";

export type WeeklyReportPayload = {
  weekKey: string;
  from: string;
  to: string;
  timezone: string;
  generatedAt: string;
  projects: WeeklyProjectStats[];
  totals: Omit<WeeklyProjectStats, "projectId" | "projectName">;
};

type WeeklyReportMetaDoc = {
  _id: string;
  lastWeekKey?: string;
  lastSentAt?: Date;
  lastTo?: string;
};

const DEFAULT_WEEKLY_REPORT_TIMEZONE = "Asia/Kolkata";

function env(name: string) {
  return (process.env[name] || "").trim();
}

/** Keep IANA-ish chars only — strips BOM / smart quotes / trailing junk like `ø`. */
function sanitizeTimezone(value: string) {
  return value
    .normalize("NFKC")
    .replace(/^\uFEFF/, "")
    .replace(/["'`]/g, "")
    .replace(/[^A-Za-z0-9_+\-/]/g, "")
    .trim();
}

function isValidTimeZone(timeZone: string) {
  if (!timeZone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function weeklyReportTimezone() {
  const raw = sanitizeTimezone(env("WEEKLY_REPORT_TIMEZONE"));
  if (isValidTimeZone(raw)) {
    return raw;
  }
  return DEFAULT_WEEKLY_REPORT_TIMEZONE;
}

export function weeklyReportConfig() {
  const to = env("WEEKLY_REPORT_TO");
  const host = env("WEEKLY_REPORT_SMTP_HOST");
  const user = env("WEEKLY_REPORT_SMTP_USER");
  const pass = env("WEEKLY_REPORT_SMTP_PASS");
  const fromEmail = env("WEEKLY_REPORT_FROM_EMAIL") || user;
  const fromName = env("WEEKLY_REPORT_FROM_NAME") || "Nexuses Weekly Report";
  const port = Number(env("WEEKLY_REPORT_SMTP_PORT") || "587");
  const enabled = env("WEEKLY_REPORT_ENABLED") !== "0";
  return {
    enabled,
    to,
    host,
    user,
    pass,
    fromEmail,
    fromName,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    timezone: weeklyReportTimezone(),
  };
}

/** Format a Date in a timezone as YYYY-MM-DD. */
function zonedDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
  };
}

/**
 * Past `days` calendar days in the report timezone, ending today (inclusive).
 * days=7 → today and the previous 6 days.
 */
export function reportRangeForDays(
  days: number,
  now = new Date(),
  timeZone = weeklyReportTimezone(),
) {
  const span = Math.max(1, Math.floor(days));
  const todayKey = zonedDateKey(now, timeZone);
  const startDate = new Date(`${todayKey}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - (span - 1));
  const from = startDate.toISOString().slice(0, 10);
  const to = todayKey;
  return { from, to, rangeKey: `${from}_${to}` };
}

/**
 * Past 7 calendar days in the report timezone, ending today.
 * Friday run → previous Saturday through Friday (inclusive).
 */
export function weeklyReportRange(now = new Date(), timeZone = weeklyReportTimezone()) {
  const { from, to, rangeKey } = reportRangeForDays(7, now, timeZone);
  return { from, to, weekKey: rangeKey };
}

/**
 * True when local time is Friday and within the 4:25–4:40 PM window
 * (so a 4:30 crontab + small drift still sends once).
 */
export function isWeeklyReportSendWindow(now = new Date(), timeZone = weeklyReportTimezone()) {
  const parts = zonedParts(now, timeZone);
  if (parts.weekday !== "Fri") {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 16 * 60 + 25 && minutes <= 16 * 60 + 40;
}

function rate(part: number, whole: number) {
  return whole > 0 ? part / whole : 0;
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatInt(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

type ProjectUniqueBucket = {
  delivered: Set<string>;
  opens: Set<string>;
  clicks: Set<string>;
  unsubscribed: Set<string>;
};

function emptyProjectBucket(): ProjectUniqueBucket {
  return {
    delivered: new Set(),
    opens: new Set(),
    clicks: new Set(),
    unsubscribed: new Set(),
  };
}

/** Match portal / weekly report (Show bot opens/clicks off). */
function sendCountsAsReportOpen(send: CampaignSendDoc) {
  if (!sendCountsAsOpen(send)) {
    return false;
  }
  return !sendIsBotOnlyOpen(send);
}

function sendCountsAsReportClick(send: CampaignSendDoc) {
  if (!sendHasCountableClick(send)) {
    return false;
  }
  return sendHasHumanClick(send);
}

function countMapFromGroup(
  rows: Array<{ _id: ObjectId | null; count: number }>,
) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row._id) {
      continue;
    }
    map.set(row._id.toString(), row.count);
  }
  return map;
}

const ENGAGEMENT_REPORT_CACHE_TTL_MS = 45_000;
const engagementReportCache = new Map<
  string,
  { expiresAt: number; value: ProjectsEngagementReport }
>();

/**
 * Same per-project engagement stats as the weekly email.
 * Pass `days` for a rolling window, or `from`+`to` (YYYY-MM-DD) for a custom range.
 * Bots hidden (matches weekly report). Batches Mongo reads across all projects.
 */
export async function buildProjectsEngagementReport(
  options: {
    days?: number;
    from?: string;
    to?: string;
    now?: Date;
  } = { days: 7 },
): Promise<ProjectsEngagementReport> {
  const now = options.now ?? new Date();
  const timezone = weeklyReportTimezone();
  const customFrom = String(options.from ?? "").trim();
  const customTo = String(options.to ?? "").trim();
  const useCustom = Boolean(customFrom && customTo);

  let from: string;
  let to: string;
  let rangeKey: string;
  let span: number;

  if (useCustom) {
    const bounds = analyticsRangeIso(customFrom, customTo);
    from = customFrom;
    to = customTo;
    rangeKey = `${from}_${to}`;
    span = Math.max(
      1,
      Math.round(
        (Date.UTC(
          bounds.to.getUTCFullYear(),
          bounds.to.getUTCMonth(),
          bounds.to.getUTCDate(),
        ) -
          Date.UTC(
            bounds.from.getUTCFullYear(),
            bounds.from.getUTCMonth(),
            bounds.from.getUTCDate(),
          )) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    );
  } else {
    const days = Math.max(1, Math.floor(options.days ?? 7));
    ({ from, to, rangeKey } = reportRangeForDays(days, now, timezone));
    span = days;
  }

  const cacheKey = `${rangeKey}|${timezone}|d${span}`;
  const cached = engagementReportCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const db = await getDb();
  const { from: fromDate, to: toDate } = analyticsRangeIso(from, to);
  const projects = await db
    .collection<{ _id: ObjectId; name: string; logoUrl?: string }>("projects")
    .find({})
    .project({ name: 1, logoUrl: 1 })
    .sort({ name: 1 })
    .toArray();

  if (projects.length === 0) {
    const empty: ProjectsEngagementReport = {
      from,
      to,
      rangeKey,
      days: span,
      timezone,
      generatedAt: now.toISOString(),
      projects: [],
      totals: {
        delivered: 0,
        opens: 0,
        clicks: 0,
        replies: 0,
        contactsAdded: 0,
        unsubscribed: 0,
        failed: 0,
        openRate: 0,
        clickRate: 0,
        replyRate: 0,
      },
    };
    engagementReportCache.set(cacheKey, {
      expiresAt: Date.now() + ENGAGEMENT_REPORT_CACHE_TTL_MS,
      value: empty,
    });
    return empty;
  }

  const projectIds = projects.map((project) => project._id);

  const [sendDocs, failedRows, contactRows, replyRows] = await Promise.all([
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .find({
        projectId: { $in: projectIds },
        status: "sent",
        sentAt: { $gte: fromDate, $lte: toDate },
      })
      .project({
        projectId: 1,
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
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .aggregate<{ _id: ObjectId; count: number }>([
        {
          $match: {
            projectId: { $in: projectIds },
            status: "failed",
            updatedAt: { $gte: fromDate, $lte: toDate },
          },
        },
        { $group: { _id: "$projectId", count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection<ContactDoc>("contacts")
      .aggregate<{ _id: ObjectId; count: number }>([
        {
          $match: {
            projectId: { $in: projectIds },
            createdAt: { $gte: fromDate, $lte: toDate },
          },
        },
        { $group: { _id: "$projectId", count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .aggregate<{ _id: ObjectId; count: number }>([
        {
          $match: {
            projectId: { $in: projectIds },
            repliedAt: { $gte: fromDate, $lte: toDate },
            email: { $type: "string", $ne: "" },
          },
        },
        {
          $group: {
            _id: {
              projectId: "$projectId",
              email: { $toLower: { $trim: { input: "$email" } } },
            },
          },
        },
        { $group: { _id: "$_id.projectId", count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const failedByProject = countMapFromGroup(failedRows);
  const contactsByProject = countMapFromGroup(contactRows);
  const repliesByProject = countMapFromGroup(replyRows);

  const buckets = new Map<string, ProjectUniqueBucket>();
  for (const project of projects) {
    buckets.set(project._id.toString(), emptyProjectBucket());
  }

  for (const doc of sendDocs) {
    const projectKey = doc.projectId?.toString?.() ?? "";
    const bucket = buckets.get(projectKey);
    if (!bucket) {
      continue;
    }
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

    if (!doc.bouncedAt) {
      bucket.delivered.add(email);
    }
    if (sendCountsAsReportOpen(doc)) {
      bucket.opens.add(email);
    }
    if (sendCountsAsReportClick(doc)) {
      bucket.clicks.add(email);
    }
    if (doc.unsubscribedAt) {
      bucket.unsubscribed.add(email);
    }
  }

  const rows: WeeklyProjectStats[] = projects.map((project) => {
    const id = project._id.toString();
    const bucket = buckets.get(id) ?? emptyProjectBucket();
    const delivered = bucket.delivered.size;
    const opens = bucket.opens.size;
    const clicks = bucket.clicks.size;
    const replies = repliesByProject.get(id) ?? 0;
    const logoUrl = project.logoUrl?.trim() || "";
    return {
      projectId: id,
      projectName: project.name || "Untitled project",
      ...(logoUrl ? { logoUrl } : {}),
      delivered,
      opens,
      clicks,
      replies,
      contactsAdded: contactsByProject.get(id) ?? 0,
      unsubscribed: bucket.unsubscribed.size,
      failed: failedByProject.get(id) ?? 0,
      openRate: rate(opens, delivered),
      clickRate: rate(clicks, delivered),
      replyRate: rate(replies, delivered),
    };
  });

  rows.sort((a, b) => b.delivered - a.delivered || a.projectName.localeCompare(b.projectName));

  const totals = rows.reduce(
    (acc, row) => {
      acc.delivered += row.delivered;
      acc.opens += row.opens;
      acc.clicks += row.clicks;
      acc.replies += row.replies;
      acc.contactsAdded += row.contactsAdded;
      acc.unsubscribed += row.unsubscribed;
      acc.failed += row.failed;
      return acc;
    },
    {
      delivered: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      contactsAdded: 0,
      unsubscribed: 0,
      failed: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0,
    },
  );
  totals.openRate = rate(totals.opens, totals.delivered);
  totals.clickRate = rate(totals.clicks, totals.delivered);
  totals.replyRate = rate(totals.replies, totals.delivered);

  const report: ProjectsEngagementReport = {
    from,
    to,
    rangeKey,
    days: span,
    timezone,
    generatedAt: now.toISOString(),
    projects: rows,
    totals,
  };
  engagementReportCache.set(cacheKey, {
    expiresAt: Date.now() + ENGAGEMENT_REPORT_CACHE_TTL_MS,
    value: report,
  });
  return report;
}

export async function buildWeeklyReport(
  now = new Date(),
): Promise<WeeklyReportPayload> {
  const report = await buildProjectsEngagementReport({ days: 7, now });
  return {
    weekKey: report.rangeKey,
    from: report.from,
    to: report.to,
    timezone: report.timezone,
    generatedAt: report.generatedAt,
    projects: report.projects,
    totals: report.totals,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metricCard(label: string, value: string, hint?: string, width = "25%") {
  return `
    <td style="padding:8px;width:${width};vertical-align:top;">
      <div style="background:#f8f7fc;border:1px solid #ebe4ff;border-radius:12px;padding:14px 12px;text-align:center;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${label}</div>
        <div style="margin-top:6px;font-size:22px;font-weight:800;color:#111827;line-height:1.1;">${value}</div>
        ${hint ? `<div style="margin-top:4px;font-size:12px;font-weight:600;color:#7c3aed;">${hint}</div>` : ""}
      </div>
    </td>`;
}

export function buildWeeklyReportHtml(report: WeeklyReportPayload) {
  const appUrl = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://unified.nexuses.xyz"
  ).replace(/\/$/, "");

  const rowsHtml = report.projects
    .map((project, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#fafafa";
      return `
        <tr style="background:${bg};">
          <td style="padding:12px 14px;border-bottom:1px solid #eef0f2;font-weight:650;color:#111827;">${escapeHtml(project.projectName)}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #eef0f2;text-align:right;color:#111827;">${formatInt(project.delivered)}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #eef0f2;text-align:right;color:#111827;">${formatInt(project.opens)}<div style="font-size:11px;color:#6b7280;">${formatPct(project.openRate)}</div></td>
          <td style="padding:12px 10px;border-bottom:1px solid #eef0f2;text-align:right;color:#111827;">${formatInt(project.clicks)}<div style="font-size:11px;color:#6b7280;">${formatPct(project.clickRate)}</div></td>
          <td style="padding:12px 10px;border-bottom:1px solid #eef0f2;text-align:right;color:#111827;">${formatInt(project.replies)}<div style="font-size:11px;color:#6b7280;">${formatPct(project.replyRate)}</div></td>
          <td style="padding:12px 10px;border-bottom:1px solid #eef0f2;text-align:right;color:#111827;">${formatInt(project.contactsAdded)}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #eef0f2;text-align:right;color:#6b7280;">${formatInt(project.unsubscribed)}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nexuses weekly report</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:22px 24px;background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#fff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="left" valign="middle" style="padding-right:16px;">
                    <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9;">Nexuses Unified Portal</div>
                    <h1 style="margin:10px 0 6px;font-size:26px;line-height:1.2;font-weight:800;">Weekly performance report</h1>
                    <p style="margin:0;font-size:14px;opacity:.92;">
                      ${escapeHtml(report.from)} → ${escapeHtml(report.to)}
                      · ${escapeHtml(report.timezone)}
                      · ${report.projects.length} project${report.projects.length === 1 ? "" : "s"}
                    </p>
                  </td>
                  <td align="right" valign="middle" width="148" style="width:148px;">
                    <div style="display:inline-block;background:#ffffff;border-radius:12px;padding:10px 12px;line-height:0;">
                      <img src="${NEXUSES_LOGO_URL}" alt="Nexuses" width="120" height="26" style="display:block;width:120px;height:auto;border:0;outline:none;text-decoration:none;" />
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 22px 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  ${metricCard("Sent", formatInt(report.totals.delivered), undefined, "20%")}
                  ${metricCard("Opens", formatInt(report.totals.opens), formatPct(report.totals.openRate), "20%")}
                  ${metricCard("Clicks", formatInt(report.totals.clicks), formatPct(report.totals.clickRate), "20%")}
                  ${metricCard("Replies", formatInt(report.totals.replies), formatPct(report.totals.replyRate), "20%")}
                  ${metricCard("Contacts added", formatInt(report.totals.contactsAdded), undefined, "20%")}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 22px 22px;">
              <div style="font-size:14px;font-weight:700;color:#374151;margin:0 0 10px;">By project</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #eef0f2;border-radius:12px;overflow:hidden;">
                <tr style="background:#f5f3ff;">
                  <th align="left" style="padding:11px 14px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Project</th>
                  <th align="right" style="padding:11px 10px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Sent</th>
                  <th align="right" style="padding:11px 10px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Opens</th>
                  <th align="right" style="padding:11px 10px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Clicks</th>
                  <th align="right" style="padding:11px 10px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Replies</th>
                  <th align="right" style="padding:11px 10px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Contacts</th>
                  <th align="right" style="padding:11px 10px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Unsub</th>
                </tr>
                ${rowsHtml || `<tr><td colspan="7" style="padding:18px;text-align:center;color:#6b7280;">No projects found.</td></tr>`}
                <tr style="background:#f9fafb;">
                  <td style="padding:12px 14px;font-weight:800;color:#111827;">All projects</td>
                  <td style="padding:12px 10px;text-align:right;font-weight:800;">${formatInt(report.totals.delivered)}</td>
                  <td style="padding:12px 10px;text-align:right;font-weight:800;">${formatInt(report.totals.opens)}</td>
                  <td style="padding:12px 10px;text-align:right;font-weight:800;">${formatInt(report.totals.clicks)}</td>
                  <td style="padding:12px 10px;text-align:right;font-weight:800;">${formatInt(report.totals.replies)}</td>
                  <td style="padding:12px 10px;text-align:right;font-weight:800;">${formatInt(report.totals.contactsAdded)}</td>
                  <td style="padding:12px 10px;text-align:right;font-weight:800;color:#6b7280;">${formatInt(report.totals.unsubscribed)}</td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-size:12px;color:#9ca3af;line-height:1.45;">
                Sent = unique delivered contacts (bots excluded from opens/clicks).
                Contacts = new contacts added this week.
                Replies counted by reply time in this window.
                Failed sends this week: ${formatInt(report.totals.failed)}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 22px 22px;border-top:1px solid #eef0f2;background:#fafafa;">
              <a href="${escapeHtml(appUrl)}/portal/analytics" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 14px;border-radius:10px;">
                Open analytics
              </a>
              <div style="margin-top:12px;font-size:11px;color:#9ca3af;">
                Generated ${escapeHtml(report.generatedAt)} · week ${escapeHtml(report.weekKey)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function alreadySentWeeklyReport(weekKey: string) {
  const db = await getDb();
  const doc = await db.collection<WeeklyReportMetaDoc>(WEEKLY_REPORT_META).findOne({
    _id: "default",
  });
  return Boolean(doc?.lastWeekKey && doc.lastWeekKey === weekKey);
}

async function markWeeklyReportSent(weekKey: string, to: string) {
  const db = await getDb();
  await db.collection<WeeklyReportMetaDoc>(WEEKLY_REPORT_META).updateOne(
    { _id: "default" },
    {
      $set: {
        lastWeekKey: weekKey,
        lastSentAt: new Date(),
        lastTo: to,
      },
    },
    { upsert: true },
  );
}

/** Sample payload for SMTP / template tests when live Mongo stats are unavailable. */
export function buildSampleWeeklyReport(
  now = new Date(),
): WeeklyReportPayload {
  const timezone = weeklyReportTimezone();
  const { from, to, weekKey } = weeklyReportRange(now, timezone);
  return {
    weekKey,
    from,
    to,
    timezone,
    generatedAt: now.toISOString(),
    projects: [
      {
        projectId: "sample-a",
        projectName: "Sample Project A",
        delivered: 1240,
        opens: 486,
        clicks: 112,
        replies: 37,
        contactsAdded: 94,
        unsubscribed: 8,
        failed: 3,
        openRate: 486 / 1240,
        clickRate: 112 / 1240,
        replyRate: 37 / 1240,
      },
      {
        projectId: "sample-b",
        projectName: "Sample Project B",
        delivered: 820,
        opens: 301,
        clicks: 64,
        replies: 19,
        contactsAdded: 61,
        unsubscribed: 5,
        failed: 1,
        openRate: 301 / 820,
        clickRate: 64 / 820,
        replyRate: 19 / 820,
      },
    ],
    totals: {
      delivered: 2060,
      opens: 787,
      clicks: 176,
      replies: 56,
      contactsAdded: 155,
      unsubscribed: 13,
      failed: 4,
      openRate: 787 / 2060,
      clickRate: 176 / 2060,
      replyRate: 56 / 2060,
    },
  };
}

export async function sendWeeklyReportEmail(html: string, subject: string) {
  const config = weeklyReportConfig();
  if (!config.to) {
    throw new Error("WEEKLY_REPORT_TO is not set");
  }
  if (!config.host || !config.user || !config.pass || !config.fromEmail) {
    throw new Error(
      "WEEKLY_REPORT_SMTP_HOST / USER / PASS / FROM_EMAIL must be set",
    );
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  const from = config.fromName
    ? `"${config.fromName.replace(/"/g, "")}" <${config.fromEmail}>`
    : config.fromEmail;

  const info = await transporter.sendMail({
    from,
    to: config.to,
    subject,
    html,
  });

  return { to: config.to, messageId: info.messageId || undefined };
}

export type RunWeeklyReportOptions = {
  force?: boolean;
  dryRun?: boolean;
  now?: Date;
};

export async function runWeeklyReport(options: RunWeeklyReportOptions = {}) {
  const now = options.now ?? new Date();
  const config = weeklyReportConfig();
  if (!config.enabled && !options.force) {
    return { ok: true as const, skipped: true as const, reason: "disabled" };
  }

  if (!options.force && !isWeeklyReportSendWindow(now, config.timezone)) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "outside_friday_window",
      timezone: config.timezone,
    };
  }

  const report = await buildWeeklyReport(now);
  if (!options.force && (await alreadySentWeeklyReport(report.weekKey))) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "already_sent",
      weekKey: report.weekKey,
    };
  }

  const subject = `Weekly report · ${report.from} → ${report.to} · ${formatInt(report.totals.delivered)} sent`;
  const html = buildWeeklyReportHtml(report);

  if (options.dryRun) {
    return {
      ok: true as const,
      skipped: false as const,
      dryRun: true as const,
      weekKey: report.weekKey,
      from: report.from,
      to: report.to,
      projectCount: report.projects.length,
      totals: report.totals,
      html,
      subject,
    };
  }

  const sent = await sendWeeklyReportEmail(html, subject);
  await markWeeklyReportSent(report.weekKey, sent.to);

  return {
    ok: true as const,
    skipped: false as const,
    weekKey: report.weekKey,
    from: report.from,
    toRange: report.to,
    emailedTo: sent.to,
    messageId: sent.messageId,
    projectCount: report.projects.length,
    totals: report.totals,
  };
}
