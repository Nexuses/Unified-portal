"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ALL_PROJECTS_STATS_DAYS,
  type AllProjectsStatsDays,
  type AllProjectsStatsRange,
  type ProjectsEngagementReport,
  type WeeklyProjectStats,
} from "@/lib/all-projects-stats";

function formatInt(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatAllProjectsDateLabel(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoInputValue(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (Math.max(1, days) - 1));
  return date.toISOString().slice(0, 10);
}

type Totals = Omit<WeeklyProjectStats, "projectId" | "projectName">;

function MetricCards({ totals }: { totals: Totals }) {
  const cards = [
    { label: "Delivered", value: formatInt(totals.delivered) },
    {
      label: "Opens",
      value: formatInt(totals.opens),
      hint: formatPct(totals.openRate),
    },
    {
      label: "Clicks",
      value: formatInt(totals.clicks),
      hint: formatPct(totals.clickRate),
    },
    {
      label: "Replies",
      value: formatInt(totals.replies),
      hint: formatPct(totals.replyRate),
    },
    { label: "Contacts added", value: formatInt(totals.contactsAdded) },
    { label: "Unsubscribed", value: formatInt(totals.unsubscribed) },
    { label: "Failed", value: formatInt(totals.failed) },
  ];

  return (
    <div className="admin-stats-metrics">
      {cards.map((card) => (
        <div key={card.label} className="admin-stats-metric">
          <p className="admin-stats-metric-label">{card.label}</p>
          <p className="admin-stats-metric-value">{card.value}</p>
          {card.hint ? (
            <p className="admin-stats-metric-hint">{card.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AllProjectsStatsLoader({ label }: { label: string }) {
  return (
    <div className="admin-stats-loader" role="status" aria-live="polite">
      <span className="admin-stats-spinner" aria-hidden />
      <p className="admin-stats-loader-label">{label}</p>
    </div>
  );
}

function CustomRangeModal({
  open,
  initialFrom,
  initialTo,
  onClose,
  onApply,
}: {
  open: boolean;
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setFrom(initialFrom || daysAgoInputValue(7));
    setTo(initialTo || todayInputValue());
    setError("");
  }, [open, initialFrom, initialTo]);

  if (!open) {
    return null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!from || !to) {
      setError("Choose both start and end dates.");
      return;
    }
    if (from > to) {
      setError("Start date must be before the end date.");
      return;
    }
    onApply(from, to);
  }

  return (
    <div className="admin-stats-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-stats-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-stats-custom-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="admin-stats-custom-title" className="admin-stats-modal-title">
          Custom date range
        </h3>
        <p className="admin-stats-modal-copy">
          Pick the calendar dates you want to include.
        </p>
        <form className="admin-stats-modal-form" onSubmit={submit}>
          <label className="admin-field">
            <span className="admin-field-label">From</span>
            <input
              className="admin-input"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            <span className="admin-field-label">To</span>
            <input
              className="admin-input"
              type="date"
              value={to}
              min={from || undefined}
              max={todayInputValue()}
              onChange={(event) => setTo(event.target.value)}
              required
            />
          </label>
          {error ? <p className="admin-error">{error}</p> : null}
          <div className="admin-form-actions">
            <button type="button" className="admin-secondary-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="admin-primary-btn">
              Apply range
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AllProjectsDayFilter({
  range,
  loading,
  onSelectPreset,
  onSelectCustom,
}: {
  range: AllProjectsStatsRange;
  loading: boolean;
  onSelectPreset: (days: AllProjectsStatsDays) => void;
  onSelectCustom: (from: string, to: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const customActive = range.mode === "custom";

  return (
    <>
      <div className="admin-tabs" role="tablist" aria-label="Date range">
        {ALL_PROJECTS_STATS_DAYS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={range.mode === "preset" && range.days === option}
            className={`admin-tab${
              range.mode === "preset" && range.days === option ? " is-active" : ""
            }`}
            disabled={loading}
            onClick={() => onSelectPreset(option)}
          >
            {option} days
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={customActive}
          className={`admin-tab${customActive ? " is-active" : ""}`}
          disabled={loading}
          onClick={() => setModalOpen(true)}
        >
          Custom
        </button>
      </div>
      <CustomRangeModal
        open={modalOpen}
        initialFrom={customActive ? range.from : daysAgoInputValue(7)}
        initialTo={customActive ? range.to : todayInputValue()}
        onClose={() => setModalOpen(false)}
        onApply={(from, to) => {
          setModalOpen(false);
          onSelectCustom(from, to);
        }}
      />
    </>
  );
}

export function AllProjectsStatsTable({
  report,
}: {
  report: ProjectsEngagementReport;
}) {
  return (
    <>
      <MetricCards totals={report.totals} />
      <div className="admin-table-wrap">
        <table className="admin-table admin-stats-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Logo</th>
              <th className="admin-num">Delivered</th>
              <th className="admin-num">Opens</th>
              <th className="admin-num">Open %</th>
              <th className="admin-num">Clicks</th>
              <th className="admin-num">Click %</th>
              <th className="admin-num">Replies</th>
              <th className="admin-num">Reply %</th>
              <th className="admin-num">Contacts</th>
              <th className="admin-num">Unsub</th>
              <th className="admin-num">Failed</th>
            </tr>
          </thead>
          <tbody>
            <tr className="admin-stats-totals-row">
              <td>All projects</td>
              <td className="admin-logo-cell">—</td>
              <td className="admin-num">{formatInt(report.totals.delivered)}</td>
              <td className="admin-num">{formatInt(report.totals.opens)}</td>
              <td className="admin-num">{formatPct(report.totals.openRate)}</td>
              <td className="admin-num">{formatInt(report.totals.clicks)}</td>
              <td className="admin-num">{formatPct(report.totals.clickRate)}</td>
              <td className="admin-num">{formatInt(report.totals.replies)}</td>
              <td className="admin-num">{formatPct(report.totals.replyRate)}</td>
              <td className="admin-num">
                {formatInt(report.totals.contactsAdded)}
              </td>
              <td className="admin-num">
                {formatInt(report.totals.unsubscribed)}
              </td>
              <td className="admin-num">{formatInt(report.totals.failed)}</td>
            </tr>
            {report.projects.length === 0 ? (
              <tr>
                <td colSpan={12} className="admin-empty">
                  No projects yet.
                </td>
              </tr>
            ) : (
              report.projects.map((row) => (
                <tr key={row.projectId}>
                  <td>
                    <span className="admin-stats-project-name">
                      {row.projectName}
                    </span>
                  </td>
                  <td className="admin-logo-cell">
                    {row.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.logoUrl}
                        alt=""
                        className="admin-logo admin-stats-project-logo"
                      />
                    ) : (
                      <span
                        className="admin-stats-project-logo-fallback"
                        aria-hidden
                      >
                        {row.projectName.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td className="admin-num">{formatInt(row.delivered)}</td>
                  <td className="admin-num">{formatInt(row.opens)}</td>
                  <td className="admin-num">{formatPct(row.openRate)}</td>
                  <td className="admin-num">{formatInt(row.clicks)}</td>
                  <td className="admin-num">{formatPct(row.clickRate)}</td>
                  <td className="admin-num">{formatInt(row.replies)}</td>
                  <td className="admin-num">{formatPct(row.replyRate)}</td>
                  <td className="admin-num">{formatInt(row.contactsAdded)}</td>
                  <td className="admin-num">{formatInt(row.unsubscribed)}</td>
                  <td className="admin-num">{formatInt(row.failed)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
