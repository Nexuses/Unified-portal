"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ANALYTICS_SHARE_TTL_DAYS,
  DEFAULT_ANALYTICS_INCLUDE_KINDS,
  defaultAnalyticsRange,
  formatAnalyticsExpiry,
  formatAnalyticsRange,
  formatInt,
  formatPercent,
  presetAnalyticsRange,
  type AnalyticsDashboard,
  type AnalyticsIncludeKinds,
  type AnalyticsKindStats,
  type AnalyticsPreset,
} from "@/lib/analytics";
import { formatMetric } from "@/lib/drip-campaigns";
import { portalCampaignRoute, publicCampaignReportPath } from "@/lib/portal-nav";

type ShareBotMode = "show" | "hide" | "toggle";

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

function kindLabel(kind: "drip" | "oneone", personalise?: boolean) {
  if (personalise) {
    return "Personalise";
  }
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
  hideBotClicks = false,
  botToggle = false,
}: {
  dashboard: AnalyticsDashboard;
  variant: "portal" | "public";
  analyticsToken?: string;
  hideBotClicks?: boolean;
  botToggle?: boolean;
}) {
  const totals = dashboard.totals;
  /** Public share filters omit unselected kinds from byKind; portal keeps all three. */
  const kindsFiltered =
    dashboard.byKind.drip == null ||
    dashboard.byKind.oneone == null ||
    dashboard.byKind.personalise == null;
  const showDrip = dashboard.byKind.drip != null;
  const showOneOne = dashboard.byKind.oneone != null;
  const showPersonalise =
    dashboard.byKind.personalise != null &&
    (kindsFiltered || (totals.personaliseCampaigns ?? 0) > 0);
  const kindCardCount =
    Number(showDrip) + Number(showOneOne) + Number(showPersonalise);
  const campaignKindParts = [
    showDrip ? `${formatInt(totals.dripCampaigns)} drip` : null,
    showOneOne ? `${formatInt(totals.oneOneCampaigns)} 1-1` : null,
    showPersonalise
      ? `${formatInt(totals.personaliseCampaigns ?? 0)} personalise`
      : null,
  ].filter(Boolean);
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
          <em>{campaignKindParts.join(" · ") || "No campaign types selected"}</em>
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

      {kindCardCount > 0 ? (
        <div
          className={`an-kind-row${kindCardCount >= 3 ? " has-three" : kindCardCount === 1 ? " has-one" : ""}`}
        >
          {showDrip && dashboard.byKind.drip ? (
            <KindStats title="Drip campaigns" stats={dashboard.byKind.drip} />
          ) : null}
          {showOneOne && dashboard.byKind.oneone ? (
            <KindStats title="1-1 campaigns" stats={dashboard.byKind.oneone} />
          ) : null}
          {showPersonalise && dashboard.byKind.personalise ? (
            <KindStats
              title="Personalise campaigns"
              stats={dashboard.byKind.personalise}
            />
          ) : null}
        </div>
      ) : null}

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
                          ...(botToggle || hideBotClicks
                            ? { hideBotClicks }
                            : {}),
                        })
                      : "";
                  const name =
                    variant === "portal" ? (
                      <Link
                        href={portalCampaignRoute(
                          campaign.campaignId,
                          campaign.kind,
                          campaign.personalise ? ["personalise"] : undefined,
                        )}
                        title={campaign.name}
                      >
                        <span className="an-campaign-name">{campaign.name}</span>
                      </Link>
                    ) : publicHref ? (
                      <Link href={publicHref} title={campaign.name}>
                        <span className="an-campaign-name">{campaign.name}</span>
                        <span className="an-view-report">View report</span>
                      </Link>
                    ) : (
                      <span className="an-campaign-name" title={campaign.name}>
                        {campaign.name}
                      </span>
                    );
                  return (
                    <tr key={`${campaign.kind}-${campaign.campaignId}`}>
                      <td className="name-cell" data-label="Campaign">
                        {name}
                      </td>
                      <td data-label="Type">
                        <span
                          className={`an-kind-tag ${campaign.personalise ? "personalise" : campaign.kind}`}
                        >
                          {kindLabel(campaign.kind, campaign.personalise)}
                        </span>
                      </td>
                      <td data-label="Last sent">{formatSentAt(campaign.sentAt)}</td>
                      <td data-label="Delivered">{formatInt(campaign.delivered)}</td>
                      <td data-label="Opens">
                        {formatInt(campaign.opens)}
                        <span className="an-muted">
                          {formatPercent(campaign.opens, campaign.delivered)}
                        </span>
                      </td>
                      <td data-label="Clicks">
                        {formatInt(campaign.clicks)}
                        <span className="an-muted">
                          {formatPercent(campaign.clicks, campaign.delivered)}
                        </span>
                      </td>
                      <td data-label="Unsub">
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

  const [sharePromptOpen, setSharePromptOpen] = useState(false);
  const [instantClickEnabled, setInstantClickEnabled] = useState(false);
  const [shareIncludeKinds, setShareIncludeKinds] =
    useState<AnalyticsIncludeKinds>(() => ({
      ...DEFAULT_ANALYTICS_INCLUDE_KINDS,
    }));
  const [sharePromptError, setSharePromptError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await response.json()) as { instantClick?: boolean };
        if (!cancelled && response.ok) {
          setInstantClickEnabled(Boolean(data.instantClick));
        }
      } catch {
        // Bot share prompt stays off if session lookup fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort("timeout");
    }, 60_000);

    async function run() {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json()) as AnalyticsDashboard & {
          error?: string;
        };
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
        if (controller.signal.reason === "timeout") {
          setError(
            "Analytics is taking too long. Check your connection and retry.",
          );
          setLoading(false);
          return;
        }
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load analytics",
        );
      } finally {
        window.clearTimeout(timeoutId);
        if (
          !controller.signal.aborted ||
          controller.signal.reason === "timeout"
        ) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [from, to, reloadToken]);

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

  function openSharePrompt() {
    setShareIncludeKinds({ ...DEFAULT_ANALYTICS_INCLUDE_KINDS });
    setSharePromptError("");
    setSharePromptOpen(true);
  }

  async function createPublicUrl(mode: ShareBotMode | "plain") {
    if (
      !shareIncludeKinds.drip &&
      !shareIncludeKinds.oneone &&
      !shareIncludeKinds.personalise
    ) {
      setSharePromptError(
        "Select at least one campaign type (Drip, 1-1, or Personalise).",
      );
      return;
    }
    setSharePromptOpen(false);
    setSharePromptError("");
    setSharing(true);
    setError("");
    try {
      const response = await fetch("/api/analytics/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          hideBotClicks: mode === "hide" || mode === "toggle",
          botToggle: mode === "toggle",
          includeKinds: shareIncludeKinds,
        }),
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
            onClick={openSharePrompt}
            disabled={sharing || loading}
          >
            {shareCopied ? "Public URL copied" : sharing ? "Creating…" : "Create public URL"}
          </button>
        </div>
      </div>

      {sharePromptOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => !sharing && setSharePromptOpen(false)}
          role="presentation"
        >
          <div
            className="crm-modal an-share-bot-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="an-share-bot-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="an-share-bot-title">Create public URL</h3>
                <p>
                  Pick campaign types to include
                  {instantClickEnabled
                    ? ", then choose how bot opens/clicks appear."
                    : "."}
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                disabled={sharing}
                onClick={() => setSharePromptOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="an-share-modal-body">
              <div className="an-share-section-label">Campaign types</div>
              <div className="an-share-kind-checks" role="group" aria-label="Campaign types">
                {(
                  [
                    { key: "drip", label: "Drip" },
                    { key: "oneone", label: "1-1" },
                    { key: "personalise", label: "Personalise" },
                  ] as const
                ).map((item) => {
                  const checked = shareIncludeKinds[item.key];
                  return (
                    <label
                      key={item.key}
                      className={`an-share-kind-check${checked ? " is-checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={sharing}
                        onChange={(event) => {
                          setSharePromptError("");
                          setShareIncludeKinds((current) => ({
                            ...current,
                            [item.key]: event.target.checked,
                          }));
                        }}
                      />
                      <span className="an-share-kind-box" aria-hidden="true">
                        {checked ? (
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                            <path
                              d="M3.5 8.2 6.4 11l6.1-6.5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
              {sharePromptError ? (
                <div className="an-share-prompt-error">{sharePromptError}</div>
              ) : null}
            </div>
            <div className="an-share-bot-actions">
              {instantClickEnabled ? (
                <>
                  <button
                    type="button"
                    className="btn-soft an-share-action-btn"
                    disabled={sharing}
                    onClick={() => void createPublicUrl("show")}
                  >
                    Show bots
                  </button>
                  <button
                    type="button"
                    className="btn-soft an-share-action-btn"
                    disabled={sharing}
                    onClick={() => void createPublicUrl("hide")}
                  >
                    Hide bots
                  </button>
                  <button
                    type="button"
                    className="btn-dark an-share-action-btn"
                    disabled={sharing}
                    onClick={() => void createPublicUrl("toggle")}
                  >
                    Export with toggle
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-dark an-share-action-btn"
                  disabled={sharing}
                  onClick={() => void createPublicUrl("plain")}
                >
                  Create public URL
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
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

      {error ? (
        <div className="an-error">
          {error}{" "}
          <button
            type="button"
            className="an-retry-btn"
            disabled={loading}
            onClick={() => {
              setError("");
              setReloadToken((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
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
  dashboardWithBots,
  analyticsToken,
  hideBotClicks = false,
  botToggle = false,
}: {
  dashboard: AnalyticsDashboard;
  /** When Export with toggle: metrics including bot opens/clicks. */
  dashboardWithBots?: AnalyticsDashboard;
  analyticsToken: string;
  hideBotClicks?: boolean;
  botToggle?: boolean;
}) {
  const [hideBots, setHideBots] = useState(Boolean(hideBotClicks));
  const showBotEngagement = !hideBots;
  const activeDashboard =
    botToggle && dashboardWithBots && !hideBots ? dashboardWithBots : dashboard;

  return (
    <div className="an-page an-public">
      {botToggle ? (
        <div className="an-public-bot-bar">
          <button
            type="button"
            role="switch"
            aria-checked={showBotEngagement}
            className={`drip-report-table-toggle drip-report-bot-nav-toggle${showBotEngagement ? " is-on" : ""}`}
            onClick={() => setHideBots((value) => !value)}
            title={
              showBotEngagement
                ? "Bot opens/clicks included in opens, clicks, and linked reports"
                : "Bot opens/clicks hidden from opens, clicks, and linked reports"
            }
          >
            <span className="drip-report-table-switch" aria-hidden="true" />
            Show bot opens/clicks
          </button>
        </div>
      ) : null}
      <AnalyticsDashboardView
        dashboard={activeDashboard}
        variant="public"
        analyticsToken={analyticsToken}
        hideBotClicks={hideBots}
        botToggle={botToggle}
      />
    </div>
  );
}
