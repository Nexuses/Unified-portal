"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ANALYTICS_SHARE_TTL_DAYS,
  defaultAnalyticsRange,
  formatAnalyticsExpiry,
  formatAnalyticsRange,
  formatInt,
  formatPercent,
  presetAnalyticsRange,
  type AnalyticsDashboard,
  type AnalyticsKindStats,
  type AnalyticsPreset,
} from "@/lib/analytics";
import { formatMetric } from "@/lib/drip-campaigns";
import { portalCampaignRoute, publicCampaignReportPath } from "@/lib/portal-nav";

const PRESETS: Array<{ id: AnalyticsPreset; label: string }> = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
];

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function formatDayLabel(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return iso;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatSentAt(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function kindLabel(kind: "drip" | "oneone") {
  return kind === "oneone" ? "1-1" : "Drip";
}

function KindStats({
  title,
  stats,
}: {
  title: string;
  stats: AnalyticsKindStats;
}) {
  return (
    <div className="an-kind-card">
      <h3>{title}</h3>
      <div className="an-kind-grid">
        <div>
          <span>Delivered</span>
          <strong>{formatInt(stats.delivered)}</strong>
        </div>
        <div>
          <span>Opens</span>
          <strong>
            {formatInt(stats.opens)}
            <small>{formatPercent(stats.opens, stats.delivered)}</small>
          </strong>
        </div>
        <div>
          <span>Clicks</span>
          <strong>
            {formatInt(stats.clicks)}
            <small>{formatPercent(stats.clicks, stats.delivered)}</small>
          </strong>
        </div>
        <div>
          <span>Unsub</span>
          <strong>
            {formatInt(stats.unsubscribed)}
            <small>{formatPercent(stats.unsubscribed, stats.delivered)}</small>
          </strong>
        </div>
      </div>
    </div>
  );
}

function DailyChart({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const max = Math.max(
    1,
    ...dashboard.daily.map((point) =>
      Math.max(point.delivered, point.opens, point.clicks),
    ),
  );
  const labelStep = Math.max(1, Math.ceil(dashboard.daily.length / 8));
  const hasActivity = dashboard.daily.some(
    (point) => point.delivered || point.opens || point.clicks,
  );

  if (!hasActivity) {
    return (
      <div className="an-empty">No emails were delivered in this date range.</div>
    );
  }

  return (
    <div className="an-chart" role="img" aria-label="Daily delivered, opens, and clicks">
      {dashboard.daily.map((point, index) => {
        const showLabel =
          index === 0 ||
          index === dashboard.daily.length - 1 ||
          index % labelStep === 0;
        return (
          <div className="an-chart-col" key={point.date} title={`${formatDayLabel(point.date)}: ${point.delivered} delivered, ${point.opens} opens, ${point.clicks} clicks`}>
            <div className="an-chart-bars">
              <span
                className="an-bar delivered"
                style={{
                  height: point.delivered
                    ? `${Math.max(3, (point.delivered / max) * 100)}%`
                    : "0%",
                }}
              />
              <span
                className="an-bar opens"
                style={{
                  height: point.opens
                    ? `${Math.max(3, (point.opens / max) * 100)}%`
                    : "0%",
                }}
              />
              <span
                className="an-bar clicks"
                style={{
                  height: point.clicks
                    ? `${Math.max(3, (point.clicks / max) * 100)}%`
                    : "0%",
                }}
              />
            </div>
            <span className={`an-chart-label${showLabel ? "" : " muted"}`}>
              {showLabel ? formatDayLabel(point.date) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsDashboardView({
  dashboard,
  variant,
  analyticsToken,
}: {
  dashboard: AnalyticsDashboard;
  variant: "portal" | "public";
  analyticsToken?: string;
}) {
  const totals = dashboard.totals;
  const attempted = totals.delivered + totals.failed;
  const metrics = [
    {
      label: "Delivered",
      value: totals.delivered,
      rateLabel: "Delivery rate",
      rate: formatMetric(totals.delivered, attempted || totals.delivered).pct,
    },
    {
      label: "Opens",
      value: totals.opens,
      rateLabel: "Open rate",
      rate: formatMetric(totals.opens, totals.delivered).pct,
    },
    {
      label: "Clicks",
      value: totals.clicks,
      rateLabel: "Click rate",
      rate: formatMetric(totals.clicks, totals.delivered).pct,
    },
    {
      label: "Unsubscribed",
      value: totals.unsubscribed,
      rateLabel: "Unsubscribe rate",
      rate: formatMetric(totals.unsubscribed, totals.delivered).pct,
    },
    {
      label: "Failed",
      value: totals.failed,
      rateLabel: "Failure rate",
      rate: formatMetric(totals.failed, attempted || totals.failed).pct,
    },
  ];

  return (
    <>
      <div className="drip-report-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="drip-report-metric">
            <div className="drip-report-metric-k">{metric.label}</div>
            <div className="drip-report-metric-row">
              <div className="drip-report-metric-v">{formatInt(metric.value)}</div>
            </div>
            <div className="drip-report-metric-rate">
              {metric.rateLabel}
              <strong>{metric.rate}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="an-stat-grid">
        <div className="an-stat-card">
          <span>Campaigns sent</span>
          <strong>{formatInt(totals.campaigns)}</strong>
          <em>
            {formatInt(totals.dripCampaigns)} drip · {formatInt(totals.oneOneCampaigns)} 1-1
          </em>
        </div>
        <div className="an-stat-card">
          <span>Contacts added</span>
          <strong>{formatInt(totals.contactsAdded)}</strong>
          <em>Created in this range</em>
        </div>
        <div className="an-stat-card">
          <span>Automations created</span>
          <strong>{formatInt(totals.automationsCreated)}</strong>
          <em>Created in this range</em>
        </div>
      </div>

      <div className="an-kind-row">
        <KindStats title="Drip campaigns" stats={dashboard.byKind.drip} />
        <KindStats title="1-1 campaigns" stats={dashboard.byKind.oneone} />
      </div>

      <section className="an-section">
        <div className="an-section-head">
          <h3>Daily activity</h3>
          <div className="an-legend">
            <span>
              <i className="delivered" /> Delivered
            </span>
            <span>
              <i className="opens" /> Opens
            </span>
            <span>
              <i className="clicks" /> Clicks
            </span>
          </div>
        </div>
        <DailyChart dashboard={dashboard} />
      </section>

      <section className="an-section">
        <div className="an-section-head">
          <h3>Campaigns</h3>
          <span>{formatInt(dashboard.campaigns.length)} in this range</span>
        </div>
        {dashboard.campaigns.length === 0 ? (
          <div className="an-empty">No campaigns sent in this date range.</div>
        ) : (
          <div className="an-table-wrap">
            <table className="an-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Type</th>
                  <th>Last sent</th>
                  <th>Delivered</th>
                  <th>Opens</th>
                  <th>Clicks</th>
                  <th>Unsub</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.campaigns.map((campaign) => {
                  const publicHref =
                    variant === "public" && campaign.shareToken
                      ? publicCampaignReportPath(campaign.shareToken, {
                          analyticsToken,
                        })
                      : "";
                  const name =
                    variant === "portal" ? (
                      <Link href={portalCampaignRoute(campaign.campaignId, campaign.kind)}>
                        {campaign.name}
                      </Link>
                    ) : publicHref ? (
                      <Link href={publicHref}>
                        {campaign.name}
                        <span className="an-view-report">View report</span>
                      </Link>
                    ) : (
                      campaign.name
                    );
                  return (
                    <tr key={`${campaign.kind}-${campaign.campaignId}`}>
                      <td className="name-cell">{name}</td>
                      <td>
                        <span className={`an-kind-tag ${campaign.kind}`}>
                          {kindLabel(campaign.kind)}
                        </span>
                      </td>
                      <td>{formatSentAt(campaign.sentAt)}</td>
                      <td>{formatInt(campaign.delivered)}</td>
                      <td>
                        {formatInt(campaign.opens)}
                        <span className="an-muted">
                          {formatPercent(campaign.opens, campaign.delivered)}
                        </span>
                      </td>
                      <td>
                        {formatInt(campaign.clicks)}
                        <span className="an-muted">
                          {formatPercent(campaign.clicks, campaign.delivered)}
                        </span>
                      </td>
                      <td>
                        {formatInt(campaign.unsubscribed)}
                        <span className="an-muted">
                          {formatPercent(campaign.unsubscribed, campaign.delivered)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function PortalAnalyticsPage() {
  const defaults = useMemo(() => defaultAnalyticsRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [preset, setPreset] = useState<AnalyticsPreset | "custom">("30d");
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function run() {
      try {
        const response = await fetch(
          `/api/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json()) as AnalyticsDashboard & { error?: string };
        if (controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          throw new Error(data.error || "Failed to load analytics");
        }
        setDashboard(data);
        setShareUrl("");
        setShareExpiresAt("");
        setShareCopied(false);
        setError("");
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setDashboard(null);
        setError(err instanceof Error ? err.message : "Failed to load analytics");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => controller.abort();
  }, [from, to]);

  function applyRange(nextFrom: string, nextTo: string, nextPreset: AnalyticsPreset | "custom") {
    setPreset(nextPreset);
    setFrom(nextFrom);
    setTo(nextTo);
    setLoading(true);
  }

  function applyPreset(next: AnalyticsPreset) {
    const range = presetAnalyticsRange(next);
    applyRange(range.from, range.to, next);
  }

  async function createPublicUrl() {
    setSharing(true);
    setError("");
    try {
      const response = await fetch("/api/analytics/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = (await response.json()) as {
        url?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Failed to create public URL");
      }
      setShareUrl(data.url);
      setShareExpiresAt(data.expiresAt ?? "");
      await copyText(data.url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create public URL");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="an-page">
      <div className="crm-page-head an-page-head">
        <div>
          <h2>Report</h2>
          <p className="desc">
            Project-wide email performance for {formatAnalyticsRange(from, to)}.
            Public URLs expire after {ANALYTICS_SHARE_TTL_DAYS} days.
          </p>
        </div>
        <div className="crm-actions">
          <span className="an-share-note">Expires in {ANALYTICS_SHARE_TTL_DAYS} days</span>
          <button
            type="button"
            className="btn-dark"
            onClick={() => void createPublicUrl()}
            disabled={sharing || loading}
          >
            {shareCopied ? "Public URL copied" : sharing ? "Creating…" : "Create public URL"}
          </button>
        </div>
      </div>

      <div className="an-filters">
        <div className="an-presets">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={preset === item.id ? "active" : ""}
              onClick={() => applyPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="an-range">
          <label>
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => applyRange(event.target.value, to, "custom")}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => applyRange(from, event.target.value, "custom")}
            />
          </label>
        </div>
      </div>

      {shareUrl ? (
        <div className="an-share-banner">
          <span>Share this range with a client:</span>
          <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
          <span className="an-share-expiry">
            Expires on{" "}
            {shareExpiresAt
              ? formatAnalyticsExpiry(shareExpiresAt)
              : formatAnalyticsExpiry(
                  new Date(Date.now() + ANALYTICS_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000),
                )}
            . Public links last {ANALYTICS_SHARE_TTL_DAYS} days.
          </span>
        </div>
      ) : null}

      {error ? <div className="an-error">{error}</div> : null}
      {loading && !dashboard ? <div className="an-empty">Loading analytics…</div> : null}
      {dashboard ? (
        <div className={loading ? "an-loading" : undefined}>
          <AnalyticsDashboardView dashboard={dashboard} variant="portal" />
        </div>
      ) : null}
    </div>
  );
}

export function PublicAnalyticsReport({
  dashboard,
  analyticsToken,
}: {
  dashboard: AnalyticsDashboard;
  analyticsToken: string;
}) {
  return (
    <div className="an-page an-public">
      <AnalyticsDashboardView
        dashboard={dashboard}
        variant="public"
        analyticsToken={analyticsToken}
      />
    </div>
  );
}
