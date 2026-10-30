"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import PipelineFunnelChart from "@/app/components/portal/PipelineFunnelChart";
import PortalCampaignReportTable from "@/app/components/portal/PortalCampaignReportTable";
import {
  campaignSequences,
  formatCampaignClock,
  formatMetric,
  formatSequenceProgress,
  mergeBlastReport,
  patchDripCampaign,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import {
  formatEngagementDevice,
  isEngagementDevice,
  type EngagementDevice,
} from "@/lib/engagement-client-meta";
import { campaignListRoute, portalContactRoute, portalListRoute, publicAnalyticsPath, publicCampaignReportPath } from "@/lib/portal-nav";

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
  openTag?: string;
  clickedAt?: string;
  clickedUrl?: string;
  clickedLinks?: Array<{ url: string; at?: string; sequenceNumber?: number }>;
  clickedIp?: string;
  clickedDevice?: EngagementDevice;
  clickTag?: string;
  botClick?: boolean;
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

function TimelineIcon({ type }: { type?: string }) {
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
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const label = `${parsed.hostname}${path}`;
    return label.length > 72 ? `${label.slice(0, 69)}…` : label;
  } catch {
    return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
  }
}

function otherClicks(person: SendRecipient) {
  return (person.clickedLinks ?? []).slice(1);
}

