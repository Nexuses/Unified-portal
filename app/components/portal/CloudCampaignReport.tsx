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
  repliedAt?: string;
  bouncedAt?: string;
  bounceReason?: string;
};

type FollowupItem = {
  row: number;
  step: number;
  email: string;
  status: "scheduled" | "sending" | "sent" | "skipped" | "failed";
  dueAt?: string;
  sentAt?: string;
  reason?: string;
  source?: "sheet" | "ai";
};

type Report = {
  totals: {
    sent: number;
    replied: number;
    bounced: number;
    skipped: number;
    failed: number;
  };
  recipients: Recipient[];
  inboxCheckedAt?: string;
  followups?: { enabled: boolean; steps: number; items: FollowupItem[]; nextDueAt?: string };
};

function followupChip(item: FollowupItem) {
  const n = `FU${item.step}`;
  switch (item.status) {
    case "sent":
      return { text: `${n} sent ${short(item.sentAt)}`, tone: "is-ok", title: item.source === "ai" ? "Written by AI" : "From the sheet" };
    case "scheduled":
      return { text: `${n} due ${short(item.dueAt)}`, tone: "", title: item.reason || "Scheduled" };
    case "sending":
      return { text: `${n} sending…`, tone: "", title: "Sending now" };
    case "skipped":
      return { text: `Stopped · ${item.reason || "no more follow-ups"}`, tone: "", title: item.reason || "" };
    default:
      return { text: `${n} failed`, tone: "is-bad", title: item.reason || "Failed" };
  }
}

function followupText(items: FollowupItem[]) {
  return items.map((item) => followupChip(item).text).join("; ");
}

type Filter = "all" | "replied" | "no_reply" | "bounced";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "replied", label: "Replied" },
  { key: "no_reply", label: "No reply yet" },
  { key: "bounced", label: "Bounced" },
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
};

/**
 * Report tab: what happened after sending, as the sender's own mailbox shows it (replies,
 * bounces). Cloud emails carry no open pixel or tracked links, so there are no open/click stats.
 */
