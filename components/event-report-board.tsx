"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { EventReportPayload } from "@/lib/event-report";
import { eventFormatLabel } from "@/lib/event-format";

const PAGE_SIZE = 50;

type PeopleFilter = "all" | "invite_to" | "invited" | "going" | "waitlist" | "rejected";

type EventReportBoardProps = {
  report: EventReportPayload;
  /** When set, report is public/read-only and uses public APIs. */
  publicToken?: string;
};

function statusClass(status: string) {
  const key = status.toLowerCase();
  if (key === "going") return "is-clicked";
  if (key === "invited") return "is-opened";
  return "";
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.7 13.4 6.6 3.8M15.3 6.8 8.7 10.6" />
    </svg>
  );
}

export function EventReportBoard({ report, publicToken }: EventReportBoardProps) {
  const [showBotClicks, setShowBotClicks] = useState(false);
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [page, setPage] = useState(1);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const isPublic = Boolean(publicToken);

  const scopedPeople = useMemo(() => {
    if (showBotClicks) {
      return report.people;
    }
    return report.people.filter((person) => !person.botClick);
  }, [report.people, showBotClicks]);

  const scopedMetrics = useMemo(() => {
    let inviteTo = 0;
    let invited = 0;
    let going = 0;
    let waitlist = 0;
    let rejected = 0;
    let botClicks = 0;
    let registrations = 0;
    for (const person of scopedPeople) {
      if (person.status === "Invite to") inviteTo += 1;
      else if (person.status === "Invited") invited += 1;
      else if (person.status === "Going") going += 1;
      else if (person.status === "Waitlist") waitlist += 1;
      else if (person.status === "Rejected") rejected += 1;
      if (person.botClick) botClicks += 1;
      if (person.source === "Registration") registrations += 1;
    }
    return {
      pageViews: report.metrics.pageViews,
      uniqueVisitors: report.metrics.uniqueVisitors,
      conversionRate: report.metrics.conversionRate,
      totalPeople: scopedPeople.length,
      inviteTo,
      invited,
      going,
      waitlist,
      rejected,
      botClicks: showBotClicks ? botClicks : 0,
      registrations,
    };
  }, [scopedPeople, showBotClicks, report.metrics]);

  const filterTabs = useMemo(() => {
    const tabs: Array<{ id: PeopleFilter; label: string; count: number }> = [
      { id: "all", label: "All", count: scopedMetrics.totalPeople },
      { id: "invite_to", label: "Invite to", count: scopedMetrics.inviteTo },
      { id: "invited", label: "Invited", count: scopedMetrics.invited },
      { id: "going", label: "Going", count: scopedMetrics.going },
    ];
    if (scopedMetrics.waitlist > 0 || report.metrics.waitlist > 0) {
      tabs.push({ id: "waitlist", label: "Waitlist", count: scopedMetrics.waitlist });
    }
    if (scopedMetrics.rejected > 0 || report.metrics.rejected > 0) {
      tabs.push({ id: "rejected", label: "Rejected", count: scopedMetrics.rejected });
    }
    return tabs;
  }, [scopedMetrics, report.metrics.waitlist, report.metrics.rejected]);

  const visiblePeople = useMemo(() => {
    if (peopleFilter === "all") return scopedPeople;
    const wanted =
      peopleFilter === "invite_to"
        ? "Invite to"
        : peopleFilter === "invited"
          ? "Invited"
          : peopleFilter === "going"
            ? "Going"
            : peopleFilter === "waitlist"
              ? "Waitlist"
              : "Rejected";
    return scopedPeople.filter((person) => person.status === wanted);
  }, [scopedPeople, peopleFilter]);

  const totalPages = Math.max(1, Math.ceil(visiblePeople.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedPeople = visiblePeople.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const rangeStart =
    visiblePeople.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, visiblePeople.length);

  const metricCards = [
    {
      label: "Page views",
      value: scopedMetrics.pageViews,
      rateLabel: "Unique visitors",
      rate: scopedMetrics.uniqueVisitors.toLocaleString(),
    },
    {
      label: "People",
      value: scopedMetrics.totalPeople,
      rateLabel: "Registrations",
      rate: scopedMetrics.registrations.toLocaleString(),
    },
    {
      label: "Invited",
      value: scopedMetrics.invited,
      rateLabel: "Invite rate",
      rate:
        scopedMetrics.totalPeople > 0
          ? `${Math.round((scopedMetrics.invited / scopedMetrics.totalPeople) * 1000) / 10}%`
          : "0%",
    },
    {
      label: "Going",
      value: scopedMetrics.going,
      rateLabel: "Going rate",
      rate:
        scopedMetrics.totalPeople > 0
          ? `${Math.round((scopedMetrics.going / scopedMetrics.totalPeople) * 1000) / 10}%`
          : "0%",
    },
    {
      label: "Conversion",
      value: `${scopedMetrics.conversionRate}%`,
      rateLabel: "Bot clicks",
      rate: scopedMetrics.botClicks.toLocaleString(),
    },
  ];

  async function copyShareLink() {
    setShareError("");
    try {
      let url = "";
      if (publicToken) {
        url = `${window.location.origin}/er/${encodeURIComponent(publicToken)}`;
      } else {
        const response = await fetch(`/api/events/${report.eventId}/share`, {
          method: "POST",
        });
        const payload = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Could not create share link.");
        }
        url = payload.url;
      }
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch (error) {
      setShareError(
        error instanceof Error ? error.message : "Could not copy share link.",
      );
    }
  }

  async function exportReport() {
    setExporting(true);
    setExportError("");
    try {
      const path = publicToken
        ? `/api/public/event-reports/${encodeURIComponent(publicToken)}/export`
        : `/api/events/${report.eventId}/export`;
      const response = await fetch(path);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Export failed.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${report.eventName}-report.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Export failed.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="drip-report-page event-report-page">
      <div className="drip-report-head">
        {!isPublic ? (
          <Link
            href="/portal/marketing/events"
            className="drip-back"
            aria-label="Back to events"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        ) : null}

        <div className="drip-report-head-copy">
          <h2 title={report.eventName}>{report.eventName}</h2>
          <div className="drip-report-meta">
            Event report
            {` · ${eventFormatLabel(report.eventFormat)}`}
            {report.status === "published" ? " · Published" : " · Draft"}
          </div>
        </div>

        <div className="drip-report-actions">
          {!isPublic ? (
            <Link
              href={`/portal/marketing/events/${report.eventId}`}
              className="btn-soft drip-report-edit-action"
            >
              Open event
            </Link>
          ) : null}
          <button
            type="button"
            className={`drip-report-share${shareCopied ? " copied" : ""}`}
            aria-label={shareCopied ? "Link copied" : "Copy report link"}
            title={shareCopied ? "Link copied" : "Copy report link"}
            onClick={() => void copyShareLink()}
          >
            <ShareIcon />
          </button>
          <button
            type="button"
            className="drip-report-export"
            disabled={exporting}
            onClick={() => void exportReport()}
          >
            {exporting ? "Exporting…" : "Export report"}
          </button>
        </div>
      </div>

      {shareError ? <p className="drip-report-export-error">{shareError}</p> : null}
      {exportError ? <p className="drip-report-export-error">{exportError}</p> : null}

      <div
        className="drip-report-metrics"
        style={{
          gridTemplateColumns: `repeat(${metricCards.length}, minmax(0, 1fr))`,
        }}
      >
        {metricCards.map((metric) => (
          <div key={metric.label} className="drip-report-metric">
            <div className="drip-report-metric-k">{metric.label}</div>
            <div className="drip-report-metric-row">
              <div className="drip-report-metric-v">{metric.value}</div>
            </div>
            <div className="drip-report-metric-rate">
              {metric.rateLabel}
              <strong>{metric.rate}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="drip-report-tabs-row">
        <div className="drip-report-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={peopleFilter === tab.id ? "active" : ""}
              onClick={() => {
                setPeopleFilter(tab.id);
                setPage(1);
              }}
            >
              {tab.label}
              <span className="drip-report-table-count">{tab.count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showBotClicks}
          className={`drip-report-table-toggle drip-report-bot-nav-toggle${showBotClicks ? " is-on" : ""}`}
          onClick={() => {
            setShowBotClicks((value) => !value);
            setPage(1);
          }}
          title={
            showBotClicks
              ? "Bot clicks included in metrics and the people list"
              : "Bot clicks hidden from metrics and the people list"
          }
        >
          <span className="drip-report-table-switch" aria-hidden="true" />
          Show bot clicks
        </button>
      </div>

      <div className="drip-report-people-head">
        <h3 className="drip-report-audience-title">People</h3>
      </div>

      <div className="data-table-wrap">
        <table className="data-table drip-report-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {pagedPeople.length === 0 ? (
              <tr>
                <td colSpan={5} className="drip-empty">
                  No people in this report yet.
                </td>
              </tr>
            ) : (
              pagedPeople.map((person) => (
                <tr key={person.id}>
                  <td data-label="Name">
                    <div className="event-going-status">
                      <span>{person.name}</span>
                      {person.botClick ? (
                        <span className="event-bot-pill">Bot click</span>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Email">{person.email}</td>
                  <td data-label="Company">{person.companyName || "—"}</td>
                  <td data-label="Status">
                    <span className={`drip-report-status ${statusClass(person.status)}`.trim()}>
                      {person.status}
                    </span>
                  </td>
                  <td data-label="Source">{person.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {visiblePeople.length > PAGE_SIZE ? (
        <div className="drip-pagination">
          <span className="drip-page-range">
            {rangeStart}-{rangeEnd} of {visiblePeople.length.toLocaleString()}
          </span>
          <div className="drip-page-controls">
            <select
              value={currentPage}
              onChange={(event) => setPage(Number(event.target.value))}
              aria-label="Page"
            >
              {Array.from({ length: totalPages }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
            <span>of {totalPages} pages</span>
            <button
              type="button"
              className="drip-page-arrow"
              disabled={currentPage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              type="button"
              className="drip-page-arrow"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
