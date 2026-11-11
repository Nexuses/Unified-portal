"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCloudCampaign,
  deleteCloudCampaign,
  fetchCloudCampaigns,
  formatCloudCampaignStatus,
  type CloudCampaign,
  type CloudCampaignStatus,
} from "@/lib/cloud-campaigns";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

const STATUS_OPTIONS: Array<CloudCampaignStatus | "all"> = [
  "all",
  "draft",
  "ready",
  "sending",
  "paused",
  "sent",
];

function campaignPath(id: string) {
  return `${PORTAL_ROUTES.cloud}/${encodeURIComponent(id)}`;
}

function RowStatusSpinner() {
  return (
    <span className="drip-row-spinner" aria-hidden="true">
      <span className="drip-row-spinner-ring" />
    </span>
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

export default function PortalCloudCampaignPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CloudCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CloudCampaignStatus | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pageSize = 10;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchCloudCampaigns();
        if (!cancelled) setCampaigns(next);
      } catch {
        if (!cancelled) setCampaigns([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenuId(null);
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
      const matchesStatus = statusFilter === "all" || campaign.status === statusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      return (
        campaign.name.toLowerCase().includes(query) ||
        campaign.id.toLowerCase().includes(query) ||
        (campaign.profileGmail || "").toLowerCase().includes(query)
      );
    });
  }, [campaigns, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
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
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreateError("");
    try {
      const campaign = await createCloudCampaign(name);
      setCampaigns((current) => [campaign, ...current]);
      setShowCreate(false);
      setNewName("");
      router.push(campaignPath(campaign.id));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create campaign");
    }
  }

  async function handleDelete(campaign: CloudCampaign) {
    if (!window.confirm(`Delete campaign "${campaign.name}"?`)) return;
    setDeletingId(campaign.id);
    setOpenMenuId(null);
    try {
      await deleteCloudCampaign(campaign.id);
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(campaign.id);
        return next;
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete campaign");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const confirmText =
      ids.length === 1
        ? `Delete campaign "${campaigns.find((item) => item.id === ids[0])?.name ?? ids[0]}"?`
        : `Delete ${ids.length} campaigns?`;
    if (!window.confirm(confirmText)) return;
    setDeletingId("bulk");
    try {
      await Promise.all(ids.map((id) => deleteCloudCampaign(id)));
      const removed = new Set(ids);
      setCampaigns((current) => current.filter((item) => !removed.has(item.id)));
      setSelectedIds(new Set());
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete campaigns");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {!showCreate ? (
        <div className="crm-page-head drip-page-head">
          <div>
            <h2>Cloud Campaign</h2>
          </div>
          <div className="crm-actions">
            <button type="button" className="btn-dark" onClick={() => setShowCreate(true)}>
              Create campaign
            </button>
          </div>
        </div>
      ) : (
        <div className="crm-page-head">
          <div>
            <h2>Cloud Campaign</h2>
          </div>
          <div className="crm-actions">
            <button type="button" className="btn-soft" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showCreate ? (
        <div className="drip-create-wrap">
          <div className="drip-create-panel">
            <h3>Create a cloud campaign</h3>
            <p className="drip-create-copy">
              The Boat computer opens Gmail or Outlook in one Chrome profile and your sheet in
              another tab, then sends each pitch. You only sign in when that profile needs a login.
            </p>
            <form onSubmit={handleCreate} className="drip-create-form">
              <div className="crm-field">
                <label htmlFor="cloud-campaign-name">Campaign name</label>
                <div className="drip-name-wrap">
                  <input
                    id="cloud-campaign-name"
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
                <button type="button" className="btn-link-purple" onClick={() => setShowCreate(false)}>
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
              disabled={!loaded || pageItems.length === 0 || deletingId !== null}
              onChange={(event) => toggleAll(event.target.checked)}
              aria-label="Select all campaigns on this page"
            />
            {selectedIds.size > 0 ? (
              <button
                type="button"
                className="drip-bulk-delete"
                disabled={deletingId !== null}
                onClick={() => void handleBulkDelete()}
              >
                {deletingId === "bulk" ? "Deleting..." : `Delete (${selectedIds.size})`}
              </button>
            ) : null}
            <label className="drip-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
                setStatusFilter(event.target.value as CloudCampaignStatus | "all");
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
                    No campaigns yet. Click <strong>Create campaign</strong> to get started.
                  </>
                ) : (
                  "No campaigns found."
                )}
              </div>
            ) : (
              pageItems.map((campaign) => {
                const status = formatCloudCampaignStatus(campaign);
                const total = campaign.sheetRowCount ?? 0;
                const progress =
                  total > 0 ? `${campaign.nextRow} / ${total}` : campaign.status === "draft" ? "—" : "0";
                return (
                  <div className="drip-card" key={campaign.id}>
                    <input
                      type="checkbox"
                      className="drip-check"
                      checked={selectedIds.has(campaign.id)}
                      disabled={deletingId !== null || campaign.status === "sending"}
                      onChange={(event) => toggleOne(campaign.id, event.target.checked)}
                      aria-label={`Select ${campaign.name}`}
                    />
                    <div className="drip-card-inner">
                      <Link href={campaignPath(campaign.id)} className="drip-main">
                        <div className="drip-title">{campaign.name}</div>
                        <div className="drip-status">
                          <span className={`dot ${campaign.status}`} />
                          <strong>{status.label}</strong>
                          <span>{status.detail}</span>
                        </div>
                      </Link>
                      <div className="drip-metrics">
                        <MetricColumn label="Rows" value={total || "—"} />
                        <MetricColumn label="Sent" value={campaign.sentCount} />
                        <MetricColumn label="Failed" value={campaign.failedCount} />
                        <MetricColumn label="Progress" value={progress} stacked />
                      </div>
                      <div className="drip-row-actions">
                        <div className="drip-row-badges">
                          {campaign.status === "sending" ? (
                            <span
                              className="drip-row-status drip-row-status-running"
                              aria-label="Campaign is running"
                            >
                              <RowStatusSpinner />
                              Running
                            </span>
                          ) : campaign.status === "paused" ? (
                            <span className="drip-row-status drip-row-status-paused">Paused</span>
                          ) : campaign.status === "sent" ? (
                            <span className="drip-row-status drip-row-status-complete">Complete</span>
                          ) : campaign.status === "ready" ? (
                            <span className="drip-row-status drip-row-status-scheduled">Ready</span>
                          ) : null}
                        </div>
                        <div
                          className="drip-more-wrap"
                          ref={openMenuId === campaign.id ? menuRef : undefined}
                        >
                          <button
                            type="button"
                            className={`drip-more${openMenuId === campaign.id ? " active" : ""}`}
                            aria-label="More actions"
                            aria-expanded={openMenuId === campaign.id}
                            disabled={deletingId !== null}
                            onClick={() =>
                              setOpenMenuId((current) =>
                                current === campaign.id ? null : campaign.id,
                              )
                            }
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="12" cy="5" r="1.6" />
                              <circle cx="12" cy="12" r="1.6" />
                              <circle cx="12" cy="19" r="1.6" />
                            </svg>
                          </button>
                          {openMenuId === campaign.id ? (
                            <div className="drip-more-menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="danger"
                                disabled={deletingId !== null || campaign.status === "sending"}
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
