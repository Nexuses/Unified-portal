"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const list = await fetchAutomations();
        if (cancelled) {
          return;
        }
        // Drop empty shells (never belonged in history — created before first step).
        const empties = list.filter((item) => (item.steps?.length ?? 0) === 0);
        if (empties.length > 0) {
          await Promise.allSettled(empties.map((item) => deleteAutomation(item.id)));
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

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this automation?")) {
      return;
    }
    setDeletingId(id);
    setError("");
    try {
      await deleteAutomation(id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="crm-page auto-history-page">
      <div className="crm-page-head drip-page-head">
        <div>
          <h2>Automation history</h2>
          <p className="auto-history-sub">
            Saved flows. Delete drafts anytime.
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
            {filtered.map((item) => (
              <div
                key={item.id}
                className={`auto-history-row${
                  item.status === "completed"
                    ? " done"
                    : item.status === "running" || item.status === "scheduled"
                      ? " live"
                      : ""
                }`}
              >
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
                {item.status === "draft" ? (
                  <div className="auto-history-actions">
                    <button
                      type="button"
                      className="btn-link-purple"
                      disabled={deletingId === item.id}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleDelete(item.id);
                      }}
                    >
                      {deletingId === item.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
