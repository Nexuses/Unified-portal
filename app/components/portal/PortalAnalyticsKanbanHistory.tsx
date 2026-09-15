"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createKanbanList,
  deleteKanbanList,
  fetchKanbanLists,
  portalKanbanRoute,
  type KanbanCampaignRef,
  type KanbanList,
} from "@/lib/analytics-kanban";
import {
  fetchDripCampaigns,
  type DripCampaign,
} from "@/lib/drip-campaigns";

function campaignKey(campaign: Pick<DripCampaign, "id" | "kind">) {
  return `${campaign.kind === "oneone" ? "oneone" : "drip"}:${campaign.id}`;
}

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

export default function PortalAnalyticsKanbanHistory() {
  const router = useRouter();
  const [lists, setLists] = useState<KanbanList[]>([]);
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const pickableCampaigns = useMemo(
    () =>
      campaigns
        .filter(
          (campaign) =>
            campaign.status === "sent" ||
            campaign.status === "sending" ||
            campaign.status === "paused" ||
            (campaign.delivered ?? campaign.recipients) > 0,
        )
        .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")),
    [campaigns],
  );

  const visibleCampaigns = useMemo(() => {
    const query = campaignQuery.trim().toLowerCase();
    if (!query) {
      return pickableCampaigns;
    }
    return pickableCampaigns.filter((campaign) => {
      const kind = campaign.kind === "oneone" ? "1-1" : "drip";
      const status = campaignStatusLabel(campaign);
      return (
        campaign.name.toLowerCase().includes(query) ||
        kind.includes(query) ||
        status.toLowerCase().includes(query)
      );
    });
  }, [campaignQuery, pickableCampaigns]);

  function campaignStatusLabel(campaign: DripCampaign) {
    if (campaign.status === "sending") {
      return "Running";
    }
    if (campaign.status === "paused") {
      return "Paused";
    }
    return "Sent";
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [nextLists, drip, oneone] = await Promise.all([
          fetchKanbanLists(),
          fetchDripCampaigns("drip"),
          fetchDripCampaigns("oneone"),
        ]);
        if (cancelled) {
          return;
        }
        setLists(nextLists);
        setCampaigns([...drip, ...oneone]);
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

  function toggleCampaign(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  async function handleCreate() {
    const title = name.trim();
    if (!title || selected.length === 0 || creating) {
      return;
    }
    setCreating(true);
    setError("");
    try {
      const picked: KanbanCampaignRef[] = pickableCampaigns
        .filter((campaign) => selected.includes(campaignKey(campaign)))
        .map((campaign) => ({
          campaignId: campaign.id,
          kind: campaign.kind === "oneone" ? "oneone" : "drip",
          name: campaign.name,
        }));
      const board = await createKanbanList({ name: title, campaigns: picked });
      router.push(portalKanbanRoute(board.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this kanban list?")) {
      return;
    }
    setDeletingId(id);
    setError("");
    try {
      await deleteKanbanList(id);
      setLists((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="an-page">
      <div className="crm-page-head an-page-head">
        <div>
          <h2>Kanban</h2>
          <p className="desc">
            Saved boards. Create a list, pick sent or running Drip and 1-1
            campaigns, then open it to work the pipeline.
          </p>
        </div>
        <div className="crm-actions">
          {showCreate ? (
            <button
              type="button"
              className="btn-soft"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn-dark"
              onClick={() => {
                setCampaignQuery("");
                setShowCreate(true);
              }}
            >
              New list
            </button>
          )}
        </div>
      </div>

      {error ? <div className="an-error">{error}</div> : null}

      {showCreate ? (
        <div className="drip-create-wrap">
          <div className="drip-create-panel">
            <h3>Create a kanban list</h3>
            <p className="drip-create-copy">
              Choose one or more sent or running campaigns. Delivered go to
              Prospect, opens to Engage, clicks to Cold.
            </p>
            <div className="crm-field">
              <label htmlFor="kanban-name">List name</label>
              <input
                id="kanban-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Q3 outreach"
                maxLength={80}
              />
            </div>
            <div className="an-kanban-pick">
              <span>Sent and running campaigns</span>
              {pickableCampaigns.length === 0 ? (
                <p>No sent or running campaigns yet.</p>
              ) : (
                <input
                  className="an-kanban-pick-search"
                  value={campaignQuery}
                  onChange={(event) => setCampaignQuery(event.target.value)}
                  placeholder="Search campaigns…"
                />
              )}
              {pickableCampaigns.length === 0 ? null : visibleCampaigns.length === 0 ? (
                <p>No campaigns match that search.</p>
              ) : (
                <div className="an-kanban-pick-list">
                  {visibleCampaigns.map((campaign) => {
                    const key = campaignKey(campaign);
                    return (
                      <label key={key} className="an-kanban-pick-row">
                        <input
                          type="checkbox"
                          checked={selected.includes(key)}
                          onChange={() => toggleCampaign(key)}
                        />
                        <strong>{campaign.name}</strong>
                        <em>
                          {campaign.kind === "oneone" ? "1-1" : "Drip"} ·{" "}
                          {campaignStatusLabel(campaign)} · {campaign.opens}{" "}
                          opens · {campaign.clicks} clicks
                        </em>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="drip-create-actions">
              <button
                type="button"
                className="btn-link-purple"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={creating || !name.trim() || selected.length === 0}
                onClick={() => void handleCreate()}
              >
                {creating ? "Creating…" : "Create list"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="drip-shell">
          {loading ? (
            <p className="auto-history-empty">Loading…</p>
          ) : lists.length === 0 ? (
            <div className="auto-history-empty">
              <p>No kanban lists yet.</p>
              <button
                type="button"
                className="btn-dark"
                onClick={() => {
                setCampaignQuery("");
                setShowCreate(true);
              }}
              >
                New list
              </button>
            </div>
          ) : (
            <div className="auto-history-list">
              {lists.map((item) => (
                <div key={item.id} className="auto-history-row">
                  <Link
                    href={portalKanbanRoute(item.id)}
                    className="auto-history-main"
                  >
                    <span className="auto-history-name">{item.name}</span>
                    <div className="auto-history-meta">
                      <span className="auto-history-pill">
                        {item.campaigns.length} campaign
                        {item.campaigns.length === 1 ? "" : "s"}
                      </span>
                      <span>
                        {item.campaigns
                          .slice(0, 3)
                          .map((campaign) => campaign.name)
                          .join(", ")}
                        {item.campaigns.length > 3
                          ? ` +${item.campaigns.length - 3}`
                          : ""}
                      </span>
                      <span>Updated {formatUpdated(item.updatedAt)}</span>
                    </div>
                  </Link>
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
