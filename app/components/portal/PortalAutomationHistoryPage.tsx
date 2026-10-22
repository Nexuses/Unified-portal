"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUTOMATION_UNDER_DEVELOPMENT,
  automationCanReopenForEdit,
  deleteAutomation,
  fetchAutomations,
  portalAutomationRoute,
  reopenAutomationForEdit,
  type AutomationStatus,
  type PortalAutomation,
} from "@/lib/automations";
import {
  fetchDripCampaigns,
  formatMetric,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import AutomationUnderDevelopment from "@/app/components/portal/AutomationUnderDevelopment";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

const STATUS_FILTERS: Array<AutomationStatus | "all"> = [
  "all",
  "draft",
  "scheduled",
  "running",
  "completed",
];

type AutomationRowStats = {
  emails: number;
  recipients: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
};

function statusLabel(status: PortalAutomation["status"]) {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    default:
      return "Draft";
  }
}

function statusDetail(item: PortalAutomation) {
  const emailCount = item.steps?.length ?? 0;
  switch (item.status) {
    case "scheduled":
      return "Waiting to launch";
    case "running":
      return "Flow is live";
    case "completed":
      return "All emails finished";
    default:
      return emailCount > 0
        ? `${emailCount} email${emailCount === 1 ? "" : "s"} in draft`
        : "Not set up yet";
  }
}

