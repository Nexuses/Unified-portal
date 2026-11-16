"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EngagementFunnelChart, {
  type EngagementFunnelStage,
} from "@/app/components/portal/EngagementFunnelChart";

type Recipient = {
  row: number;
  email: string;
  name: string;
  company: string;
  subject: string;
  sentAt?: string;
  openedAt?: string;
  openCount: number;
  clickedAt?: string;
  clickCount: number;
  repliedAt?: string;
  bouncedAt?: string;
  unsubscribedAt?: string;
};

type Report = {
  totals: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    skipped: number;
    failed: number;
  };
  recipients: Recipient[];
  tracking: { opens: boolean; clicks: boolean; unsubscribe: boolean };
  inboxCheckedAt?: string;
};

type Filter = "all" | "opened" | "clicked" | "replied" | "bounced" | "not_opened";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "opened", label: "Opened" },
  { key: "clicked", label: "Clicked" },
  { key: "replied", label: "Replied" },
  { key: "bounced", label: "Bounced" },
  { key: "not_opened", label: "Not opened" },
];

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function short(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return (
    date.toLocaleDateString([], { day: "numeric", month: "short" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function csvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

type Props = {
  campaignId: string;
  campaignName: string;
  sending: boolean;
  onCheckInbox: () => Promise<string>;
  onTrackingChange: (patch: { trackOpens?: boolean; trackClicks?: boolean; unsubscribeFooter?: boolean }) => Promise<void>;
};

/** Report tab: what happened after sending (opens, clicks, replies, bounces). */
export default function CloudCampaignReport({
  campaignId,
  campaignName,
  sending,
  onCheckInbox,
  onTrackingChange,
}: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/cloud-campaigns/${encodeURIComponent(campaignId)}/report`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as { report?: Report; error?: string } | null;
      if (!response.ok || !data?.report) throw new Error(data?.error || "Could not load the report");
      setReport(data.report);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the report");
    }
  }, [campaignId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => {
    const list = report?.recipients ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === "opened" && !r.openedAt) return false;
      if (filter === "clicked" && !r.clickedAt) return false;
      if (filter === "replied" && !r.repliedAt) return false;
      if (filter === "bounced" && !r.bouncedAt) return false;
      if (filter === "not_opened" && (r.openedAt || r.bouncedAt)) return false;
      if (!needle) return true;
      return `${r.email} ${r.name} ${r.company} ${r.subject}`.toLowerCase().includes(needle);
    });
  }, [report, filter, search]);

  async function checkNow() {
    setChecking(true);
    setMessage("");
    try {
      setMessage(await onCheckInbox());
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not check the inbox");
    } finally {
      setChecking(false);
    }
  }

  async function toggle(patch: { trackOpens?: boolean; trackClicks?: boolean; unsubscribeFooter?: boolean }) {
    await onTrackingChange(patch);
    await load();
  }

  function exportCsv() {
    if (!report) return;
    const header = ["Row", "Email", "Name", "Company", "Subject", "Sent", "Opened", "Opens", "Clicked", "Clicks", "Replied", "Bounced", "Unsubscribed"];
    const lines = report.recipients.map((r) =>
      [r.row + 1, r.email, r.name, r.company, r.subject, r.sentAt, r.openedAt, r.openCount, r.clickedAt, r.clickCount, r.repliedAt, r.bouncedAt, r.unsubscribedAt]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${campaignName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (error && !report) return <div className="cloud-notice">{error}</div>;
  if (!report) return <p className="cloud-muted">Loading report…</p>;

  const t = report.totals;
  const stages: EngagementFunnelStage[] = [
    { key: "sent", label: "Sent", value: t.sent, onClick: () => setFilter("all") },
    ...(report.tracking.opens ? [{ key: "opened", label: "Opened", value: t.opened, onClick: () => setFilter("opened") }] : []),
    ...(report.tracking.clicks ? [{ key: "clicked", label: "Clicked", value: t.clicked, onClick: () => setFilter("clicked") }] : []),
    { key: "replied", label: "Replied", value: t.replied, onClick: () => setFilter("replied") },
  ];

  const cards = [
    { key: "sent", label: "Sent", value: t.sent, rate: "" },
    { key: "opened", label: "Opened", value: report.tracking.opens ? t.opened : null, rate: pct(t.opened, t.sent), off: !report.tracking.opens },
    { key: "clicked", label: "Clicked", value: report.tracking.clicks ? t.clicked : null, rate: pct(t.clicked, t.sent), off: !report.tracking.clicks },
    { key: "replied", label: "Replied", value: t.replied, rate: pct(t.replied, t.sent) },
    { key: "bounced", label: "Bounced", value: t.bounced, rate: pct(t.bounced, t.sent), bad: t.bounced > 0 },
    { key: "skipped", label: "Skipped", value: t.skipped, rate: "", hint: "Rows that couldn't be sent" },
  ];

  return (
    <section className="cloud-report" aria-label="Campaign report">
      <div className="cloud-report-cards">
        {cards.map((card) => (
          <div key={card.key} className={`cloud-report-card${card.bad ? " is-bad" : ""}`} title={card.hint}>
            <span>{card.label}</span>
            <strong>{card.value === null ? "Off" : card.value}</strong>
            {card.value !== null && card.rate ? <small>{card.rate}</small> : null}
          </div>
        ))}
      </div>

      {t.sent > 0 ? (
        <div className="cloud-report-funnel">
          <EngagementFunnelChart stages={stages} height={170} />
        </div>
      ) : null}

      <div className="cloud-report-bar">
        <div className="cloud-report-inbox">
          <strong>Replies &amp; bounces</strong>
          <small>
            {report.inboxCheckedAt
              ? `Checked ${short(report.inboxCheckedAt)} · checked automatically every 6 h for a week after sending`
              : "Checked automatically every 6 h for a week after sending"}
          </small>
        </div>
        <button
          type="button"
          className="btn-soft btn-sm"
          disabled={checking || sending || t.sent === 0}
          title={sending ? "Available when sending stops" : undefined}
          onClick={() => void checkNow()}
        >
          {checking ? "Checking inbox…" : "Check replies now"}
        </button>
      </div>
      {message ? <p className="cloud-muted">{message}</p> : null}

      <div className="cloud-report-tracking">
        <strong>Tracking for new sends</strong>
        <label>
          <input type="checkbox" checked={report.tracking.opens} onChange={(e) => void toggle({ trackOpens: e.target.checked })} />
          Opens <small>(invisible image)</small>
        </label>
        <label>
          <input type="checkbox" checked={report.tracking.clicks} onChange={(e) => void toggle({ trackClicks: e.target.checked })} />
          Clicks <small>(links go through a redirect)</small>
        </label>
        <label>
          <input type="checkbox" checked={report.tracking.unsubscribe} onChange={(e) => void toggle({ unsubscribeFooter: e.target.checked })} />
          Unsubscribe footer
        </label>
      </div>

      <div className="cloud-report-table-head">
        <div className="cloud-report-filters" role="tablist" aria-label="Filter recipients">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={filter === item.key ? "is-active" : ""}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="cloud-run-inline">
          <input
            type="search"
            placeholder="Search people"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="btn-soft btn-sm" disabled={!report.recipients.length} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="cloud-muted">{report.recipients.length ? "No one matches this filter." : "Nothing sent yet."}</p>
      ) : (
        <div className="cloud-report-table-wrap">
          <table className="cloud-report-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Sent</th>
                <th>Opened</th>
                <th>Clicked</th>
                <th>Replied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.email}-${r.row}-${r.sentAt}`}>
                  <td>
                    <strong>{r.name || r.email}</strong>
                    <small>
                      {r.name ? `${r.email} · ` : ""}row {r.row + 1}
                      {r.company ? ` · ${r.company}` : ""}
                    </small>
                    {r.bouncedAt ? <em className="cloud-tag is-bad">Bounced</em> : null}
                    {r.unsubscribedAt ? <em className="cloud-tag">Unsubscribed</em> : null}
                  </td>
                  <td>{short(r.sentAt)}</td>
                  <td>{r.openedAt ? `${short(r.openedAt)}${r.openCount > 1 ? ` · ${r.openCount}×` : ""}` : "—"}</td>
                  <td>{r.clickedAt ? `${short(r.clickedAt)}${r.clickCount > 1 ? ` · ${r.clickCount}×` : ""}` : "—"}</td>
                  <td>{r.repliedAt ? <span className="cloud-tag is-ok">Replied</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
