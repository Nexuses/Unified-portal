"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deleteAutomation,
  fetchAutomations,
  patchAutomation,
  portalAutomationRoute,
  type PortalAutomation,
} from "@/lib/automations";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

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
  const [items, setItems] = useState<PortalAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

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
    if (!q) {
      return visibleItems;
    }
    return visibleItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q),
    );
  }, [visibleItems, query]);

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

  function startRename(item: PortalAutomation) {
    setRenamingId(item.id);
    setRenameValue(item.name || "Untitled automation");
  }

  async function saveRename(id: string) {
    const nextName = renameValue.trim();
    if (!nextName) {
      setError("Name is required");
      return;
    }
    setRenaming(true);
    setError("");
    try {
      const updated = await patchAutomation(id, { name: nextName });
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...updated } : item)),
      );
      setRenamingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setRenaming(false);
    }
  }

  return (
    <div className="crm-page auto-history-page">
      <div className="crm-page-head drip-page-head">
        <div>
          <h2>Automation history</h2>
          <p className="auto-history-sub">
            Each row is one automation (all email steps inside it). Saved only after you
            add the first email step. Rename, edit, or delete drafts here.
          </p>
        </div>
        <div className="crm-actions">
          <Link href={PORTAL_ROUTES.automation} className="btn-dark">
            New automation
          </Link>
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
        </div>

        {loading ? (
          <p className="auto-history-empty">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="auto-history-empty">
            <p>No automations yet.</p>
            <Link href={PORTAL_ROUTES.automation} className="btn-dark">
              Create automation
            </Link>
          </div>
        ) : (
          <div className="auto-history-list">
            {filtered.map((item) => (
              <div key={item.id} className="auto-history-row">
                <div className="auto-history-main">
                  {renamingId === item.id ? (
                    <div className="auto-history-rename">
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void saveRename(item.id);
                          }
                          if (event.key === "Escape") {
                            setRenamingId(null);
                          }
                        }}
                        aria-label="Automation name"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn-dark"
                        disabled={renaming}
                        onClick={() => void saveRename(item.id)}
                      >
                        {renaming ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="btn-soft"
                        disabled={renaming}
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <Link
                      href={portalAutomationRoute(item.id)}
                      className="auto-history-name"
                    >
                      {item.name || "Untitled automation"}
                    </Link>
                  )}
                  <div className="auto-history-meta">
                    <span className="auto-history-pill">{statusLabel(item.status)}</span>
                    <span>{item.kind === "oneone" ? "1-1" : "Drip"}</span>
                    <span>
                      {item.steps.length} step{item.steps.length === 1 ? "" : "s"}
                    </span>
                    <span>Updated {formatUpdated(item.updatedAt)}</span>
                  </div>
                </div>
                <div className="auto-history-actions">
                  {item.status === "draft" && renamingId !== item.id ? (
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={() => startRename(item)}
                    >
                      Rename
                    </button>
                  ) : null}
                  <Link
                    href={portalAutomationRoute(item.id)}
                    className="btn-soft"
                  >
                    {item.status === "draft" ? "Edit" : "View"}
                  </Link>
                  {item.status === "draft" ? (
                    <button
                      type="button"
                      className="btn-link-purple"
                      disabled={deletingId === item.id}
                      onClick={() => void handleDelete(item.id)}
                    >
                      {deletingId === item.id ? "Deleting…" : "Delete"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