function MetricColumn({
  label,
  value,
  pct,
  stacked = false,
}: {
  label: string;
  value: number | string;
  pct?: string;
  stacked?: boolean;
}) {
  return (
    <div className={`drip-metric${stacked ? " drip-metric-stacked" : ""}`}>
      <div className="k">{label}</div>
      {stacked ? (
        <>
          <div className="v">{value}</div>
          {pct ? <div className="p">{pct}</div> : null}
        </>
      ) : (
        <div className="drip-metric-main">
          <span className="v">{value}</span>
          {pct ? <span className="p">{pct}</span> : null}
        </div>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function RowStatusSpinner() {
  return (
    <span className="drip-row-spinner" aria-hidden="true">
      <span className="drip-row-spinner-ring" />
    </span>
  );
}

function aggregateStats(
  item: PortalAutomation,
  campaignById: Map<string, DripCampaign>,
): AutomationRowStats {
  let recipients = 0;
  let opens = 0;
  let clicks = 0;
  let unsubscribed = 0;
  let emails = 0;
  let firstRecipientsSet = false;

  for (const step of item.steps ?? []) {
    if (!step.campaignId) {
      continue;
    }
    emails += 1;
    const campaign = campaignById.get(step.campaignId);
    if (!campaign) {
      continue;
    }
    // Recipients: Email 1 audience (avoid double-counting follow-ups).
    if (!firstRecipientsSet) {
      recipients = Number(campaign.recipients) || 0;
      firstRecipientsSet = true;
    }
    opens += Number(campaign.opens) || 0;
    clicks += Number(campaign.clicks) || 0;
    unsubscribed += Number(campaign.unsubscribed) || 0;
  }

  return {
    emails: emails || (item.steps?.length ?? 0),
    recipients,
    opens,
    clicks,
    unsubscribed,
  };
}

export default function PortalAutomationHistoryPage({
  onBack,
  onCreateNew,
}: {
  onBack?: () => void;
  onCreateNew?: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PortalAutomation[]>([]);
  const [campaignById, setCampaignById] = useState<Map<string, DripCampaign>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationStatus | "all">(
    "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const pageSize = 10;

  async function loadAll(cancelled: () => boolean) {
    const [list, drip, oneone] = await Promise.all([
      fetchAutomations({ nonEmptyOnly: true }),
      fetchDripCampaigns("drip").catch(() => [] as DripCampaign[]),
      fetchDripCampaigns("oneone").catch(() => [] as DripCampaign[]),
    ]);
    if (cancelled()) {
      return;
    }
    const nextItems = list.filter((item) => (item.steps?.length ?? 0) > 0);
    const map = new Map<string, DripCampaign>();
    for (const campaign of [...drip, ...oneone]) {
      map.set(campaign.id, campaign);
    }
    setItems(nextItems);
    setCampaignById(map);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        await loadAll(() => cancelled);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh report stats periodically (same cadence as Drip / 1-1).
  useEffect(() => {
    if (loading) {
      return;
    }
    let cancelled = false;
    async function syncStats() {
      try {
        const hasActive = itemsRef.current.some(
          (item) => item.status === "running" || item.status === "scheduled",
        );
        if (hasActive) {
          await fetch("/api/campaigns/process-due", { method: "POST" }).catch(
            () => undefined,
          );
        }
        await loadAll(() => cancelled);
      } catch {
        /* keep current rows */
      }
    }
    void syncStats();
    const timer = window.setInterval(() => {
      void syncStats();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loading]);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.name.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const rangeStart =
    filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, filtered.length);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageIds = useMemo(() => pageItems.map((item) => item.id), [pageItems]);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id));
  const allVisibleSelected =
    pageIds.length > 0 && selectedOnPage.length === pageIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedOnPage.length > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, selectedOnPage.length]);

  useEffect(() => {
    setSelectedIds((current) => {
      const allowed = new Set(items.map((item) => item.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (allowed.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [items]);

  function startNew() {
    if (onCreateNew) {
      onCreateNew();
      return;
    }
    router.push(`${PORTAL_ROUTES.automation}?new=${Date.now()}`);
  }

  async function handleEditAutomation(item: PortalAutomation) {
    if (item.status === "completed") {
      router.push(portalAutomationRoute(item.id));
      return;
    }
    if (item.status === "draft") {
      router.push(portalAutomationRoute(item.id));
      return;
    }
    if (!automationCanReopenForEdit(item.status)) {
      router.push(portalAutomationRoute(item.id));
      return;
    }
    setOpenMenuId(null);
    setEditingId(item.id);
    setError("");
    try {
      await reopenAutomationForEdit(item);
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, status: "draft" } : row,
        ),
      );
      router.push(`${portalAutomationRoute(item.id)}?reschedule=1`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to open automation for editing",
      );
    } finally {
      setEditingId(null);
    }
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        for (const id of pageIds) {
          next.add(id);
        }
      } else {
        for (const id of pageIds) {
          next.delete(id);
        }
      }
      return next;
    });
  }

  async function deleteSelected(ids: string[]) {
    if (ids.length === 0 || deleting) {
      return;
    }

    const confirmText =
      ids.length === 1
        ? `Delete automation "${items.find((item) => item.id === ids[0])?.name || "Untitled automation"}"?`
        : `Delete ${ids.length} automations?`;
    if (!window.confirm(confirmText)) {
      return;
    }

    setDeleting(true);
    setDeletingId(ids.length === 1 ? ids[0] : "bulk");
    setOpenMenuId(null);
    setError("");
    try {
      const results = await Promise.allSettled(
        ids.map((id) => deleteAutomation(id)),
      );
      const removed = new Set<string>();
      const failures: string[] = [];
      results.forEach((result, index) => {
        const id = ids[index];
        if (result.status === "fulfilled") {
          removed.add(id);
        } else {
          failures.push(
            result.reason instanceof Error
              ? result.reason.message
              : "Failed to delete",
          );
        }
      });

      if (removed.size > 0) {
        setItems((current) => current.filter((item) => !removed.has(item.id)));
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const id of removed) {
            next.delete(id);
          }
          return next;
        });
      }

      if (failures.length > 0) {
        setError(
          removed.size > 0
            ? `Deleted ${removed.size}, but ${failures.length} failed.`
            : failures[0] || "Failed to delete",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  }

  if (AUTOMATION_UNDER_DEVELOPMENT) {
    return <AutomationUnderDevelopment />;
  }

  return (
    <div className="crm-page auto-history-page">
      <div className="crm-page-head drip-page-head">
        <div>
          {onBack ? (
            <button
              type="button"
              className="btn-soft auto-history-back"
              onClick={onBack}
            >
              ← Back
            </button>
          ) : null}
          <h2>Automation</h2>
        </div>
        <div className="crm-actions">
          <button type="button" className="btn-dark" onClick={startNew}>
            New automation
          </button>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}

      <div className="drip-shell">
        <div className="drip-tabs">
          <button type="button" className="drip-tab active">
            Flows
          </button>
        </div>

        <div className="drip-toolbar">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="drip-check"
            checked={allVisibleSelected}
            disabled={loading || pageIds.length === 0 || deleting}
            onChange={(event) => toggleAllVisible(event.target.checked)}
            aria-label="Select all automations on this page"
          />
          {selectedIds.size > 0 ? (
            <button
              type="button"
              className="lists-bulk-delete"
              disabled={deleting}
              onClick={() => void deleteSelected([...selectedIds])}
            >
              {deleting ? "Deleting…" : `Delete (${selectedIds.size})`}
            </button>
          ) : null}
          <label className="drip-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search automations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            className="drip-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as AutomationStatus | "all")
            }
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All statuses" : statusLabel(option)}
              </option>
            ))}
          </select>
        </div>

        {!loading && filtered.length > pageSize ? (
          <div className="drip-pagination">
            <span className="drip-page-range">
              {rangeStart}-{rangeEnd} of {filtered.length}
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
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </div>
        ) : null}

        <div className="drip-list">
          {loading ? (
            <div className="drip-empty">Loading automations…</div>
          ) : pageItems.length === 0 ? (
            <div className="drip-empty">
              {items.length === 0 ? (
                <>
                  No automations yet. Click <strong>New automation</strong> to
                  get started.
                </>
              ) : (
                "No automations found."
              )}
              {items.length === 0 ? (
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="btn-dark" onClick={startNew}>
                    New automation
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            pageItems.map((item) => {
              const stats = aggregateStats(item, campaignById);
              const recipients = formatMetric(stats.recipients, stats.recipients);
              const opens = formatMetric(stats.opens, stats.recipients);
              const clicks = formatMetric(stats.clicks, stats.recipients);
              const unsubscribed = formatMetric(
                stats.unsubscribed,
                stats.recipients,
              );
              const statusClass =
                item.status === "completed"
                  ? "sent"
                  : item.status === "running"
                    ? "sending"
                    : item.status === "scheduled"
                      ? "scheduled"
                      : "draft";

              return (
                <div className="drip-card" key={item.id}>
                  <input
                    type="checkbox"
                    className="drip-check"
                    checked={selectedIds.has(item.id)}
                    disabled={deleting}
                    onChange={(event) =>
                      toggleOne(item.id, event.target.checked)
                    }
                    aria-label={`Select ${item.name || "Untitled automation"}`}
                  />
                  <div className="drip-card-inner">
                    <Link
                      href={portalAutomationRoute(item.id)}
                      className="drip-main"
                    >
                      <div className="drip-title">
                        {item.name || "Untitled automation"}
                      </div>
                      <div className="drip-status">
                        <span className={`dot ${statusClass}`} />
                        <strong>{statusLabel(item.status)}</strong>
                        <span>{statusDetail(item)}</span>
                      </div>
                    </Link>
                    <div className="drip-metrics drip-metrics-oneone">
                      <MetricColumn
                        label="Emails"
                        value={stats.emails || "—"}
                        pct={
                          stats.emails > 0
                            ? `${stats.emails} in flow`
                            : "Not started"
                        }
                        stacked
                      />
                      <MetricColumn
                        label="Recipients"
                        value={recipients.value}
                        pct={recipients.pct}
                      />
                      <MetricColumn
                        label="Opens"
                        value={opens.value}
                        pct={opens.pct}
                      />
                      <MetricColumn
                        label="Clicks"
                        value={clicks.value}
                        pct={clicks.pct}
                      />
                      <MetricColumn
                        label="Unsub"
                        value={unsubscribed.value}
                        pct={unsubscribed.pct}
                      />
                    </div>
                    <div className="drip-row-actions">
                      <div className="drip-row-badges">
                        {item.status === "running" ? (
                          <span
                            className="drip-row-status drip-row-status-running"
                            aria-label="Automation is running"
                          >
                            <RowStatusSpinner />
                            Running
                          </span>
                        ) : item.status === "scheduled" ? (
                          <span className="drip-row-status drip-row-status-paused">
                            Scheduled
                          </span>
                        ) : item.status === "completed" ? (
                          <span className="drip-row-status drip-row-status-complete">
                            Complete
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="drip-more-wrap"
                        ref={openMenuId === item.id ? menuRef : undefined}
                      >
                        <button
                          type="button"
                          className={`drip-more${
                            openMenuId === item.id ? " active" : ""
                          }`}
                          aria-label="More actions"
                          aria-expanded={openMenuId === item.id}
                          disabled={deleting}
                          onClick={() =>
                            setOpenMenuId((current) =>
                              current === item.id ? null : item.id,
                            )
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>
                        {openMenuId === item.id ? (
                          <div className="drip-more-menu" role="menu">
                            {automationCanReopenForEdit(item.status) ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={deleting || editingId === item.id}
                                onClick={() => void handleEditAutomation(item)}
                              >
                                <EditIcon />
                                {editingId === item.id
                                  ? "Opening…"
                                  : "Edit automation"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={deleting}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  router.push(portalAutomationRoute(item.id));
                                }}
                              >
                                <EditIcon />
                                {item.status === "completed"
                                  ? "View automation"
                                  : "Open automation"}
                              </button>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              className="danger"
                              disabled={deleting || editingId !== null}
                              onClick={() => void deleteSelected([item.id])}
                            >
                              <TrashIcon />
                              {deletingId === item.id
                                ? "Deleting…"
                                : "Delete automation"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
