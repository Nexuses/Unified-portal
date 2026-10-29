"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Contact } from "@/lib/crm";
import type { CampaignStatus, DripCampaign } from "@/lib/drip-campaigns";
import { DEFAULT_PROJECT_SENDING_LIMIT } from "@/lib/projects";
import {
  PORTAL_ROUTES,
  portalCampaignRoute,
} from "@/lib/portal-nav";
import EmailHealthPanel from "@/app/components/portal/EmailHealthPanel";

const SENDER_SOFT_LIMIT = 30;
const CONTACT_PERIOD_OPTIONS = [7, 15, 30] as const;
type ContactPeriodDays = (typeof CONTACT_PERIOD_OPTIONS)[number];
const PERF_PERIOD_OPTIONS = [7, 15, 30] as const;
type PerfPeriodDays = (typeof PERF_PERIOD_OPTIONS)[number];
const UPCOMING_HOME_LIMIT = 6;
const DRAFT_HOME_LIMIT = 4;
const RECENT_REPLY_HOME_LIMIT = 6;

type RecentReplyThread = {
  threadKey: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  preview: string;
  unreadCount: number;
  latestAt: string;
  campaignName?: string;
};

type CampaignStatReport = {
  kind?: "drip" | "oneone";
  delivered?: number;
  recipients?: number;
  opens?: number;
  replies?: number;
  unsubscribed?: number;
  sentAt?: string;
};

type PerfDelta = {
  label: string;
  tone: "up" | "down" | "flat";
};

type PortalDashboardProps = {
  firstName: string;
};