export default function PortalCampaignReport({
  campaign,
  onCampaignChange,
  onEditPaused,
  onViewSetup,
  publicToken,
  analyticsToken,
  initialHideBotClicks = false,
  allowPublicBotToggle = false,
}: {
  campaign: DripCampaign;
  onCampaignChange?: (campaign: DripCampaign) => void;
  onEditPaused?: () => void;
  onViewSetup?: () => void;
  publicToken?: string;
  analyticsToken?: string;
  /** Preference for public links; locked unless allowPublicBotToggle. */
  initialHideBotClicks?: boolean;
  /** When true (analytics “Export with toggle”), public viewers can flip bots on/off. */
  allowPublicBotToggle?: boolean;
}) {
  const [tab, setTab] = useState("overview");
  const [sequenceScope, setSequenceScope] = useState<number | null>(null);
  const [peopleView, setPeopleView] = useState<PeopleView | null>(null);
  const [people, setPeople] = useState<SendRecipient[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peoplePage, setPeoplePage] = useState(1);
  const [openClickId, setOpenClickId] = useState<string | null>(null);
  /** When true, bot opens/clicks are hidden in lists and omitted from export. */
  const [hideBotClicks, setHideBotClicks] = useState(() =>
    // Public links keep the shared preference; portal starts with Show bot opens/clicks off.
    publicToken ? Boolean(initialHideBotClicks) : true,
  );
  /** Action Open/Click is always on; bot show/hide UI is portal-only. */
  const [instantClickEnabled, setInstantClickEnabled] = useState(false);
  const showBotEngagement = !hideBotClicks;
  const [sharePromptOpen, setSharePromptOpen] = useState(false);
  const [exportPromptOpen, setExportPromptOpen] = useState(false);
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
  const [editing, setEditing] = useState(false);
  const [sequencesOpen, setSequencesOpen] = useState(false);
  const [sequencePreviewIndex, setSequencePreviewIndex] = useState(0);
  const [uniqueClicks, setUniqueClicks] = useState<{
    scope: number | null;
    count: number;
  } | null>(null);
  const [uniqueOpens, setUniqueOpens] = useState<{
    scope: number | null;
    count: number;
  } | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(false);
  const isPublic = Boolean(publicToken);
  const showBotClickUi =
    (!isPublic && instantClickEnabled) ||
    (isPublic && allowPublicBotToggle);
  const [tableView, setTableView] = useState(false);

  useEffect(() => {
    if (isPublic) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await response.json()) as { instantClick?: boolean };
        if (!cancelled && response.ok) {
          setInstantClickEnabled(Boolean(data.instantClick));
        }
      } catch {
        // Keep bot UI hidden if session lookup fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPublic]);

  useEffect(() => {
    const saved = window.localStorage.getItem("campaign-report-table-view") === "1";
    if (saved) queueMicrotask(() => setTableView(true));
  }, []);

  function toggleTableView() {
    setTableView((on) => {
      window.localStorage.setItem("campaign-report-table-view", on ? "0" : "1");
      return !on;
    });
    setPeopleView(null);
  }

  const tableUrl = (() => {
    if (publicToken) {
      const params = new URLSearchParams();
      if (hideBotClicks) {
        params.set("hideBotClicks", "1");
      }
      const query = params.toString();
      return `/api/public/reports/${encodeURIComponent(publicToken)}/table${
        query ? `?${query}` : ""
      }`;
    }
    const params = new URLSearchParams();
    if (campaign.kind === "oneone" || campaign.kind === "drip") {
      params.set("kind", campaign.kind);
    }
    if (hideBotClicks) {
      params.set("hideBotClicks", "1");
    }
    const query = params.toString();
    return `/api/campaigns/${encodeURIComponent(campaign.id)}/report-table${
      query ? `?${query}` : ""
    }`;
  })();

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
        const reports = Array.isArray(data?.reports)
          ? (data.reports as Array<
              Parameters<typeof mergeBlastReport>[1] & { kind?: string }
            >)
          : [];
        const report = reports.find(
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
    const activeView = peopleView;
    if (!activeView) {
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
        const params = new URLSearchParams({ filter: activeView as PeopleView });
        if (campaign.kind === "oneone" || campaign.kind === "drip") {
          params.set("kind", campaign.kind);
        }
        if (campaign.kind === "oneone") {
          params.set("unique", "1");
          if (sequenceScope !== null) {
            params.set("sequence", String(sequenceScope));
          }
        }
        if (
          (activeView === "clicks" || activeView === "opens") &&
          hideBotClicks
        ) {
          params.set("hideBotClicks", "1");
        }
        const response = await fetch(
          publicToken
            ? `/api/public/reports/${encodeURIComponent(publicToken)}/recipients?${params}`
            : `/api/campaigns/${encodeURIComponent(campaign.id)}/recipients?${params}`,
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
  }, [
    campaign.id,
    campaign.kind,
    campaign.clicks,
    peopleView,
    publicToken,
    sequenceScope,
    hideBotClicks,
  ]);

  const engagementCacheRef = useRef<{
    key: string;
    hide: { opens: number; clicks: number } | null;
    show: { opens: number; clicks: number } | null;
  }>({ key: "", hide: null, show: null });

  useEffect(() => {
    let cancelled = false;
    const LOADER_MS = 3000;
    const startedAt = Date.now();
    let minTimer: number | null = null;
    const cacheKey = `${campaign.id}:${campaign.kind}:${sequenceScope ?? "all"}:${campaign.opens}:${campaign.clicks}`;
    if (engagementCacheRef.current.key !== cacheKey) {
      engagementCacheRef.current = { key: cacheKey, hide: null, show: null };
    }

    const mode = hideBotClicks ? "hide" : "show";
    setEngagementLoading(true);

    function clearLoadingWhenReady() {
      if (cancelled) return;
      const wait = Math.max(0, LOADER_MS - (Date.now() - startedAt));
      if (minTimer !== null) {
        window.clearTimeout(minTimer);
      }
      minTimer = window.setTimeout(() => {
        if (!cancelled) {
          setEngagementLoading(false);
        }
      }, wait);
    }

    const cached = engagementCacheRef.current[mode];
    if (cached) {
      setUniqueOpens({ scope: sequenceScope, count: cached.opens });
      setUniqueClicks({ scope: sequenceScope, count: cached.clicks });
      clearLoadingWhenReady();
      return () => {
        cancelled = true;
        if (minTimer !== null) window.clearTimeout(minTimer);
      };
    }

    let pending = 2;
    const nextCounts = { opens: 0, clicks: 0 };

    function finishOne() {
      pending -= 1;
      if (!cancelled && pending <= 0) {
        engagementCacheRef.current[mode] = nextCounts;
        clearLoadingWhenReady();
      }
    }

    async function loadUniqueEngagement(filter: "opens" | "clicks") {
      try {
        const params = new URLSearchParams({
          filter,
          unique: "1",
          count: "1",
        });
        if (campaign.kind === "oneone" || campaign.kind === "drip") {
          params.set("kind", campaign.kind);
        }
        if (campaign.kind === "oneone" && sequenceScope !== null) {
          params.set("sequence", String(sequenceScope));
        }
        if (hideBotClicks) {
          params.set("hideBotClicks", "1");
        }
        const response = await fetch(
          publicToken
            ? `/api/public/reports/${encodeURIComponent(publicToken)}/recipients?${params}`
            : `/api/campaigns/${encodeURIComponent(campaign.id)}/recipients?${params}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as { count?: number };
        if (cancelled || !response.ok || typeof data?.count !== "number") {
          return;
        }
        const next = { scope: sequenceScope, count: data.count };
        if (filter === "opens") {
          nextCounts.opens = data.count;
          setUniqueOpens(next);
        } else {
          nextCounts.clicks = data.count;
          setUniqueClicks(next);
        }
      } catch {
        // Keep the last unique engagement count.
      } finally {
        finishOne();
      }
    }

    void loadUniqueEngagement("opens");
    void loadUniqueEngagement("clicks");

    // Prefetch the other toggle mode so switching feels instant after the loader.
    const otherMode = hideBotClicks ? "show" : "hide";
    if (!engagementCacheRef.current[otherMode]) {
      void (async () => {
        try {
          const load = async (filter: "opens" | "clicks") => {
            const params = new URLSearchParams({
              filter,
              unique: "1",
              count: "1",
            });
            if (campaign.kind === "oneone" || campaign.kind === "drip") {
              params.set("kind", campaign.kind);
            }
            if (campaign.kind === "oneone" && sequenceScope !== null) {
              params.set("sequence", String(sequenceScope));
            }
            if (otherMode === "hide") {
              params.set("hideBotClicks", "1");
            }
            const response = await fetch(
              publicToken
                ? `/api/public/reports/${encodeURIComponent(publicToken)}/recipients?${params}`
                : `/api/campaigns/${encodeURIComponent(campaign.id)}/recipients?${params}`,
              { cache: "no-store" },
            );
            const data = (await response.json()) as { count?: number };
            return response.ok && typeof data?.count === "number" ? data.count : null;
          };
          const [opens, clicks] = await Promise.all([
            load("opens"),
            load("clicks"),
          ]);
          if (
            !cancelled &&
            opens !== null &&
            clicks !== null &&
            engagementCacheRef.current.key === cacheKey
          ) {
            engagementCacheRef.current[otherMode] = { opens, clicks };
          }
        } catch {
          // Prefetch is best-effort.
        }
      })();
    }

    return () => {
      cancelled = true;
      if (minTimer !== null) window.clearTimeout(minTimer);
    };
  }, [
    campaign.id,
    campaign.kind,
    campaign.opens,
    campaign.clicks,
    publicToken,
    sequenceScope,
    hideBotClicks,
  ]);

  const reportPeople = people;

  const visiblePeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    if (!query) {
      return reportPeople;
    }
    return reportPeople.filter(
      (person) =>
        person.fullName.toLowerCase().includes(query) ||
        person.email.toLowerCase().includes(query) ||
        person.companyName.toLowerCase().includes(query) ||
        (person.clickedUrl ?? "").toLowerCase().includes(query) ||
        (person.clickedIp ?? "").toLowerCase().includes(query) ||
        (person.clickedDevice ?? "").toLowerCase().includes(query) ||
        (person.clickedLinks ?? []).some((link) => link.url.toLowerCase().includes(query)),
    );
  }, [reportPeople, peopleSearch]);

  useEffect(() => {
    setPeoplePage(1);
    setOpenClickId(null);
  }, [peopleSearch, peopleView, sequenceScope, campaign.id]);

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

  function selectReportScope(index: number | null) {
    setSequenceScope(index);
    setTab("overview");
    setPeopleView(null);
  }

  async function exportReport(format: "formatted" | "rows") {
    if (exporting) {
      return;
    }
    setExportPromptOpen(false);
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams();
      if (campaign.kind === "oneone" || campaign.kind === "drip") {
        params.set("kind", campaign.kind);
      }
      if (hideBotClicks) {
        params.set("hideBotClicks", "1");
      }
      params.set("format", format);
      const query = params.toString();
      const response = await fetch(
        publicToken
          ? `/api/public/reports/${encodeURIComponent(publicToken)}/export?${query}`
          : `/api/campaigns/${encodeURIComponent(campaign.id)}/export?${query}`,
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
        : asciiName ||
          (format === "rows"
            ? `${campaign.name} Row Export.xlsx`
            : `${campaign.name} Report.xlsx`);
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

  async function shareReport(mode: "show" | "hide" | "toggle") {
    setSharePromptOpen(false);
    // All three share modes include botToggle so the public report shows the switch.
    // Show/Hide set the initial state; Export with toggle starts hidden (like analytics).
    const hideBots = mode === "hide" || mode === "toggle";
    const botToggle = true;
    try {
      let path = publicToken
        ? publicCampaignReportPath(publicToken, {
            hideBotClicks: hideBots,
            botToggle,
          })
        : "";
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
        path = publicCampaignReportPath(String(data.token ?? ""), {
          hideBotClicks: hideBots,
          botToggle,
        });
      }
      if (!path || path.startsWith("/r/?") || path === "/r/") {
        throw new Error("Failed to copy link");
      }
      const url = `${window.location.origin}${path}`;
      await copyText(url);
      setShareCopied(true);
      setShareToast({
        key: Date.now(),
        variant: "success",
        message: hideBots
          ? "Report link copied (bot opens/clicks hidden; viewer can toggle)"
          : "Report link copied (viewer can toggle bot opens/clicks)",
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
  const isPersonalise = isOneOne && Boolean(campaign.tags?.includes("personalise"));
  const isRunning = campaign.status === "sending";
  const isPaused = campaign.status === "paused";
  const canPause =
    !isPublic &&
    isOneOne &&
    (campaign.status === "sending" || campaign.status === "scheduled");
  const canResume = !isPublic && isOneOne && isPaused;
  const canEditScheduled =
    !isPublic && Boolean(onCampaignChange) && campaign.status === "scheduled";
  const canEditPaused = !isPublic && isOneOne && isPaused && Boolean(onEditPaused);

  async function editScheduledCampaign() {
    if (!canEditScheduled || editing) {
      return;
    }
    setEditing(true);
    try {
      const kind = campaign.kind === "oneone" ? "oneone" : "drip";
      const updated = await patchDripCampaign(
        campaign.id,
        { status: "draft" },
        kind,
      );
      onCampaignChange?.(updated);
    } catch (error) {
      setShareToast({
        key: Date.now(),
        variant: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to open campaign for editing",
      });
    } finally {
      setEditing(false);
    }
  }

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
  const sequences = campaign.kind === "oneone" ? campaignSequences(campaign) : [];
  const scopedStats =
    sequenceScope === null
      ? null
      : (campaign.sequenceReports?.find(
          (item) => item.sequenceIndex === sequenceScope,
        ) ?? {
          sequenceIndex: sequenceScope,
          recipients: 0,
          delivered: 0,
          opens: 0,
          clicks: 0,
          bounces: 0,
          replies: 0,
          unsubscribed: 0,
        });
  const statRecipients = scopedStats?.recipients ?? campaign.recipients;
  const delivered =
    scopedStats?.delivered ?? campaign.delivered ?? campaign.recipients;
  const opensFromPeopleView =
    peopleView === "opens" &&
    !peopleLoading &&
    peopleSearch.trim() === ""
      ? reportPeople.length
      : null;
  const statOpens =
    opensFromPeopleView ??
    (uniqueOpens !== null && uniqueOpens.scope === sequenceScope
      ? uniqueOpens.count
      : scopedStats?.opens ?? campaign.opens);
  const clicksFromOpenView =
    peopleView === "clicks" &&
    !peopleLoading &&
    peopleSearch.trim() === ""
      ? reportPeople.length
      : null;
  const statClicks =
    clicksFromOpenView ??
    (uniqueClicks !== null && uniqueClicks.scope === sequenceScope
      ? uniqueClicks.count
      : scopedStats?.clicks ?? campaign.clicks);
  const statBounces = scopedStats?.bounces ?? campaign.bounces ?? 0;
  const statReplies = scopedStats?.replies ?? campaign.replies ?? 0;
  const statUnsubscribed = scopedStats?.unsubscribed ?? campaign.unsubscribed;
  const personaliseTotalEmails = (campaign.sequenceReports ?? []).reduce(
    (sum, item) => sum + (item.recipients ?? 0),
    0,
  );
  const metrics: Array<{
    label: string;
    value: number;
    rateLabel: string;
    rate: string;
    view?: PeopleView;
    onView?: () => void;
    htmlPreview?: boolean;
    loading?: boolean;
  }> = [
    ...(campaign.kind === "oneone"
      ? [
          {
            label: "Recipients",
            value: statRecipients,
            rateLabel: sequenceScope === null ? "In this campaign" : "In this sequence",
            rate: "100%",
            view: "audience" as PeopleView,
          },
        ]
      : []),
    {
      label: "Delivered",
      value: delivered,
      rateLabel: "Delivery rate",
      rate: rate(delivered, statRecipients || delivered),
      view: "delivered" as PeopleView,
    },
    {
      label: "Opens",
      value: statOpens,
      rateLabel: "Open rate",
      rate: rate(statOpens, statRecipients),
      view: "opens" as PeopleView,
      loading: engagementLoading,
    },
    {
      label: "Clicks",
      value: statClicks,
      rateLabel: "Click-through rate",
      rate: rate(statClicks, statRecipients),
      view: "clicks" as PeopleView,
      loading: engagementLoading,
    },
    {
      label: "Bounces",
      value: statBounces,
      rateLabel: "Bounce rate",
      rate: rate(statBounces, statRecipients),
      view: "bounces" as PeopleView,
    },
    ...(campaign.kind === "oneone"
      ? [
          {
            label: "Replies",
            value: statReplies,
            rateLabel: "Reply rate",
            rate: rate(statReplies, statRecipients),
            view: "replies" as PeopleView,
          },
        ]
      : []),
    {
      label: "Unsubscribes",
      value: statUnsubscribed,
      rateLabel: "Unsubscribe rate",
      rate: rate(statUnsubscribed, statRecipients),
      view: "unsubscribes" as PeopleView,
    },
    ...(campaign.kind === "oneone" && sequenceScope === null
      ? [
          {
            label: isPersonalise ? "Total sequences" : "Sequences",
            value: isPersonalise ? personaliseTotalEmails : sequences.length,
            rateLabel: isPersonalise ? "Across all contacts" : "Emails in sequence",
            rate: isPersonalise
              ? ""
              : sequences.length === 1
                ? "1 step"
                : `${sequences.length} steps`,
            onView: () => {
              setSequencePreviewIndex(0);
              setSequencesOpen(true);
            },
          },
        ]
      : []),
    ...(isOneOne && sequenceScope !== null
      ? [
          {
            label: "HTML",
            value: 0,
            rateLabel: "Email sent in this sequence",
            rate: "",
            htmlPreview: true,
            onView: () => {
              setSequencePreviewIndex(sequenceScope);
              setSequencesOpen(true);
            },
          },
        ]
      : []),
  ];

  const timeline = (
    Array.isArray(campaign.timeline) ? [...campaign.timeline] : []
  ).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const showSequence = isOneOne && sequenceScope === null && Boolean(peopleView);
  const showClickTagCol =
    peopleView === "clicks" && showBotClickUi && !hideBotClicks;
  const peopleColSpan =
    3 +
    (showSequence ? 1 : 0) +
    (peopleView === "opens"
      ? 2
      : peopleView === "clicks"
        ? showClickTagCol
          ? 5
          : 4
        : peopleView
          ? 1
          : 0);
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
            href={campaignListRoute(campaign.kind, campaign.tags)}
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
          {!isPublic && onViewSetup && !canEditPaused ? (
            <button
              type="button"
              className="btn-soft drip-report-edit-action"
              onClick={onViewSetup}
            >
              Campaign setup
            </button>
          ) : null}
          {canEditScheduled ? (
            <button
              type="button"
              className="btn-soft drip-report-edit-action"
              disabled={editing || pausing}
              onClick={() => void editScheduledCampaign()}
            >
              {editing ? "Opening…" : "Edit campaign"}
            </button>
          ) : null}
          {canEditPaused ? (
            <button
              type="button"
              className="btn-soft drip-report-edit-action"
              disabled={pausing}
              onClick={onEditPaused}
            >
              Edit campaign
            </button>
          ) : null}
          {canPause && !isRunning ? (
            <button
              type="button"
              className="drip-report-pause-action btn-soft"
              disabled={pausing || editing}
              onClick={() => void togglePause()}
            >
              <PauseIcon />
              {pausing ? "Pausing…" : "Pause campaign"}
            </button>
          ) : null}
          <button
            type="button"
            className={`drip-report-share${shareCopied ? " copied" : ""}`}
            aria-label={shareCopied ? "Link copied" : "Copy report link"}
            title={shareCopied ? "Link copied" : "Copy report link"}
            onClick={() => {
              if (showBotClickUi) {
                setSharePromptOpen(true);
              } else {
                void shareReport("show");
              }
            }}
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
            role="switch"
            aria-checked={tableView}
            className={`drip-report-table-toggle${tableView ? " is-on" : ""}`}
            onClick={toggleTableView}
          >
            <span className="drip-report-table-switch" aria-hidden="true" />
            Table view
          </button>
          <button
            type="button"
            className="drip-report-export"
            onClick={() => {
              setExportError("");
              setExportPromptOpen(true);
            }}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Export report"}
          </button>
        </div>
      </div>
      {exportError ? <p className="drip-report-export-error">{exportError}</p> : null}
      {exportPromptOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => !exporting && setExportPromptOpen(false)}
          role="presentation"
        >
          <div
            className="crm-modal an-share-bot-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drip-export-format-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="drip-export-format-title">Export report</h3>
                <p>
                  Choose a download format. Row export is one row per contact with
                  full timestamps. Formatted export is the styled multi-sheet report.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={() => setExportPromptOpen(false)}
                disabled={exporting}
              >
                ×
              </button>
            </div>
            <div className="an-share-bot-actions">
              <button
                type="button"
                className="btn-soft an-share-action-btn"
                onClick={() => void exportReport("rows")}
                disabled={exporting}
              >
                Row export
              </button>
              <button
                type="button"
                className="btn-dark an-share-action-btn"
                onClick={() => void exportReport("formatted")}
                disabled={exporting}
              >
                Formatted export
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {shareToast ? (
        <ReportToast
          key={shareToast.key}
          variant={shareToast.variant}
          message={shareToast.message}
          onDone={() => setShareToast(null)}
        />
      ) : null}
      {sharePromptOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => setSharePromptOpen(false)}
          role="presentation"
        >
          <div
            className="crm-modal an-share-bot-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drip-share-bot-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="drip-share-bot-title">Copy public report link</h3>
                <p>
                  Choose how bot opens/clicks appear for people who open this
                  link. Export with toggle lets viewers turn them on or off.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={() => setSharePromptOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="an-share-bot-actions">
              <button
                type="button"
                className="btn-soft an-share-action-btn"
                onClick={() => void shareReport("show")}
              >
                Show bots
              </button>
              <button
                type="button"
                className="btn-soft an-share-action-btn"
                onClick={() => void shareReport("hide")}
              >
                Hide bots
              </button>
              <button
                type="button"
                className="btn-dark an-share-action-btn"
                onClick={() => void shareReport("toggle")}
              >
                Export with toggle
              </button>
            </div>
          </div>
        </div>
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

      {tableView ? (
        <PortalCampaignReportTable key={tableUrl} url={tableUrl} />
      ) : null}

      {tableView ? null : isPersonalise ? (
        <div className="drip-report-tabs-row">
          <div className="drip-report-tabs">
            {["Overview", "Deliverability", "Opens", "Clicks", "Bounces", "Replies", "Unsubscribes"].map(
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
          {showBotClickUi ? (
            <button
              type="button"
              role="switch"
              aria-checked={showBotEngagement}
              className={`drip-report-table-toggle drip-report-bot-nav-toggle${showBotEngagement ? " is-on" : ""}`}
              onClick={() => setHideBotClicks((value) => !value)}
              title={
                showBotEngagement
                  ? "Bot opens/clicks shown with tags; included in export"
                  : "Bot opens/clicks hidden in Opens, Clicks, and export"
              }
            >
              <span className="drip-report-table-switch" aria-hidden="true" />
              Show bot opens/clicks
            </button>
          ) : null}
        </div>
      ) : isOneOne ? (
        <div className="drip-report-tab-rows">
          <div className="drip-report-sequence-tabs">
            <button
              type="button"
              className={sequenceScope === null ? "active" : ""}
              onClick={() => selectReportScope(null)}
            >
              Overview
            </button>
            <div
              className={`drip-report-sequence-scroll${sequences.length > 8 ? " is-scroll" : ""}`}
            >
              {sequences.map((sequence, index) => (
                <button
                  key={sequence.id}
                  type="button"
                  className={sequenceScope === index ? "active" : ""}
                  onClick={() => selectReportScope(index)}
                >
                  <span className="drip-report-seq-dot" aria-hidden="true" />
                  <span className="drip-report-seq-name">Sequence {index + 1}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="drip-report-tabs-row">
            <div className="drip-report-tabs">
              {["Deliverability", "Opens", "Clicks", "Bounces", "Replies", "Unsubscribes"].map(
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
            {showBotClickUi ? (
              <button
                type="button"
                role="switch"
                aria-checked={showBotEngagement}
                className={`drip-report-table-toggle drip-report-bot-nav-toggle${showBotEngagement ? " is-on" : ""}`}
                onClick={() => setHideBotClicks((value) => !value)}
                title={
                  showBotEngagement
                    ? "Bot opens/clicks shown with tags; included in export"
                    : "Bot opens/clicks hidden in Opens, Clicks, and export"
                }
              >
                <span className="drip-report-table-switch" aria-hidden="true" />
                Show bot opens/clicks
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="drip-report-tabs-row">
          <div className="drip-report-tabs">
            {["Overview", "Deliverability", "Opens", "Clicks", "Bounces", "Unsubscribes"].map(
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
          {showBotClickUi ? (
            <button
              type="button"
              role="switch"
              aria-checked={showBotEngagement}
              className={`drip-report-table-toggle drip-report-bot-nav-toggle${showBotEngagement ? " is-on" : ""}`}
              onClick={() => setHideBotClicks((value) => !value)}
              title={
                showBotEngagement
                  ? "Bot opens/clicks shown with tags; included in export"
                  : "Bot opens/clicks hidden in Opens, Clicks, and export"
              }
            >
              <span className="drip-report-table-switch" aria-hidden="true" />
              Show bot opens/clicks
            </button>
          ) : null}
        </div>
      )}

      {tableView ? null : (
      <>
      <div className="drip-report-section-head">
        <h3>
          {isOneOne && sequenceScope !== null
            ? `Sequence ${sequenceScope + 1} performance`
            : "Campaign performance"}
        </h3>
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
              <div className="drip-report-metric-v">
                {metric.htmlPreview ? (
                  "HTML"
                ) : metric.loading ? (
                  <span className="drip-report-metric-dots" aria-label="Loading">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  metric.value
                )}
              </div>
              {metric.view || metric.onView ? (
                <button
                  type="button"
                  className="drip-report-view"
                  disabled={metric.loading}
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
                  {metric.htmlPreview ? null : <PeopleIcon />}
                  {metric.htmlPreview ? "View HTML" : "View"}
                </button>
              ) : null}
            </div>
            <div className="drip-report-metric-rate">
              {metric.rateLabel}
              {metric.loading ? (
                <strong className="drip-report-metric-rate-loading">
                  <span className="drip-report-metric-dots is-sm" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </strong>
              ) : metric.rate ? (
                <strong>{metric.rate}</strong>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {tab === "overview" && !peopleView ? (
        <div className="drip-report-funnel-wrap">
          <div className="drip-report-section-head">
            <h3>Engagement funnel</h3>
          </div>
          <PipelineFunnelChart
            stages={[
              {
                key: "delivered",
                label: "Delivered",
                hint: "Emails delivered",
                value: delivered,
                onClick: () => openPeople("delivered"),
              },
              {
                key: "open",
                label: "Opens",
                hint: "Unique opens",
                value: statOpens,
                onClick: () => openPeople("opens"),
              },
              {
                key: "clicks",
                label: "Clicks",
                hint: "Unique clickers",
                value: statClicks,
                onClick: () => openPeople("clicks"),
              },
              ...(statReplies > 0
                ? [
                    {
                      key: "reply",
                      label: "Replies",
                      hint: "Contacts who replied",
                      value: statReplies,
                      onClick: () => openPeople("replies"),
                    },
                  ]
                : []),
            ]}
            conversionLabel={(stage) => {
              const base = statRecipients || delivered;
              if (stage.key === "open") {
                return rate(statOpens, base);
              }
              if (stage.key === "clicks") {
                return rate(statClicks, base);
              }
              if (stage.key === "reply") {
                return rate(statReplies, base);
              }
              return rate(stage.value, base);
            }}
          />
        </div>
      ) : null}
      </>
      )}

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
                <p>
                  {activeSequence?.subject?.trim()
                    ? activeSequence.subject
                    : activeSequenceIndex > 0
                      ? "Same thread (no new subject)"
                      : "No subject set"}
                </p>
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

      {peopleView && !tableView ? (
        <>
          <div className="crm-page-head drip-report-people-head">
            <div>
              <h3 className="drip-report-audience-title">{PEOPLE_TITLES[peopleView]}</h3>
              <p className="desc">
                {peopleView === "opens"
                  ? campaign.kind === "oneone"
                    ? sequenceScope === null
                      ? showBotClickUi
                        ? showBotEngagement
                          ? "All opens (including image-pixel-blocked). Bot opens are tagged. Each contact is counted once across sequences."
                          : "All opens (including image-pixel-blocked). Bot opens are hidden. Each contact is counted once across sequences."
                        : "All opens (including image-pixel-blocked). Each contact is counted once across sequences."
                      : `All opens for sequence ${sequenceScope + 1}. Pixel-blocked opens show a tag.`
                    : showBotClickUi
                      ? showBotEngagement
                        ? "All opens for this campaign. Bot opens and pixel-blocked opens show tags."
                        : "All opens for this campaign. Bot opens are hidden; pixel-blocked opens still show a tag."
                      : "All opens for this campaign. Pixel-blocked opens (click without image load) show a tag."
                  : peopleView === "clicks"
                    ? campaign.kind === "oneone"
                      ? sequenceScope === null
                        ? showBotClickUi
                          ? showBotEngagement
                            ? "Each contact is one row, showing the link they clicked last. Bot clicks are tagged."
                            : "Each contact is one row, showing the link they clicked last. Bot clicks are hidden."
                          : "Each contact is one row, showing the link they clicked last."
                        : `Each contact is one row in sequence ${sequenceScope + 1}, showing the link they clicked last.`
                      : showBotClickUi
                        ? showBotEngagement
                          ? "Each contact is one row, showing the link they clicked last. Bot clicks are tagged."
                          : "Each contact is one row, showing the link they clicked last. Bot clicks are hidden."
                        : "Each contact is one row, showing the link they clicked last."
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
                : `${visiblePeople.length} contacts`}
            </div>
            <div className="crm-meta-right drip-report-people-tools">
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
                  {peopleView === "opens" ? (
                    <>
                      <th>Opened</th>
                      <th>Tag</th>
                    </>
                  ) : null}
                  {peopleView === "clicks" ? (
                    <>
                      <th>Link clicked</th>
                      <th>Clicked</th>
                      <th>Device</th>
                      <th>IP</th>
                      {showClickTagCol ? (
                        <th className="drip-report-tag-col">Tag</th>
                      ) : null}
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
                  pagedPeople.map((person) => {
                    const more = peopleView === "clicks" ? otherClicks(person) : [];
                    const open = openClickId === person.id && more.length > 0;
                    return (
                    <tr
                      key={person.id}
                      className={more.length > 0 ? "drip-click-row" : undefined}
                      aria-expanded={more.length > 0 ? open : undefined}
                      onClick={(event) => {
                        if (more.length === 0) {
                          return;
                        }
                        const target = event.target;
                        if (
                          target instanceof HTMLElement &&
                          target.closest("a, button, input")
                        ) {
                          return;
                        }
                        setOpenClickId(open ? null : person.id);
                      }}
                    >
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
                        <>
                          <td data-label="Opened">
                            {person.openedAt
                              ? formatCampaignClock(person.openedAt, timezone)
                              : "—"}
                          </td>
                          <td data-label="Tag">
                            {person.openTag ? (
                              <span className="af-type-badge af-type-pixel-blocked">
                                {person.openTag}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      ) : null}
                      {peopleView === "clicks" ? (
                        <>
                          <td data-label="Link clicked">
                            <div className="drip-click-cell">
                              <div className="drip-click-latest">
                                {person.clickedUrl ? (
                                  <a
                                    href={person.clickedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="name-link"
                                    title={person.clickedUrl}
                                  >
                                    {linkLabel(person.clickedUrl)}
                                  </a>
                                ) : (
                                  "—"
                                )}
                                {more.length > 0 ? (
                                  <span className={open ? "drip-click-chevron open" : "drip-click-chevron"} aria-hidden="true">
                                    ▾
                                  </span>
                                ) : null}
                              </div>
                              {open ? (
                                <ul className="drip-click-more">
                                  {more.map((link) => (
                                    <li key={`${link.sequenceNumber ?? 0}-${link.url}-${link.at ?? ""}`}>
                                      <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="name-link"
                                        title={link.url}
                                      >
                                        {linkLabel(link.url)}
                                      </a>
                                      <span>
                                        {showSequence && typeof link.sequenceNumber === "number"
                                          ? `Sequence ${link.sequenceNumber}`
                                          : ""}
                                        {showSequence &&
                                        typeof link.sequenceNumber === "number" &&
                                        link.at
                                          ? " · "
                                          : ""}
                                        {link.at ? formatCampaignClock(link.at, timezone) : ""}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </td>
                          <td data-label="Clicked">
                            {person.clickedAt
                              ? formatCampaignClock(person.clickedAt, timezone)
                              : "—"}
                          </td>
                          <td data-label="Device">
                            {person.clickedDevice &&
                            isEngagementDevice(person.clickedDevice) &&
                            person.clickedDevice !== "unknown" ? (
                              <span
                                className={`cd-device-chip cd-device-${person.clickedDevice}`}
                              >
                                {formatEngagementDevice(person.clickedDevice)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td data-label="IP">
                            {person.clickedIp?.trim() ? (
                              <span className="cd-ip-chip">{person.clickedIp}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          {showClickTagCol ? (
                            <td className="drip-report-tag-col" data-label="Tag">
                              {person.clickTag ? (
                                <span className="af-type-badge af-type-bot-click">
                                  {person.clickTag}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          ) : null}
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
                    );
                  })
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
  hideBotClicks = false,
  allowBotToggle = false,
}: {
  campaign: DripCampaign;
  publicToken: string;
  analyticsToken?: string;
  hideBotClicks?: boolean;
  allowBotToggle?: boolean;
}) {
  const [current, setCurrent] = useState(campaign);
  return (
    <PortalCampaignReport
      campaign={current}
      publicToken={publicToken}
      analyticsToken={analyticsToken}
      initialHideBotClicks={hideBotClicks}
      allowPublicBotToggle={allowBotToggle}
      onCampaignChange={setCurrent}
    />
  );
}
