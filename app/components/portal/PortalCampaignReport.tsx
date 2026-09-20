"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  campaignSequences,
  formatCampaignClock,
  formatMetric,
  formatSequenceProgress,
  mergeBlastReport,
  patchDripCampaign,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { PORTAL_ROUTES, portalContactRoute, portalListRoute, publicAnalyticsPath, publicCampaignReportPath } from "@/lib/portal-nav";

type PeopleView = "delivered" | "opens" | "clicks" | "bounces" | "replies" | "unsubscribes" | "audience";

type SendRecipient = {
  id: string;
  email: string;
  fullName: string;
  companyName: string;
  contactId?: string;
  error?: string;
  sentAt?: string;
  openedAt?: string;
  clickedAt?: string;
  clickedUrl?: string;
  unsubscribedAt?: string;
  repliedAt?: string;
  sequenceIndex?: number;
  sequenceNumber?: number;
};

const PEOPLE_TITLES: Record<PeopleView, string> = {
  delivered: "Delivered",
  opens: "Opens",
  clicks: "Clicks",
  bounces: "Bounces",
  replies: "Replies",
  unsubscribes: "Unsubscribes",
  audience: "Campaign audience",
};

const TAB_TO_PEOPLE: Record<string, PeopleView | null> = {
  overview: null,
  deliverability: "delivered",
  opens: "opens",
  clicks: "clicks",
  bounces: "bounces",
  replies: "replies",
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

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" />
    </svg>
  );
}

function ResumeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function RunningSpinner() {
  return (
    <span className="drip-row-spinner" aria-hidden="true">
      <span className="drip-row-spinner-ring" />
    </span>
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
  analyticsToken,
}: {
  campaign: DripCampaign;
  onCampaignChange?: (campaign: DripCampaign) => void;
  publicToken?: string;
  analyticsToken?: string;
}) {
  const [tab, setTab] = useState("overview");
  const [peopleView, setPeopleView] = useState<PeopleView | null>(null);
  const [people, setPeople] = useState<SendRecipient[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peoplePage, setPeoplePage] = useState(1);
  const peoplePageSize = 50;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareToast, setShareToast] = useState<{
    key: number;
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [pausing, setPausing] = useState(false);
  const [sequencesOpen, setSequencesOpen] = useState(false);
  const [sequencePreviewIndex, setSequencePreviewIndex] = useState(0);
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

        // Don't advance sends while the campaign is intentionally paused
        if (campaign.status !== "paused") {
          await fetch("/api/campaigns/process-due", { method: "POST" });
        }
        const kind = campaign.kind === "oneone" ? "oneone" : "drip";
        const response = await fetch(
          `/api/campaigns/stats?campaignId=${encodeURIComponent(campaign.id)}&kind=${kind}`,
        );
        const data = await response.json();
        if (cancelled || !response.ok) {
          return;
        }
        const report = (
          data.reports as Array<Parameters<typeof mergeBlastReport>[1] & { kind?: string }>
        ).find(
          (item) =>
            item.campaignId === campaign.id &&
            (item.kind || "drip") === (campaign.kind || "drip"),
        );
        if (report && onCampaignChange) {
          const merged = mergeBlastReport(campaign, report);
          onCampaignChange(
            campaign.status === "paused"
              ? { ...merged, status: "paused" }
              : merged,
          );
        }
      } catch {
        // Keep showing the last known stats.
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, campaign.status === "sending" ? 3000 : 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [campaign.id, campaign.status, publicToken]);

  useEffect(() => {
    if (!peopleView) {
      setPeople([]);
      setPeopleError("");
      setPeopleSearch("");
      setPeoplePage(1);
      return;
    }

    setPeoplePage(1);

    let cancelled = false;
    async function loadPeople() {
      setPeopleLoading(true);
      setPeopleError("");
      try {
        const response = await fetch(
          publicToken
            ? `/api/public/reports/${encodeURIComponent(publicToken)}/recipients?filter=${peopleView}`
            : `/api/campaigns/${encodeURIComponent(campaign.id)}/recipients?filter=${peopleView}${
                campaign.kind === "oneone" || campaign.kind === "drip"
                  ? `&kind=${campaign.kind}`
                  : ""
              }`,
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

  useEffect(() => {
    setPeoplePage(1);
  }, [peopleSearch]);

  const peopleTotalPages = Math.max(
    1,
    Math.ceil(visiblePeople.length / peoplePageSize),
  );
  const peopleCurrentPage = Math.min(peoplePage, peopleTotalPages);
  const pagedPeople = visiblePeople.slice(
    (peopleCurrentPage - 1) * peoplePageSize,
    peopleCurrentPage * peoplePageSize,
  );
  const peopleRangeStart =
    visiblePeople.length === 0
      ? 0
      : (peopleCurrentPage - 1) * peoplePageSize + 1;
  const peopleRangeEnd = Math.min(
    peopleCurrentPage * peoplePageSize,
    visiblePeople.length,
  );

  useEffect(() => {
    if (peoplePage > peopleTotalPages) {
      setPeoplePage(peopleTotalPages);
    }
  }, [peoplePage, peopleTotalPages]);

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
          : `/api/campaigns/${encodeURIComponent(campaign.id)}/export${
              campaign.kind === "oneone" || campaign.kind === "drip"
                ? `?kind=${campaign.kind}`
                : ""
            }`,
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
          `/api/campaigns/${encodeURIComponent(campaign.id)}/share${
            campaign.kind === "oneone" || campaign.kind === "drip"
              ? `?kind=${campaign.kind}`
              : ""
          }`,
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
  const progress = formatSequenceProgress(campaign.sequenceProgress);
  const isOneOne = campaign.kind === "oneone";
  const isRunning = campaign.status === "sending";
  const isPaused = campaign.status === "paused";
  const canPause =
    !isPublic &&
    isOneOne &&
    (campaign.status === "sending" || campaign.status === "scheduled");
  const canResume = !isPublic && isOneOne && isPaused;

  async function togglePause() {
    if (pausing || isPublic || !isOneOne) {
      return;
    }
    const resuming = canResume;
    setPausing(true);
    try {
      const next = await patchDripCampaign(
        campaign.id,
        { status: resuming ? "sending" : "paused" },
        "oneone",
      );
      if (resuming) {
        await fetch("/api/campaigns/process-due", { method: "POST" }).catch(
          () => undefined,
        );
      }
      onCampaignChange?.(next);
      setShareToast({
        key: Date.now(),
        variant: "success",
        message: resuming ? "Campaign resumed" : "Campaign paused",
      });
    } catch (error) {
      setShareToast({
        key: Date.now(),
        variant: "error",
        message:
          error instanceof Error ? error.message : "Failed to update campaign",
      });
    } finally {
      setPausing(false);
    }
  }

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
  const sequences = campaign.kind === "oneone" ? campaignSequences(campaign) : [];
  const metrics: Array<{
    label: string;
    value: number;
    rateLabel: string;
    rate: string;
    view?: PeopleView;
    onView?: () => void;
  }> = [
    ...(campaign.kind === "oneone"
      ? [
          {
            label: "Recipients",
            value: campaign.recipients,
            rateLabel: "In this campaign",
            rate: "100%",
            view: "audience" as PeopleView,
          },
        ]
      : []),
    {
      label: "Delivered",
      value: delivered,
      rateLabel: "Delivery rate",
      rate: rate(delivered, campaign.recipients || delivered),
      view: "delivered" as PeopleView,
    },
    {
      label: "Opens",
      value: campaign.opens,
      rateLabel: "Open rate",
      rate: rate(campaign.opens, campaign.recipients),
      view: "opens" as PeopleView,
    },
    {
      label: "Clicks",
      value: campaign.clicks,
      rateLabel: "Click-through rate",
      rate: rate(campaign.clicks, campaign.recipients),
      view: "clicks" as PeopleView,
    },
    {
      label: "Bounces",
      value: campaign.bounces ?? 0,
      rateLabel: "Bounce rate",
      rate: rate(campaign.bounces ?? 0, campaign.recipients),
      view: "bounces" as PeopleView,
    },
    ...(campaign.kind === "oneone"
      ? [
          {
            label: "Replies",
            value: campaign.replies ?? 0,
            rateLabel: "Reply rate",
            rate: rate(campaign.replies ?? 0, campaign.recipients),
            view: "replies" as PeopleView,
          },
        ]
      : []),
    {
      label: "Unsubscribes",
      value: campaign.unsubscribed,
      rateLabel: "Unsubscribe rate",
      rate: rate(campaign.unsubscribed, campaign.recipients),
      view: "unsubscribes" as PeopleView,
    },
    ...(campaign.kind === "oneone"
      ? [
          {
            label: "Sequences",
            value: sequences.length,
            rateLabel: "Emails in sequence",
            rate: sequences.length === 1 ? "1 step" : `${sequences.length} steps`,
            onView: () => {
              setSequencePreviewIndex(0);
              setSequencesOpen(true);
            },
          },
        ]
      : []),
  ];

  const timeline = [...(campaign.timeline ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const showSequence =
    campaign.kind === "oneone" &&
    (peopleView === "opens" || peopleView === "clicks");
  const peopleColSpan =
    peopleView === "clicks"
      ? showSequence
        ? 7
        : 6
      : peopleView === "bounces" || peopleView === "replies"
        ? showSequence
          ? 6
          : 5
        : showSequence
          ? 6
          : 5;
  const activeSequenceIndex = Math.min(
    Math.max(sequencePreviewIndex, 0),
    Math.max(sequences.length - 1, 0),
  );
  const activeSequence = sequences[activeSequenceIndex];
  const activeSequenceHtml = activeSequence
    ? activeSequence.designHtml?.trim() ||
      (activeSequenceIndex === 0 ? campaign.designHtml?.trim() : "") ||
      ""
    : "";
  const activeSequenceDelay =
    !activeSequence || activeSequenceIndex === 0
      ? "Sends immediately when the campaign starts"
      : activeSequence.delayDays === 0
        ? "Sends the same day after the previous sequence"
        : `Waits ${activeSequence.delayDays} day${activeSequence.delayDays === 1 ? "" : "s"} after the previous sequence`;

  return (
    <div className="drip-report-page">
      <div className="drip-report-head">
        {isPublic ? (
          analyticsToken ? (
            <Link
              href={publicAnalyticsPath(analyticsToken)}
              className="drip-back"
              aria-label="Back to analytics report"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
          ) : null
        ) : (
          <Link
            href={campaign.kind === "oneone" ? PORTAL_ROUTES.oneone : PORTAL_ROUTES.drip}
            className="drip-back"
            aria-label="Back to campaigns"
          >
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
            {isRunning
              ? " • Running"
              : isPaused
                ? " • Paused"
                : sentLabel
                  ? ` • Sent on ${sentLabel}`
                  : campaign.status === "scheduled"
                    ? " • Scheduled"
                    : ""}
          </div>
          <div className="drip-report-fields">
            <div>
              <span>Subject</span>
              <strong>{campaign.subject || "—"}</strong>
            </div>
            <div>
              <span>From</span>
              <strong title={from}>{from || "—"}</strong>
            </div>
            <div>
              <span>Reply to</span>
              <strong title={replyTo}>{replyTo || "—"}</strong>
            </div>
          </div>
        </div>
        <div className="drip-report-actions">
          {canPause || canResume ? (
            <button
              type="button"
              className={`drip-report-pause-action${canResume ? " btn-dark" : " btn-soft"}`}
              disabled={pausing}
              onClick={() => void togglePause()}
            >
              {canResume ? <ResumeIcon /> : <PauseIcon />}
              {pausing
                ? canResume
                  ? "Resuming…"
                  : "Pausing…"
                : canResume
                  ? "Resume campaign"
                  : "Pause campaign"}
            </button>
          ) : null}
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

      {isRunning ? (
        <div className="drip-report-running" role="status">
          <RunningSpinner />
          <div>
            <strong>Campaign is running</strong>
            <span>
              {progress
                ? `Seq ${progress.sequence} · ${progress.sent} contacts sent`
                : "Sending emails until this campaign finishes."}
            </span>
          </div>
          {canPause ? (
            <button
              type="button"
              className="btn-soft drip-report-pause-btn"
              disabled={pausing}
              onClick={() => void togglePause()}
            >
              <PauseIcon />
              {pausing ? "Pausing…" : "Pause"}
            </button>
          ) : null}
        </div>
      ) : null}

      {isPaused ? (
        <div className="drip-report-paused" role="status">
          <div>
            <strong>Campaign is paused</strong>
            <span>
              Sending is stopped. Resume whenever you want to continue the
              sequence.
            </span>
          </div>
          {canResume ? (
            <button
              type="button"
              className="btn-dark drip-report-pause-btn"
              disabled={pausing}
              onClick={() => void togglePause()}
            >
              <ResumeIcon />
              {pausing ? "Resuming…" : "Resume"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="drip-report-tabs">
        {(campaign.kind === "oneone"
          ? ["Overview", "Deliverability", "Opens", "Clicks", "Bounces", "Replies", "Unsubscribes"]
          : ["Overview", "Deliverability", "Opens", "Clicks", "Bounces", "Unsubscribes"]
        ).map((label) => (
            <button
              key={label}
              type="button"
              className={tab === label.toLowerCase() ? "active" : ""}
              onClick={() => handleTabChange(label)}
            >
              {label}
            </button>
        ))}
      </div>

      <div className="drip-report-section-head">
        <h3>Campaign performance</h3>
        <span>
          • Automated opens and clicks included.
          <HelpIcon />
        </span>
      </div>

      <div
        className="drip-report-metrics"
        style={
          campaign.kind === "oneone"
            ? { gridTemplateColumns: `repeat(${Math.min(metrics.length, 4)}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {metrics.map((metric) => (
          <div key={metric.label} className="drip-report-metric">
            <div className="drip-report-metric-k">{metric.label}</div>
            <div className="drip-report-metric-row">
              <div className="drip-report-metric-v">{metric.value}</div>
              {metric.view || metric.onView ? (
                <button
                  type="button"
                  className="drip-report-view"
                  onClick={() => {
                    if (metric.onView) {
                      metric.onView();
                      return;
                    }
                    if (metric.view) {
                      openPeople(metric.view);
                    }
                  }}
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

      {sequencesOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => setSequencesOpen(false)}
          role="presentation"
        >
          <div
            className="crm-modal drip-report-sequences-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drip-report-sequences-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="drip-report-sequences-title">
                  Sequence {sequences.length === 0 ? 0 : activeSequenceIndex + 1}
                  {sequences.length > 0 ? ` of ${sequences.length}` : ""}
                </h3>
                <p>{activeSequence?.subject?.trim() || "No subject set"}</p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={() => setSequencesOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              {sequences.length === 0 || !activeSequence ? (
                <div className="drip-report-empty">No sequences on this campaign.</div>
              ) : (
                <>
                  <div className="drip-report-sequence-step-meta">{activeSequenceDelay}</div>
                  <div className="drip-report-sequence-preview drip-report-sequence-preview-lg">
                    {activeSequenceHtml ? (
                      <iframe
                        key={activeSequence.id}
                        title={`Sequence ${activeSequenceIndex + 1} email preview`}
                        sandbox=""
                        srcDoc={activeSequenceHtml}
                      />
                    ) : (
                      <div className="drip-report-sequence-preview-empty">
                        No email design for this sequence.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="crm-modal-foot drip-report-sequence-nav">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSequencesOpen(false)}
              >
                Close
              </button>
              <div className="drip-report-sequence-nav-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={activeSequenceIndex <= 0}
                  onClick={() => setSequencePreviewIndex((index) => Math.max(0, index - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={activeSequenceIndex >= sequences.length - 1}
                  onClick={() =>
                    setSequencePreviewIndex((index) =>
                      Math.min(sequences.length - 1, index + 1),
                    )
                  }
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {peopleView ? (
        <>
          <div className="crm-page-head drip-report-people-head">
            <div>
              <h3 className="drip-report-audience-title">{PEOPLE_TITLES[peopleView]}</h3>
              <p className="desc">
                {peopleView === "opens"
                  ? campaign.kind === "oneone"
                    ? "Contacts who opened this campaign, with sequence, date, and time."
                    : "Contacts who opened this campaign, with date and time."
                  : peopleView === "clicks"
                    ? campaign.kind === "oneone"
                      ? "Links clicked in this campaign, with sequence, date, and time."
                      : "Links clicked in this campaign, with date and time."
                    : peopleView === "bounces"
                      ? "Addresses that bounced (from delivery failures or bounce emails). Replies are not counted here."
                      : peopleView === "replies"
                        ? "Contacts who replied to this campaign (shown in Master Inbox)."
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
                  {showSequence ? <th>Sequence</th> : null}
                  {peopleView === "delivered" ? <th>Delivered</th> : null}
                  {peopleView === "opens" ? <th>Opened</th> : null}
                  {peopleView === "clicks" ? (
                    <>
                      <th>Link clicked</th>
                      <th>Clicked</th>
                    </>
                  ) : null}
                  {peopleView === "unsubscribes" ? <th>Unsubscribed</th> : null}
                  {peopleView === "bounces" ? <th>Bounce reason</th> : null}
                  {peopleView === "replies" ? <th>Replied</th> : null}
                  {peopleView === "audience" ? <th>Company</th> : null}
                </tr>
              </thead>
              <tbody>
                {peopleLoading ? (
                  <tr>
                    <td colSpan={peopleColSpan} className="crm-empty">
                      Loading contacts...
                    </td>
                  </tr>
                ) : visiblePeople.length === 0 ? (
                  <tr>
                    <td colSpan={peopleColSpan} className="crm-empty">
                      No contacts in this view yet.
                    </td>
                  </tr>
                ) : (
                  pagedPeople.map((person) => (
                    <tr key={person.id}>
                      <td className="chk">
                        <input type="checkbox" readOnly />
                      </td>
                      <td data-label="Contact">
                        {person.contactId && !isPublic ? (
                          <Link href={portalContactRoute(person.contactId)} className="name-link">
                            {person.fullName}
                          </Link>
                        ) : (
                          <span className="name-link">{person.fullName}</span>
                        )}
                      </td>
                      <td className="email-cell" data-label="Email">
                        {person.email}
                      </td>
                      {showSequence ? (
                        <td data-label="Sequence">
                          {typeof person.sequenceNumber === "number"
                            ? `Sequence ${person.sequenceNumber}`
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "delivered" ? (
                        <td data-label="Delivered">
                          {person.sentAt
                            ? formatCampaignClock(person.sentAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "opens" ? (
                        <td data-label="Opened">
                          {person.openedAt
                            ? formatCampaignClock(person.openedAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "clicks" ? (
                        <>
                          <td data-label="Link clicked">
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
                          <td data-label="Clicked">
                            {person.clickedAt
                              ? formatCampaignClock(person.clickedAt, timezone)
                              : "—"}
                          </td>
                        </>
                      ) : null}
                      {peopleView === "unsubscribes" ? (
                        <td data-label="Unsubscribed">
                          {person.unsubscribedAt
                            ? formatCampaignClock(person.unsubscribedAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "bounces" ? (
                        <td data-label="Bounce reason">
                          {person.error?.trim() || "Delivery failed"}
                        </td>
                      ) : null}
                      {peopleView === "replies" ? (
                        <td data-label="Replied">
                          {person.repliedAt
                            ? formatCampaignClock(person.repliedAt, timezone)
                            : "—"}
                        </td>
                      ) : null}
                      {peopleView === "audience" ? (
                        <td data-label="Company">{person.companyName || "—"}</td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!peopleLoading && visiblePeople.length > 0 ? (
            <div className="drip-pagination">
              <span className="drip-page-range">
                {peopleRangeStart}-{peopleRangeEnd} of {visiblePeople.length}
              </span>
              <div className="drip-page-controls">
                <select
                  value={peopleCurrentPage}
                  onChange={(event) => setPeoplePage(Number(event.target.value))}
                  aria-label="Page"
                >
                  {Array.from({ length: peopleTotalPages }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
                <span>of {peopleTotalPages} pages</span>
                <button
                  type="button"
                  className="drip-page-arrow"
                  disabled={peopleCurrentPage <= 1}
                  onClick={() =>
                    setPeoplePage((value) => Math.max(1, value - 1))
                  }
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="drip-page-arrow"
                  disabled={peopleCurrentPage >= peopleTotalPages}
                  onClick={() =>
                    setPeoplePage((value) =>
                      Math.min(peopleTotalPages, value + 1),
                    )
                  }
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}
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
  analyticsToken,
}: {
  campaign: DripCampaign;
  publicToken: string;
  analyticsToken?: string;
}) {
  const [current, setCurrent] = useState(campaign);
  return (
    <PortalCampaignReport
      campaign={current}
      publicToken={publicToken}
      analyticsToken={analyticsToken}
      onCampaignChange={setCurrent}
    />
  );
}
