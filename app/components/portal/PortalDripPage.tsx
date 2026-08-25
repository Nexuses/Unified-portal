"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCampaignId,
  formatCampaignStatus,
  formatMetric,
  LAUNCH_NOTICE_KEY,
  loadDripCampaigns,
  mergeBlastReports,
  saveDripCampaigns,
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
    <span className="drip-row-spinner" aria-label="Campaign is running">
      {Array.from({ length: 12 }, (_, index) => (
        <span key={index} style={{ transform: `rotate(${index * 30}deg)` }} />
      ))}
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

function MetricColumn({ label, value, pct }: { label: string; value: number; pct: string }) {
  return (
    <div className="drip-metric">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="p">{pct}</div>
    </div>
  );
}

export default function PortalDripPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [page, setPage] = useState(1);
  const [launchNotice, setLaunchNotice] = useState("");

  useEffect(() => {
    setCampaigns(loadDripCampaigns());
    setLoaded(true);
  }, []);

  useEffect(() => {
    const notice = window.sessionStorage.getItem(LAUNCH_NOTICE_KEY);
    if (notice) {
      setLaunchNotice(notice);
      window.sessionStorage.removeItem(LAUNCH_NOTICE_KEY);
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
        const response = await fetch("/api/campaigns/stats");
        const data = await response.json();
        if (cancelled || !response.ok) {
          return;
        }
        setCampaigns((current) => {
          const next = mergeBlastReports(current, data.reports ?? []);
          saveDripCampaigns(next);
          return next;
        });
      } catch {
        // Keep local campaign rows if stats cannot refresh.
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
  }, [loaded]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    saveDripCampaigns(campaigns);
  }, [campaigns, loaded]);

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
    setShowCreate(true);
  }

  function closeCreateForm() {
    setShowCreate(false);
    setNewName("");
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      return;
    }

    const id = createCampaignId(campaigns);
    const campaign: DripCampaign = {
      id,
      name,
      status: "draft",
      tags: [],
      recipients: 0,
      opens: 0,
      clicks: 0,
      unsubscribed: 0,
      conversions: 0,
    };

    setCampaigns((current) => [campaign, ...current]);
    setShowCreate(false);
    setNewName("");
    router.push(portalCampaignRoute(id));
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
            <h2>Drip Campaign</h2>
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
            <h2>Drip Campaign</h2>
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
            Keep subscribers engaged by sharing your latest news, promoting your
            bestselling products, or announcing an upcoming event.
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
                    <Link href={portalCampaignRoute(campaign.id)} className="drip-main">
                      <div className="drip-title">{campaign.name}</div>
                      <div className="drip-status">
                        <span className={`dot ${campaign.status}`} />
                        <strong>{status.label}</strong>
                        <span>{status.detail}</span>
                      </div>
                      <div className="drip-id">#{campaign.id}</div>
                    </Link>
                    <div className="drip-metrics">
                      <MetricColumn label="Recipients" value={recipients.value} pct={recipients.pct} />
                      <MetricColumn label="Opens" value={opens.value} pct={opens.pct} />
                      <MetricColumn label="Clicks" value={clicks.value} pct={clicks.pct} />
                    <MetricColumn
                      label="Unsubscribed"
                      value={unsubscribed.value}
                      pct={unsubscribed.pct}
                    />
                  </div>
                    <div className="drip-row-actions">
                      {campaign.status === "sending" ? (
                        <span className="drip-row-status drip-row-status-running">
                          <RowStatusSpinner />
                          Running
                        </span>
                      ) : campaign.status === "sent" ? (
                        <span className="drip-row-status drip-row-status-complete">Complete</span>
                      ) : campaign.status === "scheduled" ? (
                        <span className="drip-row-status drip-row-status-scheduled">Scheduled</span>
                      ) : (
                        <>
                          <button type="button" className="drip-pause" aria-label="Pause campaign">
                            <PauseIcon />
                          </button>
                          <button type="button" className="drip-more" aria-label="More actions">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="12" cy="5" r="1.6" />
                              <circle cx="12" cy="12" r="1.6" />
                              <circle cx="12" cy="19" r="1.6" />
                            </svg>
                          </button>
                        </>
                      )}
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
