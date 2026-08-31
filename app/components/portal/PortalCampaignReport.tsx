"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  formatCampaignClock,
  formatMetric,
  mergeBlastReport,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { PORTAL_ROUTES, portalContactRoute, portalListRoute, publicCampaignReportPath } from "@/lib/portal-nav";

type PeopleView = "delivered" | "opens" | "clicks" | "unsubscribes" | "audience";

type SendRecipient = {
  id: string;
  email: string;
  fullName: string;
  companyName: string;
  contactId?: string;
  sentAt?: string;
  openedAt?: string;
  clickedAt?: string;
  clickedUrl?: string;
  unsubscribedAt?: string;
};

const PEOPLE_TITLES: Record<PeopleView, string> = {
  delivered: "Delivered",
  opens: "Opens",
  clicks: "Clicks",
  unsubscribes: "Unsubscribes",
  audience: "Campaign audience",
};

const TAB_TO_PEOPLE: Record<string, PeopleView | null> = {
  overview: null,
  deliverability: "delivered",
  opens: "opens",
  clicks: "clicks",
  conversions: null,
  unsubscribes: "unsubscribes",
};

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S14.4 16 15 19" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16.2 19c.3-1.8 1.5-3.1 3.3-3.6" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.4-1.1.8-1.1 1.6" />
      <circle cx="12" cy="16.6" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TimelineIcon({ type }: { type: "draft" | "scheduled" | "sent" }) {
  if (type === "sent") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m22 2-7 20-4-9-9-4Z" strokeLinejoin="round" />
        <path d="M22 2 11 13" />
      </svg>
    );
  }
  if (type === "scheduled") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function ReportToast({
  message,
  variant = "success",
  durationMs = 4000,
  onDone,
}: {
  message: string;
  variant?: "error" | "success";
  durationMs?: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
    // Toast is remounted with a new key when shown again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div className={`drip-error-toast${variant === "success" ? " success" : ""}`} role="status">
      <div className="drip-error-toast-body">
        <span className="drip-error-toast-icon" aria-hidden="true">
          {variant === "success" ? (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="currentColor" />
              <path d="M7.5 12.5 10.5 15.5 16.5 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="currentColor" />
              <path d="M12 10.5v6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="7.4" r="1.15" fill="#fff" />
            </svg>
          )}
        </span>
        <span className="drip-error-toast-text">{message}</span>
      </div>
      <div className="drip-error-toast-progress" aria-hidden="true">
        <span style={{ animationDuration: `${durationMs}ms` }} />
      </div>
    </div>
  );
}

function rate(value: number, total: number) {
  return formatMetric(value, total).pct;
}

function linkLabel(url?: string) {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return "—";
  }
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

