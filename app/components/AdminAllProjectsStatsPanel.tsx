"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AllProjectsDayFilter,
  AllProjectsStatsLoader,
  AllProjectsStatsTable,
  formatAllProjectsDateLabel,
} from "@/app/components/AllProjectsStatsView";
import { ANALYTICS_SHARE_TTL_DAYS } from "@/lib/analytics";
import {
  allProjectsStatsQueryString,
  type AllProjectsStatsDays,
  type AllProjectsStatsRange,
  type ProjectsEngagementReport,
} from "@/lib/all-projects-stats";

export default function AdminAllProjectsStatsPanel() {
  const [range, setRange] = useState<AllProjectsStatsRange>({
    mode: "preset",
    days: 7,
  });
  const [report, setReport] = useState<ProjectsEngagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async (next: AllProjectsStatsRange) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/projects/stats?${allProjectsStatsQueryString(next)}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | ProjectsEngagementReport
        | { error?: string }
        | null;
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(
          data && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load project stats",
        );
      }
      setReport(data as ProjectsEngagementReport);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setReport(null);
      setError(err instanceof Error ? err.message : "Failed to load project stats");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  async function createPublicUrl() {
    if (sharing) {
      return;
    }
    setSharing(true);
    setError("");
    try {
      const response = await fetch("/api/admin/projects/stats/share", {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        expiresAt?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.url) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to create public URL",
        );
      }
      setShareUrl(data.url);
      setShareExpiresAt(data.expiresAt ?? "");
      await navigator.clipboard.writeText(data.url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create public URL");
    } finally {
      setSharing(false);
    }
  }

  function selectPreset(days: AllProjectsStatsDays) {
    setRange({ mode: "preset", days });
  }

  function selectCustom(from: string, to: string) {
    setRange({ mode: "custom", from, to });
  }

  const rangeLabel = report
    ? `${formatAllProjectsDateLabel(report.from)} – ${formatAllProjectsDateLabel(report.to)} · ${report.timezone}`
    : loading
      ? range.mode === "custom"
        ? `Loading ${range.from} – ${range.to}…`
        : `Loading last ${range.days} days…`
      : "Engagement across every project (bots hidden)";

  const shareExpiryLabel = shareExpiresAt
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(shareExpiresAt))
    : "";

  const loaderLabel =
    range.mode === "custom"
      ? "Loading custom range…"
      : `Loading ${range.days}-day stats…`;

  return (
    <div className="admin-page admin-all-projects">
      <section className="admin-card admin-list-card">
        <div className="admin-list-card-header admin-stats-header">
          <div>
            <h2 className="admin-list-card-title">All projects</h2>
            <p className="admin-stats-range">{rangeLabel}</p>
          </div>
          <div className="admin-stats-header-actions">
            <AllProjectsDayFilter
              range={range}
              loading={loading}
              onSelectPreset={selectPreset}
              onSelectCustom={selectCustom}
            />
            <button
              type="button"
              className="admin-primary-btn admin-stats-share-btn"
              onClick={() => void createPublicUrl()}
              disabled={sharing || loading}
            >
              {shareCopied
                ? "Public URL copied"
                : sharing
                  ? "Creating…"
                  : "Create public URL"}
            </button>
          </div>
        </div>

        {shareUrl ? (
          <div className="admin-stats-share-banner">
            <p className="admin-stats-share-url">{shareUrl}</p>
            <p className="admin-stats-share-note">
              Client link · expires{" "}
              {shareExpiryLabel || `in ${ANALYTICS_SHARE_TTL_DAYS} days`}.
              Includes 7 / 15 / 30 day and custom filters.
            </p>
            <button
              type="button"
              className="admin-secondary-btn"
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
                setShareCopied(true);
                window.setTimeout(() => setShareCopied(false), 2400);
              }}
            >
              {shareCopied ? "Copied" : "Copy link"}
            </button>
          </div>
        ) : null}

        <div className="admin-stats-body">
          {error ? <p className="admin-error">{error}</p> : null}

          <div className={`admin-stats-content${loading ? " is-loading" : ""}`}>
            {loading ? <AllProjectsStatsLoader label={loaderLabel} /> : null}

            {!loading && !report && !error ? (
              <p className="admin-empty">No stats available.</p>
            ) : null}

            {report ? (
              <div
                className="admin-stats-data"
                aria-hidden={loading}
                inert={loading || undefined}
              >
                <AllProjectsStatsTable report={report} />
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
