"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CalendarClock,
  ListPlus,
  MailOpen,
  Monitor,
  MousePointerClick,
  Radio,
  Rocket,
  Send,
  Smartphone,
  Tablet,
  UserPlus,
} from "lucide-react";
import type {
  ActivityFeedGroup,
  ActivityFeedItem,
  ActivityFeedResult,
  ActivityFeedType,
} from "@/lib/activity-feed-server";
import { formatListDate, formatRelativeTime } from "@/lib/crm";
import { portalKanbanRoute } from "@/lib/analytics-kanban";
import {
  PORTAL_ROUTES,
  portalCampaignRoute,
  portalCompanyRoute,
  portalContactRoute,
  portalListRoute,
} from "@/lib/portal-nav";

type TypeFilter = "all" | ActivityFeedType;

const GROUP_FILTERS: Array<{ id: ActivityFeedGroup; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "engagement", label: "Opens & clicks" },
  { id: "campaigns", label: "Campaigns" },
  { id: "lists", label: "Lists" },
  { id: "senders", label: "Senders" },
  { id: "pipeline", label: "Pipeline" },
];

const KIND_LABEL: Record<NonNullable<ActivityFeedItem["campaignKind"]>, string> = {
  drip: "Drip",
  oneone: "1-1",
};

function DeviceIcon({ device }: { device?: ActivityFeedItem["device"] }) {
  const props = { size: 13, strokeWidth: 2.25, "aria-hidden": true as const };
  if (device === "mobile") return <Smartphone {...props} />;
  if (device === "tablet") return <Tablet {...props} />;
  if (device === "desktop") return <Monitor {...props} />;
  return null;
}

function ActivityTypeBadge({ type }: { type: ActivityFeedType }) {
  const props = { size: 13, strokeWidth: 2.25, "aria-hidden": true as const };
  switch (type) {
    case "campaign_opened":
      return (
        <span className="af-type-badge af-type-open">
          <MailOpen {...props} />
          Opened
        </span>
      );
    case "campaign_clicked":
      return (
        <span className="af-type-badge af-type-click">
          <MousePointerClick {...props} />
          Clicked
        </span>
      );
    case "campaign_launched":
      return (
        <span className="af-type-badge af-type-launch">
          <Rocket {...props} />
          Rolled out
        </span>
      );
    case "campaign_scheduled":
      return (
        <span className="af-type-badge af-type-schedule">
          <CalendarClock {...props} />
          Scheduled
        </span>
      );
    case "campaign_created":
      return (
        <span className="af-type-badge af-type-create">
          <Send {...props} />
          Campaign created
        </span>
      );
    case "list_created":
      return (
        <span className="af-type-badge af-type-list">
          <ListPlus {...props} />
          List added
        </span>
      );
    case "company_created":
      return (
        <span className="af-type-badge af-type-company">
          <Building2 {...props} />
          Company added
        </span>
      );
    case "sender_added":
      return (
        <span className="af-type-badge af-type-sender">
          <UserPlus {...props} />
          Sender added
        </span>
      );
    case "pipeline_created":
      return (
        <span className="af-type-badge af-type-pipeline">
          <Radio {...props} />
          Pipeline
        </span>
      );
    default:
      return <span className="af-type-badge">Activity</span>;
  }
}

