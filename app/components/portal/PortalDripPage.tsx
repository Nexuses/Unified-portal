"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDripCampaign,
  deleteDripCampaign,
  fetchDripCampaigns,
  formatCampaignStatus,
  formatMetric,
  formatSequenceProgress,
  patchDripCampaign,
  type CampaignKind,
  type CampaignStatus,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { portalCampaignRoute } from "@/lib/portal-nav";

const STATUS_OPTIONS: Array<CampaignStatus | "all"> = [
  "all",
  "draft",
  "scheduled",
  "sending",
  "sent",
  "paused",
];

function RowStatusSpinner() {
  return (
    <span className="drip-row-spinner" aria-hidden="true">
      <span className="drip-row-spinner-ring" />
    </span>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="5" width="3.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13l11-6.5L8 5.5Z" />
    </svg>
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

export default function PortalDripPage({
  kind = "drip",
}: {
  kind?: CampaignKind;
}) {
  const router = useRouter();
  const isOneOne = kind === "oneone";
  const listTitle = isOneOne ? "1-1 Campaign" : "Drip Campaign";
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [page, setPage] = useState(1);
  const [launchNotice, setLaunchNotice] = useState("");
  const [createError, setCreateError] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchDripCampaigns(kind);
        if (!cancelled) {
          setCampaigns(next);
        }
      } catch {
        if (!cancelled) {
          setCampaigns([]);
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("notice") === "scheduled") {
      setLaunchNotice("Campaign is scheduled");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    let cancelled = false;
    async function syncStats() {
      try {
        await fetch("/api/campaigns/process-due", { method: "POST" });
        const next = await fetchDripCampaigns(kind);
        if (!cancelled) {
          setCampaigns(next);
        }
      } catch {
        // Keep current campaign rows if stats cannot refresh.
      }
    }

    void syncStats();
    const timer = window.setInterval(() => {
      void syncStats();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loaded, kind]);

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
    return campaigns.filter((campaign) => {
      const matchesSearch =
        !query ||
        campaign.name.toLowerCase().includes(query) ||
        campaign.id.includes(query);
      const matchesStatus =
        statusFilter === "all" || campaign.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, search, statusFilter]);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, filtered.length);

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(pageItems.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
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

  function openCreateForm() {
    setNewName("");
    setCreateError("");
    setShowCreate(true);
  }

  function closeCreateForm() {
    setShowCreate(false);
    setNewName("");
    setCreateError("");
  }

  async function handleDelete(campaign: DripCampaign) {
    if (!window.confirm(`Delete campaign "${campaign.name}"?`)) {
      setOpenMenuId(null);
      return;
    }

    setDeletingId(campaign.id);
    setOpenMenuId(null);
    try {
      await deleteDripCampaign(campaign.id, kind);
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(campaign.id);
        return next;
      });
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to delete campaign",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePause(campaign: DripCampaign) {
    if (campaign.status !== "sending" && campaign.status !== "scheduled") {
      return;
    }

    setStatusUpdatingId(campaign.id);
    setOpenMenuId(null);
    try {
      const updated = await patchDripCampaign(campaign.id, { status: "paused" }, kind);
      setCampaigns((current) =>
        current.map((item) => (item.id === campaign.id ? updated : item)),
      );
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to pause campaign",
      );
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function handleResume(campaign: DripCampaign) {
    if (campaign.status !== "paused") {
      return;
    }

    setStatusUpdatingId(campaign.id);
    setOpenMenuId(null);
    try {
      const updated = await patchDripCampaign(campaign.id, { status: "sending" }, kind);
      setCampaigns((current) =>
        current.map((item) => (item.id === campaign.id ? updated : item)),
      );
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to resume campaign",
      );
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      return;
    }

    setCreateError("");
    try {
      const campaign = await createDripCampaign(name, kind);
      setCampaigns((current) => [campaign, ...current]);
      setShowCreate(false);
      setNewName("");
      router.push(portalCampaignRoute(campaign.id, kind));
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create campaign",
      );
    }
  }

  return (
    <>
      {launchNotice ? (
        <div className="drip-launch-alert" role="alert">
          <div className="drip-launch-alert-body">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span>{launchNotice}</span>
          </div>
          <button
            type="button"
            className="drip-launch-alert-close"
            onClick={() => setLaunchNotice("")}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      {!showCreate ? (
        <div className="crm-page-head drip-page-head">
          <div>
            <h2>{listTitle}</h2>
          </div>
          <div className="crm-actions">
            <button type="button" className="btn-dark" onClick={openCreateForm}>
              Create campaign
            </button>
          </div>
        </div>
      ) : (
        <div className="crm-page-head">
          <div>
            <h2>{listTitle}</h2>
          </div>
          <div className="crm-actions">
            <button type="button" className="btn-soft" onClick={closeCreateForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showCreate ? (
        <div className="drip-create-wrap">
          <div className="drip-create-panel">
          <h3>Create an email campaign</h3>
          <p className="drip-create-copy">
            {isOneOne
              ? "Send a sequence of emails to the same contacts, with a wait between each step and a daily sending window."
              : "Keep subscribers engaged by sharing your latest news, promoting your bestselling products, or announcing an upcoming event."}
          </p>
          <form onSubmit={handleCreate} className="drip-create-form">
            <div className="crm-field">
              <label htmlFor="campaign-name">Campaign name</label>
              <div className="drip-name-wrap">
                <input
                  id="campaign-name"
                  type="text"
                  maxLength={128}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  required
                />
                <span>{newName.length}/128</span>
              </div>
            </div>
            {createError ? <p className="crm-error">{createError}</p> : null}
            <div className="drip-create-actions">
              <button type="button" className="btn-link-purple" onClick={closeCreateForm}>
                Cancel
              </button>
              <button type="submit" className="btn-dark" disabled={!newName.trim()}>
                Create campaign
              </button>
            </div>
          </form>
          </div>
        </div>
      ) : (
      <div className="drip-shell">
        <div className="drip-tabs">
          <button type="button" className="drip-tab active">
            Email
          </button>
        </div>

        <div className="drip-toolbar">
          <input
            type="checkbox"
            className="drip-check"
            checked={pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id))}
            onChange={(event) => toggleAll(event.target.checked)}
            aria-label="Select all campaigns on this page"
          />
          <label className="drip-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search for a campaign"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            className="drip-select"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as CampaignStatus | "all");
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "all"
                  ? "All statuses"
                  : option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="drip-pagination">
          <span className="drip-page-range">
            {rangeStart}-{rangeEnd} of {filtered.length}
          </span>
          <div className="drip-page-controls">
            <select
              value={currentPage}
              onChange={(event) => setPage(Number(event.target.value))}
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

        <div className="drip-list">
          {!loaded ? (
            <div className="drip-empty">Loading campaigns...</div>
          ) : pageItems.length === 0 ? (
            <div className="drip-empty">
              {campaigns.length === 0 ? (
                <>
                  No campaigns yet. Click <strong>Create campaign</strong> to get
                  started.
                </>
              ) : (
                "No campaigns found."
              )}
            </div>
          ) : (
            pageItems.map((campaign) => {
              const status = formatCampaignStatus(campaign);
              const progress = formatSequenceProgress(campaign.sequenceProgress);
              const recipients = formatMetric(campaign.recipients, campaign.recipients);
              const opens = formatMetric(campaign.opens, campaign.recipients);
              const clicks = formatMetric(campaign.clicks, campaign.recipients);
              const unsubscribed = formatMetric(
                campaign.unsubscribed,
                campaign.recipients,
              );

              return (
                <div className="drip-card" key={campaign.id}>
                  <input
                    type="checkbox"
                    className="drip-check"
                    checked={selectedIds.has(campaign.id)}
                    onChange={(event) => toggleOne(campaign.id, event.target.checked)}
                    aria-label={`Select ${campaign.name}`}
                  />
                  <div className="drip-card-inner">
                    <Link href={portalCampaignRoute(campaign.id, kind)} className="drip-main">
                      <div className="drip-id">#{campaign.id}</div>
                      <div className="drip-title">{campaign.name}</div>
                      <div className="drip-status">
                        <span className={`dot ${campaign.status}`} />
                        <strong>{status.label}</strong>
                        <span>{status.detail}</span>
                      </div>
                    </Link>
                    <div className={`drip-metrics${isOneOne ? " drip-metrics-oneone" : ""}`}>
                      {isOneOne ? (
                        <MetricColumn
                          label="Sequence"
                          value={progress?.sequence ?? "—"}
                          pct={
                            progress
                              ? `${progress.sent} sent`
                              : campaign.status === "draft"
                                ? "Not started"
                                : undefined
                          }
                          stacked
                        />
                      ) : null}
                      <MetricColumn label="Recipients" value={recipients.value} pct={recipients.pct} />
                      <MetricColumn label="Opens" value={opens.value} pct={opens.pct} />
                      <MetricColumn label="Clicks" value={clicks.value} pct={clicks.pct} />
                      <MetricColumn
                        label="Unsub"
                        value={unsubscribed.value}
                        pct={unsubscribed.pct}
                      />
                    </div>
                    <div className="drip-row-actions">
                      {campaign.status === "sending" ? (
                        <span
                          className="drip-row-status drip-row-status-running"
                          aria-label="Campaign is running"
                        >
                          <RowStatusSpinner />
                          Running
                        </span>
                      ) : campaign.status === "sent" ? (
                        <span className="drip-row-status drip-row-status-complete">Complete</span>
                      ) : campaign.status === "scheduled" ? (
                        <span className="drip-row-status drip-row-status-scheduled">Scheduled</span>
                      ) : campaign.status === "paused" ? (
                        <span className="drip-row-status drip-row-status-paused">Paused</span>
                      ) : (
                        <button
                          type="button"
                          className="drip-pause"
                          aria-label="Pause campaign"
                          disabled
                          title="Pause is available after the campaign is scheduled or running"
                        >
                          <PauseIcon />
                        </button>
                      )}
                      <div
                        className="drip-more-wrap"
                        ref={openMenuId === campaign.id ? menuRef : undefined}
                      >
                        <button
                          type="button"
                          className={`drip-more${openMenuId === campaign.id ? " active" : ""}`}
                          aria-label="More actions"
                          aria-expanded={openMenuId === campaign.id}
                          disabled={
                            deletingId === campaign.id || statusUpdatingId === campaign.id
                          }
                          onClick={() =>
                            setOpenMenuId((current) =>
                              current === campaign.id ? null : campaign.id,
                            )
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>
                        {openMenuId === campaign.id ? (
                          <div className="drip-more-menu" role="menu">
                            {campaign.status === "sending" ||
                            campaign.status === "scheduled" ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={statusUpdatingId === campaign.id}
                                onClick={() => void handlePause(campaign)}
                              >
                                <PauseIcon />
                                {statusUpdatingId === campaign.id
                                  ? "Pausing..."
                                  : "Pause campaign"}
                              </button>
                            ) : null}
                            {campaign.status === "paused" ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={statusUpdatingId === campaign.id}
                                onClick={() => void handleResume(campaign)}
                              >
                                <PlayIcon />
                                {statusUpdatingId === campaign.id
                                  ? "Resuming..."
                                  : "Resume campaign"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              role="menuitem"
                              className="danger"
                              disabled={deletingId === campaign.id}
                              onClick={() => void handleDelete(campaign)}
                            >
                              <TrashIcon />
                              {deletingId === campaign.id ? "Deleting..." : "Delete campaign"}
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
      )}
    </>
  );
}