function UsageBar({ value }: { value: number }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setWidth(0);
    let frame2 = 0;
    const frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        setWidth(Math.max(0, Math.min(100, value)));
      });
    });
    return () => {
      window.cancelAnimationFrame(frame1);
      window.cancelAnimationFrame(frame2);
    };
  }, [value]);

  return (
    <div className="usage-bar">
      <div className="usage-bar-fill" style={{ width: `${width}%` }} />
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatUpcomingWhen(campaign: DripCampaign) {
  if (campaign.status === "sending") {
    return "Sending now";
  }
  const raw = campaign.scheduledAt || campaign.updatedAt || campaign.createdAt;
  if (!raw) {
    return "Time TBD";
  }
  try {
    return new Date(raw).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

function formatReplyWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function upcomingSortMs(campaign: DripCampaign) {
  const raw = campaign.scheduledAt || campaign.updatedAt || campaign.createdAt;
  const ms = raw ? new Date(raw).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

function sentFromReport(report: { delivered?: number; recipients?: number }) {
  const delivered = Number(report.delivered);
  if (Number.isFinite(delivered) && delivered > 0) {
    return delivered;
  }
  const recipients = Number(report.recipients);
  return Number.isFinite(recipients) ? recipients : 0;
}

function formatRate(rate: number) {
  if (!Number.isFinite(rate)) {
    return "0%";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

function formatAxisCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  }
  return String(Math.round(value));
}

function formatDeltaPct(current: number, previous: number): PerfDelta {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { label: "—", tone: "flat" };
  }
  if (previous === 0 && current === 0) {
    return { label: "—", tone: "flat" };
  }
  if (previous === 0) {
    return { label: "↑ 100%", tone: "up" };
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(change) < 0.05) {
    return { label: "—", tone: "flat" };
  }
  const abs = Math.abs(change);
  const digits = abs >= 10 ? 0 : 1;
  const arrow = change > 0 ? "↑" : "↓";
  return {
    label: `${arrow} ${abs.toFixed(digits)}%`,
    tone: change > 0 ? "up" : "down",
  };
}

function dayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sumReportsInRange(
  reports: CampaignStatReport[],
  start: Date,
  end: Date,
) {
  let sent = 0;
  let opened = 0;
  let replies = 0;
  let unsubscribed = 0;
  for (const report of reports) {
    const at = report.sentAt ? new Date(report.sentAt) : null;
    if (!at || Number.isNaN(at.getTime()) || at < start || at > end) {
      continue;
    }
    const opens = Number(report.opens);
    const replyCount = Number(report.replies);
    const unsubCount = Number(report.unsubscribed);
    sent += sentFromReport(report);
    opened += Number.isFinite(opens) ? opens : 0;
    replies += Number.isFinite(replyCount) ? replyCount : 0;
    unsubscribed += Number.isFinite(unsubCount) ? unsubCount : 0;
  }
  return {
    sent,
    opened,
    replies,
    unsubscribed,
    openRate: sent > 0 ? opened / sent : 0,
    replyRate: sent > 0 ? replies / sent : 0,
    unsubRate: sent > 0 ? unsubscribed / sent : 0,
  };
}

function buildPerfSeries(reports: CampaignStatReport[], days: PerfPeriodDays) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  start.setHours(0, 0, 0, 0);
  const prevEnd = new Date(start.getTime() - 1);
  prevEnd.setHours(23, 59, 59, 999);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY_MS);
  prevStart.setHours(0, 0, 0, 0);

  const buckets = new Map<string, { sent: number; opened: number }>();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * DAY_MS);
    buckets.set(dayKey(d), { sent: 0, opened: 0 });
  }

  for (const report of reports) {
    const at = report.sentAt ? new Date(report.sentAt) : null;
    if (!at || Number.isNaN(at.getTime()) || at < start || at > end) {
      continue;
    }
    const bucket = buckets.get(dayKey(at));
    if (!bucket) {
      continue;
    }
    const opens = Number(report.opens);
    bucket.sent += sentFromReport(report);
    bucket.opened += Number.isFinite(opens) ? opens : 0;
  }

  const current = sumReportsInRange(reports, start, end);
  const previous = sumReportsInRange(reports, prevStart, prevEnd);

  const points = Array.from(buckets.entries()).map(([key, value]) => ({
    key,
    label: new Date(`${key}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    ...value,
  }));

  return {
    ...current,
    sentDelta: formatDeltaPct(current.sent, previous.sent),
    openDelta: formatDeltaPct(current.openRate, previous.openRate),
    replyDelta: formatDeltaPct(current.replyRate, previous.replyRate),
    unsubDelta: formatDeltaPct(current.unsubRate, previous.unsubRate),
    points,
  };
}

function smoothLinePath(coords: Array<{ x: number; y: number }>) {
  if (coords.length === 0) {
    return "";
  }
  if (coords.length === 1) {
    return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  }
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function PerfChart({
  points,
}: {
  points: Array<{ key: string; label: string; sent: number; opened: number }>;
}) {
  const width = 640;
  const height = 240;
  const padL = 30;
  const padR = 6;
  const padT = 8;
  const padB = 24;
  const plotRadius = 12;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const maxY = Math.max(
    1,
    ...points.map((p) => Math.max(p.sent, p.opened)),
  );
  const niceMax = (() => {
    const raw = Math.max(maxY * 1.08, 4);
    const pow = 10 ** Math.max(0, Math.floor(Math.log10(raw)));
    return Math.ceil(raw / pow) * pow;
  })();
  const yTicks = [0, 1 / 3, 2 / 3, 1].map((t) => Math.round(niceMax * t));

  function xAt(i: number) {
    if (points.length <= 1) {
      return padL + innerW / 2;
    }
    return padL + (i / (points.length - 1)) * innerW;
  }
  function yAt(value: number) {
    return padT + innerH - (value / niceMax) * innerH;
  }

  function seriesCoords(key: "sent" | "opened") {
    return points.map((p, i) => ({ x: xAt(i), y: yAt(p[key]) }));
  }

  function linePath(key: "sent" | "opened") {
    return smoothLinePath(seriesCoords(key));
  }

  function areaPath(key: "sent" | "opened") {
    if (points.length === 0) {
      return "";
    }
    const top = linePath(key);
    const lastX = xAt(points.length - 1).toFixed(1);
    const firstX = xAt(0).toFixed(1);
    const base = yAt(0).toFixed(1);
    return `${top} L ${lastX} ${base} L ${firstX} ${base} Z`;
  }

  const xLabelStep =
    points.length <= 7 ? 1 : Math.max(1, Math.round((points.length - 1) / 6));
  const labelIndexes = points
    .map((_, i) => i)
    .filter(
      (i) => i === 0 || i === points.length - 1 || i % xLabelStep === 0,
    );
  // Option B: denser markers along the curve
  const dotStep =
    points.length <= 20 ? 1 : Math.max(1, Math.round((points.length - 1) / 18));

  return (
    <svg
      className="perf-chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Emails sent and opened over time"
    >
      <defs>
        <linearGradient id="perfSentFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b2fd1" stopOpacity="0.22" />
          <stop offset="50%" stopColor="#5b2fd1" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#5b2fd1" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="perfOpenedFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b7a3f0" stopOpacity="0.3" />
          <stop offset="55%" stopColor="#b7a3f0" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#b7a3f0" stopOpacity="0" />
        </linearGradient>
        <clipPath id="perfPlotClip">
          <rect
            x={padL}
            y={padT}
            width={innerW}
            height={innerH}
            rx={plotRadius}
            ry={plotRadius}
          />
        </clipPath>
      </defs>
      <rect
        className="perf-chart-plot"
        x={padL}
        y={padT}
        width={innerW}
        height={innerH}
        rx={plotRadius}
        ry={plotRadius}
      />
      {yTicks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={`y-${tick}`}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              className="perf-chart-grid"
            />
            <text x={padL - 6} y={y + 3} className="perf-chart-axis" textAnchor="end">
              {formatAxisCount(tick)}
            </text>
          </g>
        );
      })}
      <g clipPath="url(#perfPlotClip)">
        <path d={areaPath("sent")} fill="url(#perfSentFill)" />
        <path d={areaPath("opened")} fill="url(#perfOpenedFill)" />
        <path d={linePath("sent")} className="perf-chart-line is-sent" />
        <path d={linePath("opened")} className="perf-chart-line is-opened" />
        {points.map((p, i) =>
          i % dotStep === 0 || i === points.length - 1 ? (
            <g key={`dot-${p.key}`}>
              <circle
                cx={xAt(i)}
                cy={yAt(p.sent)}
                r={3.5}
                className="perf-chart-dot is-sent"
              />
              <circle
                cx={xAt(i)}
                cy={yAt(p.opened)}
                r={3.2}
                className="perf-chart-dot is-opened"
              />
            </g>
          ) : null,
        )}
      </g>
      {labelIndexes.map((i) => (
        <text
          key={`x-${points[i].key}`}
          x={xAt(i)}
          y={height - 5}
          className="perf-chart-axis"
          textAnchor={
            i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
          }
        >
          {points[i].label}
        </text>
      ))}
    </svg>
  );
}

function PerfMetric({
  label,
  value,
  delta,
  compareLabel,
  invertGood = false,
}: {
  label: string;
  value: string;
  delta: PerfDelta;
  compareLabel: string;
  invertGood?: boolean;
}) {
  const good =
    delta.tone === "flat"
      ? false
      : invertGood
        ? delta.tone === "down"
        : delta.tone === "up";
  const bad =
    delta.tone === "flat"
      ? false
      : invertGood
        ? delta.tone === "up"
        : delta.tone === "down";
  return (
    <div className="perf-metric">
      <div className="perf-metric-label">{label}</div>
      <div className="perf-metric-value">{value}</div>
      <div
        className={`perf-metric-delta${good ? " is-good" : ""}${bad ? " is-bad" : ""}`}
      >
        {delta.label}
      </div>
      <div className="perf-metric-compare">{compareLabel}</div>
    </div>
  );
}

function campaignTimestamp(campaign: DripCampaign) {
  const raw =
    campaign.sentAt ||
    campaign.updatedAt ||
    campaign.scheduledAt ||
    campaign.createdAt;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function formatCampaignDate(campaign: DripCampaign) {
  const ms = campaignTimestamp(campaign);
  if (!ms) {
    return "No date";
  }
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  paused: "Paused",
};

function PerfPeriodSelect({
  value,
  onChange,
}: {
  value: PerfPeriodDays;
  onChange: (days: PerfPeriodDays) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`perf-period${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="perf-period-trigger"
        aria-label="Performance period"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Last {value} days</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="perf-period-menu" role="listbox" aria-label="Period">
          {PERF_PERIOD_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              role="option"
              aria-selected={value === days}
              className={`perf-period-option${value === days ? " is-active" : ""}`}
              onClick={() => {
                onChange(days);
                setOpen(false);
              }}
            >
              Last {days} days
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PortalDashboard({ firstName }: PortalDashboardProps) {
  const [contactTotal, setContactTotal] = useState<number | null>(null);
  const [contactsInPeriod, setContactsInPeriod] = useState<number | null>(null);
  const [contactPeriodDays, setContactPeriodDays] =
    useState<ContactPeriodDays>(30);
  const [emailsSent, setEmailsSent] = useState<number | null>(null);
  const [sendingLimit, setSendingLimit] = useState(DEFAULT_PROJECT_SENDING_LIMIT);
  const [senderCount, setSenderCount] = useState<number | null>(null);
  const [campaignReports, setCampaignReports] = useState<CampaignStatReport[] | null>(
    null,
  );
  const [perfPeriodDays, setPerfPeriodDays] = useState<PerfPeriodDays>(30);
  const [lastCampaigns, setLastCampaigns] = useState<DripCampaign[] | null>(
    null,
  );
  const [upcomingCampaigns, setUpcomingCampaigns] = useState<
    DripCampaign[] | null
  >(null);
  const [draftCampaigns, setDraftCampaigns] = useState<DripCampaign[]>([]);
  const [recentReplies, setRecentReplies] = useState<RecentReplyThread[] | null>(
    null,
  );
  const perfCardRef = useRef<HTMLDivElement>(null);
  const [upcomingCardHeight, setUpcomingCardHeight] = useState<number | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadContactTotal() {
      try {
        const totalResponse = await fetch("/api/crm/contacts?page=1&pageSize=1");
        const totalData = (await totalResponse.json()) as
          | { total?: number; error?: string }
          | Contact[];
        if (
          !totalResponse.ok ||
          Array.isArray(totalData) ||
          typeof totalData.total !== "number"
        ) {
          return;
        }
        if (cancelled) {
          return;
        }
        setContactTotal(totalData.total);
      } catch {
        // Keep placeholder if the request fails.
      }
    }

    void loadContactTotal();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadContactsInPeriod() {
      setContactsInPeriod(null);
      try {
        const cutoff = new Date(
          Date.now() - contactPeriodDays * DAY_MS,
        ).toISOString();
        const recentResponse = await fetch(
          `/api/crm/contacts?page=1&pageSize=1&createdAfter=${encodeURIComponent(cutoff)}`,
        );
        const recentData = (await recentResponse.json()) as
          | { total?: number; error?: string }
          | Contact[];
        if (cancelled) {
          return;
        }
        setContactsInPeriod(
          recentResponse.ok &&
            !Array.isArray(recentData) &&
            typeof recentData.total === "number"
            ? recentData.total
            : 0,
        );
      } catch {
        if (!cancelled) {
          setContactsInPeriod(0);
        }
      }
    }

    void loadContactsInPeriod();
    return () => {
      cancelled = true;
    };
  }, [contactPeriodDays]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsage() {
      try {
        const [statsResponse, sendersResponse, meResponse] = await Promise.all([
          fetch("/api/campaigns/stats"),
          fetch("/api/smtp/senders"),
          fetch("/api/auth/me"),
        ]);
        const statsData = (await statsResponse.json()) as {
          reports?: CampaignStatReport[];
        };
        const sendersData = (await sendersResponse.json()) as unknown;
        const meData = (await meResponse.json()) as {
          sendingLimit?: number;
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (
          meResponse.ok &&
          typeof meData.sendingLimit === "number" &&
          meData.sendingLimit > 0
        ) {
          setSendingLimit(meData.sendingLimit);
        }

        if (statsResponse.ok && Array.isArray(statsData.reports)) {
          let totalSent = 0;
          for (const report of statsData.reports) {
            totalSent += sentFromReport(report);
          }
          setCampaignReports(statsData.reports);
          setEmailsSent(totalSent);
        } else {
          setCampaignReports([]);
        }

        if (sendersResponse.ok && Array.isArray(sendersData)) {
          setSenderCount(sendersData.length);
        }
      } catch {
        // Keep placeholders if usage requests fail.
      }
    }

    async function loadLastCampaigns() {
      try {
        const response = await fetch("/api/campaigns");
        const data = (await response.json()) as
          | DripCampaign[]
          | { error?: string };
        if (cancelled) {
          return;
        }
        if (!response.ok || !Array.isArray(data)) {
          setUpcomingCampaigns([]);
          setDraftCampaigns([]);
          return;
        }

        const latest = data
          .filter((campaign) => campaign.status === "sent")
          .sort((a, b) => campaignTimestamp(b) - campaignTimestamp(a))
          .slice(0, 4);
        setLastCampaigns(latest);

        const upcoming = data
          .filter(
            (campaign) =>
              campaign.status === "scheduled" || campaign.status === "sending",
          )
          .sort((a, b) => upcomingSortMs(a) - upcomingSortMs(b));
        const drafts = data
          .filter((campaign) => campaign.status === "draft")
          .sort((a, b) => campaignTimestamp(b) - campaignTimestamp(a));

        setUpcomingCampaigns(upcoming.slice(0, UPCOMING_HOME_LIMIT));
        setDraftCampaigns(drafts.slice(0, DRAFT_HOME_LIMIT));
      } catch {
        // Keep the empty state if campaigns fail to load.
        if (!cancelled) {
          setUpcomingCampaigns([]);
          setDraftCampaigns([]);
        }
      }
    }

    async function loadRecentReplies() {
      try {
        const response = await fetch("/api/inbox", { cache: "no-store" });
        const data = (await response.json()) as {
          threads?: RecentReplyThread[];
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (!response.ok || !Array.isArray(data.threads)) {
          setRecentReplies([]);
          return;
        }
        setRecentReplies(data.threads.slice(0, RECENT_REPLY_HOME_LIMIT));
      } catch {
        if (!cancelled) {
          setRecentReplies([]);
        }
      }
    }

    void loadUsage();
    void loadLastCampaigns();
    void loadRecentReplies();
    return () => {
      cancelled = true;
    };
  }, []);

  const perf = useMemo(
    () => buildPerfSeries(campaignReports ?? [], perfPeriodDays),
    [campaignReports, perfPeriodDays],
  );
  const perfLoading = campaignReports === null;

  useEffect(() => {
    const el = perfCardRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const syncHeight = () => {
      const next = Math.round(el.getBoundingClientRect().height);
      if (next > 0) {
        setUpcomingCardHeight(next);
      }
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [perfLoading, perfPeriodDays, perf.points.length]);

  const totalLabel =
    contactTotal === null ? "…" : formatCount(contactTotal);
  const recentLabel =
    contactsInPeriod === null ? "…" : formatCount(contactsInPeriod);
  const emailsSentValue = emailsSent ?? 0;
  const senderCountValue = senderCount ?? 0;
  const emailsBarWidth =
    emailsSent === null
      ? 0
      : Math.min(100, (emailsSentValue / Math.max(sendingLimit, 1)) * 100);
  const sendersBarWidth =
    senderCount === null
      ? 0
      : Math.min(100, (senderCountValue / SENDER_SOFT_LIMIT) * 100);
  const emailsPctLabel =
    emailsSent === null ? "…" : `${Math.round(emailsBarWidth)}%`;
  const sendersPctLabel =
    senderCount === null ? "…" : `${Math.round(sendersBarWidth)}%`;
  const emailsRemainingLabel =
    emailsSent === null
      ? "…"
      : `${formatCount(Math.max(0, sendingLimit - emailsSentValue))} left`;
  const sendersRemainingLabel =
    senderCount === null
      ? "…"
      : `${Math.max(0, SENDER_SOFT_LIMIT - senderCountValue)} slots left`;
  const emailsMeta =
    emailsSent === null
      ? "…"
      : `${formatCount(emailsSentValue)} / ${formatCount(sendingLimit)}`;
  const sendersMeta =
    senderCount === null
      ? "…"
      : `${formatCount(senderCountValue)} / ${SENDER_SOFT_LIMIT}`;

  return (
    <>
      <div className="home-head">
        <h2>Hello {firstName}</h2>
      </div>

      <div className="planner">
        <div className="planner-perf" ref={perfCardRef}>
          <div className="perf-head">
            <h3>Campaign performance</h3>
            <PerfPeriodSelect
              value={perfPeriodDays}
              onChange={setPerfPeriodDays}
            />
          </div>
          <div className="perf-metrics">
            <PerfMetric
              label="Emails sent"
              value={perfLoading ? "…" : formatCount(perf.sent)}
              delta={perf.sentDelta}
              compareLabel={`vs previous ${perfPeriodDays} days`}
            />
            <PerfMetric
              label="Open rate"
              value={perfLoading ? "…" : formatRate(perf.openRate)}
              delta={perf.openDelta}
              compareLabel={`vs previous ${perfPeriodDays} days`}
            />
            <PerfMetric
              label="Reply rate"
              value={perfLoading ? "…" : formatRate(perf.replyRate)}
              delta={perf.replyDelta}
              compareLabel={`vs previous ${perfPeriodDays} days`}
            />
            <PerfMetric
              label="Unsubscribe rate"
              value={perfLoading ? "…" : formatRate(perf.unsubRate)}
              delta={perf.unsubDelta}
              compareLabel={`vs previous ${perfPeriodDays} days`}
              invertGood
            />
          </div>
          <div className="perf-chart">
            {perfLoading ? (
              <div className="perf-chart-empty">Loading…</div>
            ) : (
              <PerfChart points={perf.points} />
            )}
          </div>
          <div className="perf-legend">
            <span>
              <i className="is-sent" /> Sent
            </span>
            <span>
              <i className="is-opened" /> Opened
            </span>
          </div>
        </div>

        <div
          className="planner-day upcoming-card"
          style={
            upcomingCardHeight
              ? { height: upcomingCardHeight, maxHeight: upcomingCardHeight }
              : undefined
          }
        >
          <div className="planner-day-head">
            <h3>Upcoming sends</h3>
            <Link href={PORTAL_ROUTES.drip} className="link-purple">
              View campaigns →
            </Link>
          </div>

          {upcomingCampaigns === null ? (
            <div className="upcoming-empty">Loading…</div>
          ) : (
            <>
              <div className="upcoming-section">
                <div className="upcoming-section-label">
                  {upcomingCampaigns.length > 0
                    ? "Scheduled sends"
                    : draftCampaigns.length > 0
                      ? "Drafts to finish"
                      : "Queue"}
                </div>
                {upcomingCampaigns.length > 0 ? (
                  <div className="upcoming-list">
                    {upcomingCampaigns.map((campaign) => (
                      <Link
                        key={`up-${campaign.kind ?? "drip"}-${campaign.id}`}
                        href={portalCampaignRoute(campaign.id, campaign.kind)}
                        className="upcoming-row"
                      >
                        <div className="upcoming-row-main">
                          <div className="upcoming-name">{campaign.name}</div>
                          <div className="upcoming-meta">
                            <span>
                              {campaign.kind === "oneone" ? "1-1" : "Drip"}
                            </span>
                            <span aria-hidden>·</span>
                            <span>{formatUpcomingWhen(campaign)}</span>
                          </div>
                        </div>
                        <span
                          className={`upcoming-badge${
                            campaign.status === "sending" ? " is-sending" : ""
                          }`}
                        >
                          {campaign.status === "sending"
                            ? "Sending"
                            : "Scheduled"}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : draftCampaigns.length > 0 ? (
                  <div className="upcoming-list">
                    {draftCampaigns.map((campaign) => (
                      <Link
                        key={`draft-${campaign.kind ?? "drip"}-${campaign.id}`}
                        href={portalCampaignRoute(campaign.id, campaign.kind)}
                        className="upcoming-row"
                      >
                        <div className="upcoming-row-main">
                          <div className="upcoming-name">{campaign.name}</div>
                          <div className="upcoming-meta">
                            <span>
                              {campaign.kind === "oneone" ? "1-1" : "Drip"}
                            </span>
                            <span aria-hidden>·</span>
                            <span>Continue editing</span>
                          </div>
                        </div>
                        <span className="upcoming-badge is-draft">Draft</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="upcoming-empty-state is-compact">
                    <div className="upcoming-empty-title">Queue is clear</div>
                    <p>
                      No scheduled or draft campaigns yet. Start one below and
                      it’ll land here.
                    </p>
                  </div>
                )}
              </div>

              <div className="upcoming-section">
                <div className="upcoming-section-head">
                  <div className="upcoming-section-label">Recent replies</div>
                  <Link href={PORTAL_ROUTES.inbox} className="link-purple">
                    Inbox →
                  </Link>
                </div>
                {recentReplies === null ? (
                  <div className="upcoming-empty is-compact">Loading…</div>
                ) : recentReplies.length > 0 ? (
                  <div className="upcoming-list reply-list">
                    {recentReplies.map((thread) => {
                      const who =
                        thread.fromName?.trim() ||
                        thread.fromEmail ||
                        "Unknown";
                      return (
                        <Link
                          key={thread.threadKey}
                          href={PORTAL_ROUTES.inbox}
                          className="upcoming-row reply-row"
                        >
                          <div className="upcoming-row-main">
                            <div className="upcoming-name">{who}</div>
                            <div className="upcoming-meta">
                              <span className="reply-preview">
                                {thread.preview || thread.subject}
                              </span>
                            </div>
                          </div>
                          <div className="reply-row-side">
                            {thread.unreadCount > 0 ? (
                              <span className="upcoming-badge is-reply">
                                New
                              </span>
                            ) : null}
                            <span className="reply-when">
                              {formatReplyWhen(thread.latestAt)}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="upcoming-empty-state is-compact">
                    <div className="upcoming-empty-title">No replies yet</div>
                    <p>Inbound campaign replies will show up here.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="home-grid home-grid-even">
        <div className="home-card contacts-card">
          <div className="home-card-head">
            <h3>Your contacts</h3>
            <div className="home-card-head-right">
              <div
                className="contact-period-filters"
                role="group"
                aria-label="New contacts period"
              >
                {CONTACT_PERIOD_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`contact-period-chip${
                      contactPeriodDays === days ? " is-active" : ""
                    }`}
                    onClick={() => setContactPeriodDays(days)}
                  >
                    {days}d
                  </button>
                ))}
              </div>
              <Link href={PORTAL_ROUTES.contacts} className="link-blue">
                Add contact
              </Link>
            </div>
          </div>
          <div className="contacts-metrics">
            <div className="contacts-metric">
              <div className="contacts-metric-icon" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
                  <path d="M17 8v6M14 11h6" />
                </svg>
              </div>
              <div className="contacts-metric-body">
                <div className="contacts-metric-label">
                  New · last {contactPeriodDays} days
                </div>
                <div className="contacts-metric-value">{recentLabel}</div>
              </div>
            </div>
            <div className="contacts-metric">
              <div className="contacts-metric-icon is-total" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="8" cy="8" r="2.6" />
                  <circle cx="16" cy="8" r="2.6" />
                  <path d="M3.5 19c0-2.6 2-4.4 4.5-4.4S12.5 16.4 12.5 19" />
                  <path d="M11.5 19c0-2.6 2-4.4 4.5-4.4s4.5 1.8 4.5 4.4" />
                </svg>
              </div>
              <div className="contacts-metric-body">
                <div className="contacts-metric-label">Total contacts</div>
                <div className="contacts-metric-value">{totalLabel}</div>
              </div>
            </div>
          </div>
          <div className="home-card-foot">
            <Link href={PORTAL_ROUTES.contacts} className="link-blue">
              Go to Contacts
            </Link>
          </div>
        </div>

        <div className="home-card usage-card">
          <div className="home-card-head">
            <h3>Your plan usage</h3>
            <Link href={PORTAL_ROUTES.smtp} className="link-blue">
              Manage SMTP
            </Link>
          </div>
          <div className="usage-stack">
            <div className="usage-block">
              <div className="usage-block-top">
                <div>
                  <div className="usage-block-label">Emails</div>
                  <div className="usage-block-meta">{emailsMeta}</div>
                </div>
                <div className="usage-block-side">
                  <div className="usage-block-pct">{emailsPctLabel}</div>
                  <div className="usage-block-left">{emailsRemainingLabel}</div>
                </div>
              </div>
              <UsageBar value={emailsBarWidth} />
            </div>
            <div className="usage-block">
              <div className="usage-block-top">
                <div>
                  <div className="usage-block-label">Senders</div>
                  <div className="usage-block-meta">{sendersMeta}</div>
                </div>
                <div className="usage-block-side">
                  <div className="usage-block-pct">{sendersPctLabel}</div>
                  <div className="usage-block-left">{sendersRemainingLabel}</div>
                </div>
              </div>
              <UsageBar value={sendersBarWidth} />
            </div>
          </div>
        </div>
      </div>

      <div className="home-grid home-grid-wide">
        <div className="home-card camp-card">
          <div className="home-card-head">
            <h3>Your last campaigns</h3>
            <Link href={PORTAL_ROUTES.drip} className="link-blue">
              Create a campaign
            </Link>
          </div>
          {lastCampaigns && lastCampaigns.length > 0 ? (
            <div className="camp-list">
              {lastCampaigns.map((campaign) => {
                const recipients = campaign.delivered ?? campaign.recipients ?? 0;
                const opens = campaign.opens ?? 0;
                const clicks = campaign.clicks ?? 0;
                const openRate =
                  recipients > 0 ? (opens / recipients) * 100 : 0;
                const clickRate =
                  recipients > 0 ? (clicks / recipients) * 100 : 0;
                return (
                  <Link
                    key={`${campaign.kind ?? "drip"}-${campaign.id}`}
                    href={portalCampaignRoute(campaign.id, campaign.kind)}
                    className="camp-row"
                  >
                    <div className="camp-row-main">
                      <div className="camp-name">{campaign.name}</div>
                      <div className="camp-meta">
                        <span>{formatCampaignDate(campaign)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {campaign.kind === "oneone" ? "1-1" : "Drip"}
                        </span>
                      </div>
                      <div className="camp-tags">
                        <span className={`status-sent ${campaign.status}`}>
                          <i />
                          {STATUS_LABELS[campaign.status]}
                        </span>
                      </div>
                    </div>
                    <div className="camp-metrics perf-metrics">
                      <div className="perf-metric">
                        <div className="perf-metric-label">Recipients</div>
                        <div className="perf-metric-value">
                          {formatCount(recipients)}
                        </div>
                      </div>
                      <div className="perf-metric">
                        <div className="perf-metric-label">Open rate</div>
                        <div className="perf-metric-value">
                          {openRate.toFixed(1)}%
                        </div>
                        <div className="perf-metric-compare">
                          {formatCount(opens)} opens
                        </div>
                      </div>
                      <div className="perf-metric">
                        <div className="perf-metric-label">Click rate</div>
                        <div className="perf-metric-value">
                          {clickRate.toFixed(1)}%
                        </div>
                        <div className="perf-metric-compare">
                          {formatCount(clicks)} clicks
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="planned-empty">No campaigns yet</div>
          )}
          <div className="home-card-foot">
            <Link href={PORTAL_ROUTES.drip} className="link-blue">
              Go to Campaigns
            </Link>
          </div>
        </div>

        <EmailHealthPanel compact />
      </div>
    </>
  );
}