export default function PortalCampaignReport({
  campaign,
  onCampaignChange,
  publicToken,
}: {
  campaign: DripCampaign;
  onCampaignChange?: (campaign: DripCampaign) => void;
  publicToken?: string;
}) {
  const [tab, setTab] = useState("overview");
  const [peopleView, setPeopleView] = useState<PeopleView | null>(null);
  const [people, setPeople] = useState<SendRecipient[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareToast, setShareToast] = useState<{
    key: number;
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const isPublic = Boolean(publicToken);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        if (publicToken) {
          const response = await fetch(
            `/api/public/reports/${encodeURIComponent(publicToken)}`,
            { cache: "no-store" },
          );
          const data = await response.json();
          if (cancelled || !response.ok || !onCampaignChange) {
            return;
          }
          onCampaignChange(data as DripCampaign);
          return;
        }

        await fetch("/api/campaigns/process-due", { method: "POST" });
        const response = await fetch("/api/campaigns/stats");
        const data = await response.json();
        if (cancelled || !response.ok) {
          return;
        }
        const report = (
          data.reports as Array<Parameters<typeof mergeBlastReport>[1]>
        ).find((item) => item.campaignId === campaign.id);
        if (report && onCampaignChange) {
          onCampaignChange(mergeBlastReport(campaign, report));
        }
      } catch {
        // Keep showing the last known stats.
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [campaign.id, publicToken]);

  useEffect(() => {
    if (!peopleView) {
      setPeople([]);
      setPeopleError("");
      setPeopleSearch("");
      return;
    }

    let cancelled = false;
    async function loadPeople() {
      setPeopleLoading(true);
      setPeopleError("");
      try {
        const response = await fetch(
          publicToken
            ? `/api/public/reports/${encodeURIComponent(publicToken)}/recipients?filter=${peopleView}`
            : `/api/campaigns/${encodeURIComponent(campaign.id)}/recipients?filter=${peopleView}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Failed to load contacts",
          );
        }
        setPeople(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!cancelled) {
          setPeople([]);
          setPeopleError(
            error instanceof Error ? error.message : "Failed to load contacts",
          );
        }
      } finally {
        if (!cancelled) {
          setPeopleLoading(false);
        }
      }
    }

    void loadPeople();
    return () => {
      cancelled = true;
    };
  }, [campaign.id, peopleView, publicToken]);

  const visiblePeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    if (!query) {
      return people;
    }
    return people.filter(
      (person) =>
        person.fullName.toLowerCase().includes(query) ||
        person.email.toLowerCase().includes(query) ||
        person.companyName.toLowerCase().includes(query) ||
        (person.clickedUrl ?? "").toLowerCase().includes(query),
    );
  }, [people, peopleSearch]);

  function openPeople(view: PeopleView) {
    setPeopleView(view);
    const nextTab = Object.entries(TAB_TO_PEOPLE).find(([, value]) => value === view)?.[0];
    if (nextTab) {
      setTab(nextTab);
    }
  }

  function handleTabChange(label: string) {
    const next = label.toLowerCase();
    setTab(next);
    setPeopleView(TAB_TO_PEOPLE[next] ?? null);
  }

  async function exportReport() {
    if (exporting) {
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(
        publicToken
          ? `/api/public/reports/${encodeURIComponent(publicToken)}/export`
          : `/api/campaigns/${encodeURIComponent(campaign.id)}/export`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to export report",
        );
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const asciiName = disposition.match(/filename="([^"]+)"/i)?.[1];
      const filename = utfName
        ? decodeURIComponent(utfName)
        : asciiName || `${campaign.name} Report.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Failed to export report",
      );
    } finally {
      setExporting(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
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
  }

  async function shareReport() {
    try {
      let path = publicToken ? publicCampaignReportPath(publicToken) : "";
      if (!publicToken) {
        const response = await fetch(
          `/api/campaigns/${encodeURIComponent(campaign.id)}/share`,
          { method: "POST", cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Failed to copy link",
          );
        }
        path = publicCampaignReportPath(String(data.token ?? ""));
      }
      if (!path || path === "/r/") {
        throw new Error("Failed to copy link");
      }
      const url = `${window.location.origin}${path}`;
      await copyText(url);
      setShareCopied(true);
      setShareToast({
        key: Date.now(),
        variant: "success",
        message: "Report link copied",
      });
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch (error) {
      setShareToast({
        key: Date.now(),
        variant: "error",
        message: error instanceof Error ? error.message : "Failed to copy link",
      });
    }
  }

  const timezone = campaign.timezone || "Asia/Kolkata";
  const sentLabel = campaign.sentAt
    ? formatCampaignClock(campaign.sentAt, timezone)
    : campaign.scheduledAt
      ? formatCampaignClock(campaign.scheduledAt, timezone)
      : "";
  const from = campaign.senderName
    ? `${campaign.senderName} <${campaign.senderEmail}>`
    : campaign.senderEmail;
  const replyTo = campaign.replyToEnabled
    ? campaign.replyToEmail
    : campaign.senderEmail;
  const delivered = campaign.delivered ?? campaign.recipients;
  const metrics = [
    {
      label: "Delivered",
      value: delivered,
      rateLabel: "Delivery rate",
      rate: rate(delivered, campaign.recipients || delivered),
      view: "delivered" as PeopleView | false,
    },
    {
      label: "Opens",
      value: campaign.opens,
      rateLabel: "Open rate",
      rate: rate(campaign.opens, campaign.recipients),
      view: "opens" as PeopleView | false,
    },
    {
      label: "Clicks",
      value: campaign.clicks,
      rateLabel: "Click-through rate",
      rate: rate(campaign.clicks, campaign.recipients),
      view: "clicks" as PeopleView | false,
    },
    {
      label: "Conversions",
      value: campaign.conversions,
      rateLabel: "Conversion rate",
      rate: rate(campaign.conversions, campaign.recipients),
      view: false as PeopleView | false,
    },
    {
      label: "Unsubscribes",
      value: campaign.unsubscribed,
      rateLabel: "Unsubscribe rate",
      rate: rate(campaign.unsubscribed, campaign.recipients),
      view: "unsubscribes" as PeopleView | false,
    },
  ];

  const timeline = [...(campaign.timeline ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  return (
    <div className="drip-report-page">
      <div className="drip-report-head">
        {isPublic ? null : (
          <Link href={PORTAL_ROUTES.drip} className="drip-back" aria-label="Back to campaigns">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
        <div className="drip-report-thumb">
          {campaign.designHtml ? (
            <iframe title="Campaign preview" srcDoc={campaign.designHtml} />
          ) : null}
        </div>
        <div className="drip-report-head-copy">
          <h2>{campaign.name}</h2>
          <div className="drip-report-meta">
            #{campaign.id}
            {sentLabel ? ` • Sent on ${sentLabel}` : campaign.status === "scheduled" ? " • Scheduled" : ""}
          </div>
          <div className="drip-report-fields">
            <div>
              <span>Subject</span>
              <strong>{campaign.subject}</strong>
            </div>
            <div>
              <span>From</span>
              <strong title={from}>{from}</strong>
            </div>
            <div>
              <span>Reply to</span>
              <strong title={replyTo}>{replyTo}</strong>
            </div>
          </div>
        </div>
        <div className="drip-report-actions">
          <button
            type="button"
            className={`drip-report-share${shareCopied ? " copied" : ""}`}
            aria-label={shareCopied ? "Link copied" : "Copy report link"}
            title={shareCopied ? "Link copied" : "Copy report link"}
            onClick={() => void shareReport()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="m8.7 13.4 6.6 3.8M15.3 6.8 8.7 10.6" />
            </svg>
          </button>
          <button
            type="button"
            className="drip-report-export"
            onClick={() => void exportReport()}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Export report"}
          </button>
        </div>
      </div>
      {exportError ? <p className="drip-report-export-error">{exportError}</p> : null}
      {shareToast ? (
        <ReportToast
          key={shareToast.key}
          variant={shareToast.variant}
          message={shareToast.message}
          onDone={() => setShareToast(null)}
        />
      ) : null}

      <div className="drip-report-tabs">
        {["Overview", "Deliverability", "Opens", "Clicks", "Conversions", "Unsubscribes"].map(
          (label) => (
            <button
              key={label}
              type="button"
              className={tab === label.toLowerCase() ? "active" : ""}
              onClick={() => handleTabChange(label)}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className="drip-report-section-head">
        <h3>Campaign performance</h3>
        <span>
          • Automated opens and clicks included.
          <HelpIcon />
        </span>
      </div>

      <div className="drip-report-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="drip-report-metric">
            <div className="drip-report-metric-k">{metric.label}</div>
            <div className="drip-report-metric-row">
              <div className="drip-report-metric-v">{metric.value}</div>
              {metric.view ? (
                <button
                  type="button"
                  className="drip-report-view"
                  onClick={() => openPeople(metric.view as PeopleView)}
                >
                  <PeopleIcon />
                  View
                </button>
              ) : null}
            </div>
            <div className="drip-report-metric-rate">
              {metric.rateLabel}
              <strong>{metric.rate}</strong>
            </div>
          </div>
        ))}
      </div>

      {peopleView ? (
        <>
          <div className="crm-page-head drip-report-people-head">
            <div>
              <h3 className="drip-report-audience-title">{PEOPLE_TITLES[peopleView]}</h3>
              <p className="desc">
                {peopleView === "opens"
                  ? "Contacts who opened this campaign, with date and time."
                  : peopleView === "clicks"
                    ? "Links clicked in this campaign, with date and time."
                    : "Contacts in this campaign metric."}
              </p>
            </div>
          </div>

          <div className="crm-meta-row">
            <div className="crm-count">
              {peopleLoading
                ? "Loading..."
                : `${visiblePeople.length} ${peopleView === "clicks" ? "clicks" : "contacts"}`}
            </div>
            <div className="crm-meta-right">
              <div className="search-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3-3" />
                </svg>
                <input
                  type="search"
                  placeholder="Search"
                  value={peopleSearch}
                  onChange={(event) => setPeopleSearch(event.target.value)}
                  className="lists-search-input"
                />
              </div>
            </div>
          </div>

          {peopleError ? <div className="crm-error">{peopleError}</div> : null}

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="chk">
                    <input type="checkbox" readOnly />
                  </th>
                  <th>Contact</th>
                  <th>Email</th>
                  {peopleView === "delivered" ? <th>Delivered</th> : null}
                  {peopleView === "opens" ? <th>Opened</th> : null}
                  {peopleView === "clicks" ? (
                    <>
                      <th>Link clicked</th>
                      <th>Clicked</th>
                    </>
                  ) : null}
                  {peopleView === "unsubscribes" ? <th>Unsubscribed</th> : null}
                  {peopleView === "audience" ? <th>Company</th> : null}
                </tr>
              </thead>
              <tbody>
                {peopleLoading ? (
                  <tr>
                    <td colSpan={peopleView === "clicks" ? 6 : 5} className="crm-empty">
                      Loading contacts...
                    </td>
                  </tr>
                ) : visiblePeople.length === 0 ? (
                  <tr>
                    <td colSpan={peopleView === "clicks" ? 6 : 5} className="crm-empty">
                      No contacts in this view yet.
                    </td>
                  </tr>
                ) : (
                  visiblePeople.map((person) => (
                    <tr key={person.id}>
                      <td className="chk">
                        <input type="checkbox" readOnly />
                      </td>
                      <td>
                        {person.contactId && !isPublic ? (
                          <Link href={portalContactRoute(person.contactId)} className="name-link">
                            {person.fullName}
                          </Link>
                        ) : (
                          <span className="name-link">{person.fullName}</span>
                        )}
                      </td>
                      <td className="email-cell">{person.email}</td>
                      {peopleView === "delivered" ? (
                        <td>
                          {person.sentAt
                            ? formatCampaignClock(person.sentAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "opens" ? (
                        <td>
                          {person.openedAt
                            ? formatCampaignClock(person.openedAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "clicks" ? (
                        <>
                          <td>
                            {person.clickedUrl ? (
                              <a
                                href={person.clickedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="name-link"
                              >
                                {linkLabel(person.clickedUrl)}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {person.clickedAt
                              ? formatCampaignClock(person.clickedAt, timezone)
                              : "—"}
                          </td>
                        </>
                      ) : null}
                      {peopleView === "unsubscribes" ? (
                        <td>
                          {person.unsubscribedAt
                            ? formatCampaignClock(person.unsubscribedAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "audience" ? (
                        <td>{person.companyName || "—"}</td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <h3 className="drip-report-audience-title">Campaign audience</h3>
          <div className="drip-report-lists-label">
            Included lists
            <span className="drip-report-plus">+</span>
          </div>
          <div className="drip-report-list-card">
            <div>
              {campaign.listDisplayId ? `#${campaign.listDisplayId} ` : ""}
              {campaign.listName || "Selected recipients"}
            </div>
            <div>{campaign.recipients} contacts</div>
            {campaign.listId && !isPublic ? (
              <Link href={portalListRoute(campaign.listId)} className="drip-report-view">
                <PeopleIcon />
                View
              </Link>
            ) : (
              <button type="button" className="drip-report-view" onClick={() => openPeople("audience")}>
                <PeopleIcon />
                View
              </button>
            )}
          </div>

          <h3 className="drip-report-audience-title">Timeline</h3>
          <div className="drip-report-timeline">
            {timeline.length === 0 ? (
              <div className="drip-report-empty">No timeline events yet.</div>
            ) : (
              timeline.map((event) => (
                <div key={event.id} className="drip-report-event">
                  <div className="drip-report-event-icon">
                    <TimelineIcon type={event.type} />
                  </div>
                  <div>
                    <div className="drip-report-event-title">{event.title}</div>
                    <div className="drip-report-event-copy">{event.description}</div>
                    <div className="drip-report-event-at">
                      {formatCampaignClock(event.at, timezone)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SharedCampaignReport({
  campaign,
  publicToken,
}: {
  campaign: DripCampaign;
  publicToken: string;
}) {
  const [current, setCurrent] = useState(campaign);
  return (
    <PortalCampaignReport
      campaign={current}
      publicToken={publicToken}
      onCampaignChange={setCurrent}
    />
  );
}
