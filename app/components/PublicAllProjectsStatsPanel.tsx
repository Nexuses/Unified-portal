"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AllProjectsDayFilter,
  AllProjectsStatsLoader,
  AllProjectsStatsTable,
  formatAllProjectsDateLabel,
} from "@/app/components/AllProjectsStatsView";
import {
  allProjectsStatsQueryString,
  type AllProjectsStatsDays,
  type AllProjectsStatsRange,
  type ProjectsEngagementReport,
} from "@/lib/all-projects-stats";
import { NEXUSES_LOGO_URL } from "@/lib/nexuses-logo";

type PublicReport = ProjectsEngagementReport & { title?: string };

export default function PublicAllProjectsStatsPanel({
  token,
  title = "All projects performance",
}: {
  token: string;
  title?: string;
}) {
  const [range, setRange] = useState<AllProjectsStatsRange>({
    mode: "preset",
    days: 7,
  });
  const [report, setReport] = useState<PublicReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (next: AllProjectsStatsRange) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/public/all-projects/${encodeURIComponent(token)}?${allProjectsStatsQueryString(next)}`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => null)) as
          | PublicReport
          | { error?: string }
          | null;
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (response.status === 410) {
          setExpired(true);
          setReport(null);
          return;
        }
        if (!response.ok) {
          throw new Error(
            data && "error" in data && typeof data.error === "string"
              ? data.error
              : "Failed to load report",
          );
        }
        setExpired(false);
        setReport(data as PublicReport);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setReport(null);
        setError(err instanceof Error ? err.message : "Failed to load report");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [token],
  );

  useEffect(() => {
    void load(range);
  }, [range, load]);

  if (expired) {
    return (
      <div className="admin-page admin-all-projects admin-all-projects-public">
        <div className="admin-card admin-list-card">
          <div className="admin-stats-body">
            <p className="admin-empty">
              This public link expired after 30 days. Ask for a new URL.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const heading = report?.title || title;
  const rangeLabel = report
    ? `${formatAllProjectsDateLabel(report.from)} – ${formatAllProjectsDateLabel(report.to)} · ${report.timezone}`
    : loading
      ? range.mode === "custom"
        ? `Loading ${range.from} – ${range.to}…`
        : `Loading last ${range.days} days…`
      : "Engagement across every project";

  const loaderLabel =
    range.mode === "custom"
      ? "Loading custom range…"
      : `Loading ${range.days}-day stats…`;

  return (
    <div className="admin-page admin-all-projects admin-all-projects-public">
      <section className="admin-card admin-list-card">
        <div className="admin-list-card-header admin-stats-header">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={NEXUSES_LOGO_URL}
              alt="Nexuses"
              className="admin-stats-nexuses-logo"
            />
            <h2 className="admin-list-card-title">{heading}</h2>
            <p className="admin-stats-range">{rangeLabel}</p>
          </div>
          <AllProjectsDayFilter
            range={range}
            loading={loading}
            onSelectPreset={(days: AllProjectsStatsDays) =>
              setRange({ mode: "preset", days })
            }
            onSelectCustom={(from, to) => setRange({ mode: "custom", from, to })}
          />
        </div>

        <div className="admin-stats-body">
          {error ? <p className="admin-error">{error}</p> : null}

          <div className={`admin-stats-content${loading ? " is-loading" : ""}`}>
            {loading ? <AllProjectsStatsLoader label={loaderLabel} /> : null}

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