function ActivityCopy({ item }: { item: ActivityFeedItem }) {
  if (item.type === "campaign_opened" || item.type === "campaign_clicked") {
    return (
      <div className="af-item-copy">
        {item.contactId ? (
          <Link href={portalContactRoute(item.contactId)} className="af-person-link">
            {item.fullName || item.email}
          </Link>
        ) : (
          <strong>{item.fullName || item.email}</strong>
        )}
        <span className="af-muted">
          {item.type === "campaign_opened" ? " opened " : " clicked "}
        </span>
        {item.campaignId ? (
          <Link
            href={portalCampaignRoute(item.campaignId, item.campaignKind)}
            className="af-campaign-link"
          >
            {item.campaignName}
          </Link>
        ) : (
          <strong>{item.campaignName}</strong>
        )}
        {item.type === "campaign_clicked" && item.clickedUrl ? (
          <>
            <span className="af-muted"> → </span>
            <a
              href={item.clickedUrl}
              target="_blank"
              rel="noreferrer"
              className="af-url-link"
            >
              {item.clickedUrl.replace(/^https?:\/\//, "").slice(0, 64)}
              {item.clickedUrl.length > 64 ? "…" : ""}
            </a>
          </>
        ) : null}
      </div>
    );
  }

  if (
    item.type === "campaign_launched" ||
    item.type === "campaign_scheduled" ||
    item.type === "campaign_created"
  ) {
    return (
      <div className="af-item-copy">
        {item.campaignId ? (
          <Link
            href={portalCampaignRoute(item.campaignId, item.campaignKind)}
            className="af-campaign-link"
          >
            {item.campaignName}
          </Link>
        ) : (
          <strong>{item.campaignName}</strong>
        )}
        <span className="af-muted"> — {item.description.replace(item.campaignName || "", "").replace(/^ — /, "").trim() || item.title.toLowerCase()}</span>
      </div>
    );
  }

  if (item.type === "list_created" && item.listId) {
    return (
      <div className="af-item-copy">
        <Link href={portalListRoute(item.listId)} className="af-campaign-link">
          {item.listDisplayId ? `(#${item.listDisplayId}) ` : ""}
          {item.listName}
        </Link>
        <span className="af-muted"> was added to CRM</span>
      </div>
    );
  }

  if (item.type === "company_created" && item.companyId) {
    return (
      <div className="af-item-copy">
        <Link href={portalCompanyRoute(item.companyId)} className="af-campaign-link">
          {item.companyName}
        </Link>
        <span className="af-muted"> was added to companies</span>
      </div>
    );
  }

  if (item.type === "sender_added") {
    return (
      <div className="af-item-copy">
        <Link href={PORTAL_ROUTES.smtp} className="af-campaign-link">
          {item.senderEmail}
        </Link>
        <span className="af-muted"> was added as a sender</span>
      </div>
    );
  }

  if (item.type === "pipeline_created" && item.pipelineId) {
    return (
      <div className="af-item-copy">
        <Link href={portalKanbanRoute(item.pipelineId)} className="af-campaign-link">
          {item.pipelineName}
        </Link>
        <span className="af-muted"> pipeline was created</span>
      </div>
    );
  }

  return <div className="af-item-copy">{item.description}</div>;
}

export default function PortalActivityFeedPage() {
  const [group, setGroup] = useState<ActivityFeedGroup>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityFeedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (opts?: {
      page?: number;
      group?: ActivityFeedGroup;
      type?: TypeFilter;
      q?: string;
    }) => {
      const nextPage = opts?.page ?? page;
      const nextGroup = opts?.group ?? group;
      const nextQ = opts?.q ?? searchQuery;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          group: nextGroup,
        });
        if (nextQ.trim()) {
          params.set("q", nextQ.trim());
        }
        const response = await fetch(`/api/activity?${params}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as ActivityFeedResult & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error || "Failed to load activity");
        }
        setData(body);
        setPage(body.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load activity");
      } finally {
        setLoading(false);
      }
    },
    [group, page, searchQuery],
  );

  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  function applySearch() {
    const q = searchInput.trim();
    setSearchQuery(q);
    setPage(1);
    void load({ page: 1, q });
  }

  function changeGroup(next: ActivityFeedGroup) {
    setGroup(next);
    setPage(1);
    void load({ page: 1, group: next });
  }

  const items = data?.items ?? [];
  const rangeStart = items.length === 0 ? 0 : (page - 1) * (data?.pageSize || 40) + 1;
  const rangeEnd = (page - 1) * (data?.pageSize || 40) + items.length;

  return (
    <div className="af-page">
      <div className="crm-page-head">
        <div>
          <h2>Activity Feed</h2>
          <p className="desc">
            Platform activity across this workspace — campaign rollout &amp;
            schedule, list adds, senders, opens, clicks, and more.
          </p>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn-soft"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="af-toolbar">
        <div className="af-filters" role="tablist" aria-label="Activity group">
          {GROUP_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={group === item.id}
              className={`af-filter-pill${group === item.id ? " active" : ""}`}
              onClick={() => changeGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <form
          className="af-search"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <label className="drip-search af-search-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search campaign, list, sender…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-soft af-search-btn">
            Search
          </button>
        </form>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <div className="af-card">
        {loading && !data ? (
          <p className="crm-empty">Loading activity...</p>
        ) : items.length === 0 ? (
          <p className="crm-empty">No activity in this filter yet.</p>
        ) : (
          <ul className="af-list">
            {items.map((item) => (
              <li key={item.id} className="af-item">
                <div className="af-item-main">
                  <div className="af-item-top">
                    <ActivityTypeBadge type={item.type} />
                    {item.campaignKind ? (
                      <span className={`af-kind-chip af-kind-${item.campaignKind}`}>
                        {KIND_LABEL[item.campaignKind]}
                      </span>
                    ) : null}
                    <span className="af-item-when">
                      {formatListDate(item.at)}
                      <span className="af-item-rel">
                        {" "}
                        · {formatRelativeTime(item.at)}
                      </span>
                    </span>
                  </div>

                  <ActivityCopy item={item} />

                  <div className="af-item-meta">
                    {item.email ? (
                      <span className="af-meta-chip">{item.email}</span>
                    ) : null}
                    {item.companyName &&
                    item.type !== "company_created" ? (
                      <span className="af-meta-chip">{item.companyName}</span>
                    ) : null}
                    {item.listName && item.type !== "list_created" ? (
                      <span className="af-meta-chip">List · {item.listName}</span>
                    ) : null}
                    {item.senderEmail && item.type !== "sender_added" ? (
                      <span className="af-meta-chip">
                        From {item.senderName || item.senderEmail}
                      </span>
                    ) : null}
                    {item.device && item.deviceLabel ? (
                      <span className={`cd-device-chip cd-device-${item.device}`}>
                        <DeviceIcon device={item.device} />
                        {item.deviceLabel}
                      </span>
                    ) : null}
                    {item.openTag ? (
                      <span className="af-type-badge af-type-pixel-blocked">
                        {item.openTag}
                      </span>
                    ) : null}
                    {item.ip ? <span className="cd-ip-chip">IP {item.ip}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.total > 0 ? (
        <div className="drip-pagination af-pagination">
          <span className="drip-page-range">
            {rangeStart}-{rangeEnd} of {data.total}
          </span>
          <div className="drip-page-controls">
            <button
              type="button"
              className="drip-page-arrow"
              disabled={loading || page <= 1}
              onClick={() => {
                const next = page - 1;
                setPage(next);
                void load({ page: next });
              }}
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              type="button"
              className="drip-page-arrow"
              disabled={loading || page >= data.totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void load({ page: next });
              }}
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