export default function CloudCampaignReport({
  campaignId,
  campaignName,
  sending,
  onCheckInbox,
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
      if (filter === "replied" && !r.repliedAt) return false;
      if (filter === "no_reply" && (r.repliedAt || r.bouncedAt)) return false;
      if (filter === "bounced" && !r.bouncedAt) return false;
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

  async function sendNow(row: number, step: number) {
    setMessage("");
    try {
      const response = await fetch(`/api/cloud-campaigns/${encodeURIComponent(campaignId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "followup_send_now", row, step }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Couldn't queue the follow-up");
      setMessage(`Follow-up ${step} for row ${row + 1} goes out within a minute (if no reply has come in).`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't queue the follow-up");
    }
  }

  function downloadCsv(header: string[], lines: string[], suffix: string) {
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${campaignName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}-${suffix}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    if (!report) return;
    const header = ["Row", "Email", "Name", "Company", "Subject", "Sent", "Replied", "Bounced", "Bounce reason", "Follow-ups"];
    const byRow = new Map<number, FollowupItem[]>();
    for (const item of report.followups?.items || []) byRow.set(item.row, [...(byRow.get(item.row) || []), item]);
    const lines = report.recipients.map((r) =>
      [r.row + 1, r.email, r.name, r.company, r.subject, r.sentAt, r.repliedAt, r.bouncedAt, r.bounceReason, followupText(byRow.get(r.row) || [])]
        .map(csvCell)
        .join(","),
    );
    downloadCsv(header, lines, "report");
  }

  function exportBounces() {
    if (!report) return;
    const header = ["Row", "Email", "Name", "Company", "Sent", "Bounce found", "Reason"];
    const lines = report.recipients
      .filter((r) => r.bouncedAt)
      .map((r) => [r.row + 1, r.email, r.name, r.company, r.sentAt, r.bouncedAt, r.bounceReason].map(csvCell).join(","));
    downloadCsv(header, lines, "bounces");
  }

  if (error && !report) return <div className="cloud-notice">{error}</div>;
  if (!report) return <p className="cloud-muted">Loading report…</p>;

  const t = report.totals;
  const fu = report.followups;
  const fuItems = fu?.items || [];
  const fuByRow = new Map<number, FollowupItem[]>();
  for (const item of fuItems) {
    const list = fuByRow.get(item.row) || [];
    list.push(item);
    fuByRow.set(item.row, list);
  }
  const fuCount = (status: FollowupItem["status"]) => fuItems.filter((item) => item.status === status).length;
  const showFollowups = Boolean(fu?.enabled || fuItems.length);
  const bounces = report.recipients.filter((r) => r.bouncedAt);
  const stages: EngagementFunnelStage[] = [
    { key: "sent", label: "Sent", value: t.sent, onClick: () => setFilter("all") },
    { key: "delivered", label: "Delivered", value: Math.max(0, t.sent - t.bounced), onClick: () => setFilter("no_reply") },
    { key: "replied", label: "Replied", value: t.replied, onClick: () => setFilter("replied") },
  ];

  const cards: { key: string; label: string; value: number; rate: string; hint?: string; bad?: boolean }[] = [
    { key: "sent", label: "Sent", value: t.sent, rate: "" },
    { key: "replied", label: "Replied", value: t.replied, rate: pct(t.replied, t.sent) },
    { key: "bounced", label: "Bounced", value: t.bounced, rate: pct(t.bounced, t.sent), bad: t.bounced > 0 },
    { key: "skipped", label: "Skipped", value: t.skipped, rate: "", hint: "Rows that couldn't be sent" },
    ...(showFollowups
      ? [
          {
            key: "followups",
            label: "Follow-ups sent",
            value: fuCount("sent"),
            rate: `${fuCount("scheduled") + fuCount("sending")} queued`,
            hint: fu?.nextDueAt ? `Next follow-up ${short(fu.nextDueAt)}` : "Replies in the same thread",
            bad: false,
          },
        ]
      : []),
  ];

  return (
    <section className="cloud-report" aria-label="Campaign report">
      <div className="cloud-report-cards">
        {cards.map((card) => (
          <div key={card.key} className={`cloud-report-card${card.bad ? " is-bad" : ""}`} title={card.hint}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            {card.rate ? <small>{card.rate}</small> : null}
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

      <p className="cloud-report-note">
        Emails go out exactly as written, with no open pixel, tracked links or unsubscribe footer, so
        they read as a person&apos;s email. Replies and bounces come from the sender&apos;s own inbox, and
        replies are copied to the Master Inbox.
      </p>

      {bounces.length ? (
        <div className="cloud-bounce-report">
          <div className="cloud-bounce-head">
            <div>
              <strong>Bounce report</strong>
              <small>
                {bounces.length} of {t.sent} email{t.sent === 1 ? "" : "s"} bounced ({pct(bounces.length, t.sent)}). Remove
                these addresses before reusing the list.
              </small>
            </div>
            <button type="button" className="btn-soft btn-sm" onClick={exportBounces}>
              Export bounces
            </button>
          </div>
          <div className="cloud-report-table-wrap">
            <table className="cloud-report-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Sent</th>
                  <th>Bounce found</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {bounces.map((r) => (
                  <tr key={`bounce-${r.email}-${r.row}`}>
                    <td>
                      <strong>{r.name || r.email}</strong>
                      <small>
                        {r.name ? `${r.email} · ` : ""}row {r.row + 1}
                        {r.company ? ` · ${r.company}` : ""}
                      </small>
                    </td>
                    <td>{short(r.sentAt)}</td>
                    <td>{short(r.bouncedAt)}</td>
                    <td className="cloud-bounce-reason">{r.bounceReason || "Bounce notice found (no reason shown)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
                <th>Replied</th>
                {showFollowups ? <th>Follow-ups</th> : null}
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
                    {r.bouncedAt ? (
                      <em className="cloud-tag is-bad" title={r.bounceReason || undefined}>
                        Bounced
                      </em>
                    ) : null}
                  </td>
                  <td>{short(r.sentAt)}</td>
                  <td>{r.repliedAt ? <span className="cloud-tag is-ok">Replied</span> : "—"}</td>
                  {showFollowups ? (
                    <td className="cloud-report-fu">
                      {(fuByRow.get(r.row) || []).length
                        ? (fuByRow.get(r.row) || []).map((item) => {
                            const chip = followupChip(item);
                            return (
                              <span key={item.step} className={`cloud-tag ${chip.tone}`} title={chip.title}>
                                {chip.text}
                                {item.status === "scheduled" || item.status === "failed" ? (
                                  <button
                                    type="button"
                                    className="cloud-report-fu-now"
                                    title={item.status === "failed" ? "Try this follow-up again now" : "Send this follow-up now"}
                                    onClick={() => void sendNow(item.row, item.step)}
                                  >
                                    {item.status === "failed" ? "Retry" : "Send now"}
                                  </button>
                                ) : null}
                              </span>
                            );
                          })
                        : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
