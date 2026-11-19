"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { eventFormatLabel, type EventFormat } from "@/lib/event-format";

export type EventListItem = {
  id: string;
  eventName: string;
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  status: "draft" | "published";
  platform: string;
  eventFormat: EventFormat;
  publicId: string;
};

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

export function AllEventsBoard({ events }: { events: EventListItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

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
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (statusFilter !== "all" && event.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        event.eventName.toLowerCase().includes(query) ||
        event.platform.toLowerCase().includes(query)
      );
    });
  }, [events, search, statusFilter]);

  async function deleteEvent(eventId: string, eventName: string) {
    const confirmed = window.confirm(
      `Delete "${eventName}"? This removes the campaign and all of its submissions.`,
    );
    if (!confirmed) {
      return;
    }
    setDeletingEventId(eventId);
    setError("");
    setOpenMenuId(null);
    try {
      const response = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to delete campaign.");
      }
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete campaign.");
    } finally {
      setDeletingEventId(null);
    }
  }

  return (
    <div className="drip-shell">
      <div className="drip-tabs">
        <button type="button" className="drip-tab active">
          Events
        </button>
      </div>
      <div className="drip-toolbar">
        <label className="drip-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search for a campaign"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          className="drip-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "all" | "draft" | "published")}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>
      {error ? <p className="crm-error">{error}</p> : null}
      <div className="drip-list">
        {filtered.length === 0 ? (
          <div className="drip-empty">
            {events.length === 0 ? (
              <>
                No campaigns yet. Click <strong>Create campaign</strong> to get started.
              </>
            ) : (
              "No campaigns found."
            )}
          </div>
        ) : (
          filtered.map((event) => {
            const when = [event.eventDate, event.eventTimeStart && event.eventTimeEnd
              ? `${event.eventTimeStart} – ${event.eventTimeEnd}`
              : event.eventTimeStart]
              .filter(Boolean)
              .join(" · ");
            return (
              <div className="drip-card event-campaign-row" key={event.id}>
                <div className="drip-card-inner">
                  <Link href={`/portal/marketing/events/${event.id}/report`} className="drip-main">
                    <div className="drip-title">{event.eventName || "Untitled event"}</div>
                    <div className="drip-status">
                      <span className={`dot ${event.status === "published" ? "sent" : "draft"}`} />
                      <strong>{event.status === "published" ? "Published" : "Draft"}</strong>
                      <span>
                        {eventFormatLabel(event.eventFormat)}
                        {event.platform ? ` · ${event.platform}` : ""}
                        {when ? ` · ${when}` : ""}
                      </span>
                    </div>
                  </Link>
                  <div className="drip-row-actions">
                    <Link
                      href={`/portal/marketing/events/${event.id}/submissions`}
                      className="btn-soft"
                    >
                      Submissions
                    </Link>
                    <Link
                      href={`/portal/marketing/events/${event.id}`}
                      className="btn-soft"
                    >
                      Open event
                    </Link>
                    <Link
                      href={`/portal/marketing/events/${event.id}/analytics`}
                      className="btn-soft"
                    >
                      Analytics
                    </Link>
                    <div
                      className="drip-more-wrap"
                      ref={openMenuId === event.id ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        className={`drip-more${openMenuId === event.id ? " active" : ""}`}
                        aria-label="More actions"
                        aria-expanded={openMenuId === event.id}
                        disabled={deletingEventId !== null}
                        onClick={() =>
                          setOpenMenuId((current) => (current === event.id ? null : event.id))
                        }
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.6" />
                          <circle cx="12" cy="12" r="1.6" />
                          <circle cx="12" cy="19" r="1.6" />
                        </svg>
                      </button>
                      {openMenuId === event.id ? (
                        <div className="drip-more-menu" role="menu">
                          <Link href={`/portal/marketing/events/${event.id}`} role="menuitem">
                            Open campaign
                          </Link>
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            disabled={deletingEventId !== null}
                            onClick={() => void deleteEvent(event.id, event.eventName)}
                          >
                            <TrashIcon />
                            {deletingEventId === event.id ? "Deleting..." : "Delete campaign"}
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
  );
}
