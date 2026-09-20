"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteAutomation,
  fetchAutomations,
  portalAutomationRoute,
  type AutomationStatus,
  type PortalAutomation,
} from "@/lib/automations";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

const STATUS_FILTERS: Array<AutomationStatus | "all"> = [
  "all",
  "draft",
  "scheduled",
  "running",
  "completed",
];

function formatUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

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

export default function PortalAutomationHistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<PortalAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationStatus | "all">(
    "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const pageSize = 10;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const list = await fetchAutomations({ nonEmptyOnly: true });
        if (cancelled) {
          return;
        }
        setItems(list.filter((item) => (item.steps?.length ?? 0) > 0));
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

  // One automation = many steps. Empty (0-step) rows are purged on load / never listed.
  const visibleItems = useMemo(
    () => items.filter((item) => (item.steps?.length ?? 0) > 0),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleItems.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.name.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q)
      );
    });
  }, [visibleItems, query, statusFilter]);

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
      const allowed = new Set(visibleItems.map((item) => item.id));
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
  }, [visibleItems]);

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
    }
  }

  return (
    <div className="crm-page auto-history-page">
      <div className="crm-page-head drip-page-head">
        <div>
          <h2>Automation history</h2>
          <p className="auto-history-sub">
            Saved flows. Select one or more to delete.
          </p>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn-dark"
            onClick={() =>
              router.push(`${PORTAL_ROUTES.automation}?new=${Date.now()}`)
            }
          >
            New automation
          </button>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}

      <div className="drip-shell">
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
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="auto-history-empty">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="auto-history-empty">
            <p>No automations yet.</p>
            <button
              type="button"
              className="btn-dark"
              onClick={() =>
                router.push(`${PORTAL_ROUTES.automation}?new=${Date.now()}`)
              }
            >
              Create automation
            </button>
          </div>
        ) : (
          <div className="auto-history-list">
            {pageItems.map((item) => (
              <div
                key={item.id}
                className={`auto-history-row${
                  item.status === "completed"
                    ? " done"
                    : item.status === "running" || item.status === "scheduled"
                      ? " live"
                      : ""
                }${selectedIds.has(item.id) ? " selected" : ""}`}
              >
                <input
                  type="checkbox"
                  className="drip-check auto-history-check"
                  checked={selectedIds.has(item.id)}
                  disabled={deleting}
                  onChange={(event) => toggleOne(item.id, event.target.checked)}
                  aria-label={`Select ${item.name || "Untitled automation"}`}
                />
                <Link
                  href={portalAutomationRoute(item.id)}
                  className="auto-history-main"
                >
                  <span className="auto-history-name">
                    {item.name || "Untitled automation"}
                  </span>
                  <div className="auto-history-meta">
                    <span
                      className={`auto-history-pill${
                        item.status === "completed" ? " done" : ""
                      }`}
                    >
                      {statusLabel(item.status)}
                    </span>
                    <span>{item.kind === "oneone" ? "1-1" : "Drip"}</span>
                    <span>
                      {item.steps.length} step{item.steps.length === 1 ? "" : "s"}
                    </span>
                    <span>Updated {formatUpdated(item.updatedAt)}</span>
                  </div>
                </Link>
                <div className="auto-history-actions">
                  <button
                    type="button"
                    className="btn-link-purple"
                    disabled={deleting}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void deleteSelected([item.id]);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
