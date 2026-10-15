"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createKanbanList,
  deleteKanbanList,
  fetchKanbanLists,
  KANBAN_DOT_COLORS,
  KANBAN_STAGE_RULES,
  portalKanbanRoute,
  type KanbanCampaignRef,
  type KanbanList,
  type KanbanStageRule,
} from "@/lib/analytics-kanban";
import {
  fetchDripCampaigns,
  type DripCampaign,
} from "@/lib/drip-campaigns";

type StageRow = { key: string; name: string; rule: KanbanStageRule };

const RULE_ORDER = KANBAN_STAGE_RULES.map((item) => item.value);

function stageColor(rule: KanbanStageRule) {
  return KANBAN_DOT_COLORS[Math.max(0, RULE_ORDER.indexOf(rule))];
}

function defaultStageRows(): StageRow[] {
  return [
    { key: "s-delivered", name: "Prospect", rule: "delivered" },
    { key: "s-opened", name: "Engage", rule: "opened" },
    { key: "s-clicked", name: "Cold", rule: "clicked" },
  ];
}

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
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [stageRows, setStageRows] = useState<StageRow[]>(defaultStageRows);
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

  const stagesValid =
    stageRows.length > 0 &&
    stageRows.every((row) => row.name.trim()) &&
    new Set(stageRows.map((row) => row.rule)).size === stageRows.length;

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

  function openCreate() {
    setCampaignQuery("");
    setStep(1);
    setStageRows(defaultStageRows());
    setShowCreate(true);
  }

  function toggleCampaign(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function updateStageRow(key: string, patch: Partial<Omit<StageRow, "key">>) {
    setStageRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addStageRow() {
    setStageRows((rows) => {
      const used = new Set(rows.map((row) => row.rule));
      const next = KANBAN_STAGE_RULES.find((item) => !used.has(item.value));
      if (!next) {
        return rows;
      }
      const added = [...rows, { key: `s-${next.value}-${Date.now()}`, name: next.label, rule: next.value }];
      return added.sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
    });
  }

  async function handleCreate() {
    const title = name.trim();
    if (!title || selected.length === 0 || !stagesValid || creating) {
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
      const stages = [...stageRows]
        .sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule))
        .map((row) => ({ name: row.name.trim(), color: stageColor(row.rule), rule: row.rule }));
      const board = await createKanbanList({ name: title, campaigns: picked, stages });
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
            <button type="button" className="btn-dark" onClick={openCreate}>
              New list
            </button>
          )}
        </div>
      </div>

      {error ? <div className="an-error">{error}</div> : null}

      {showCreate ? (
        <div className="drip-create-wrap">
          <div className="drip-create-panel">
            <span className="an-kanban-step">Step {step} of 2</span>
            <h3>{step === 1 ? "Choose campaigns" : "Set up stages"}</h3>
            <p className="drip-create-copy">
              {step === 1
                ? "Name the list and pick one or more sent or running campaigns."
                : "Name each stage and pick what moves a person into it. People go to the furthest stage they reach."}
            </p>
            {step === 1 ? (
              <>
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
              </>
            ) : (
              <div className="an-kanban-stage-setup">
                <div className="an-kanban-stage-head">
                  <span>Stage name</span>
                  <span>Moves in when</span>
                </div>
                {stageRows.map((row) => {
                  const usedByOthers = new Set(
                    stageRows.filter((other) => other.key !== row.key).map((other) => other.rule),
                  );
                  return (
                    <div key={row.key} className="an-kanban-stage-row">
                      <i className="an-kanban-dot" style={{ background: stageColor(row.rule) }} />
                      <input
                        value={row.name}
                        onChange={(event) => updateStageRow(row.key, { name: event.target.value })}
                        placeholder="Stage name"
                        maxLength={40}
                        aria-label="Stage name"
                      />
                      <select
                        value={row.rule}
                        onChange={(event) =>
                          updateStageRow(row.key, { rule: event.target.value as KanbanStageRule })
                        }
                        aria-label="Moves in when"
                      >
                        {KANBAN_STAGE_RULES.map((item) => (
                          <option
                            key={item.value}
                            value={item.value}
                            disabled={usedByOthers.has(item.value)}
                          >
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="an-kanban-stage-remove"
                        disabled={stageRows.length <= 1}
                        onClick={() =>
                          setStageRows((rows) => rows.filter((item) => item.key !== row.key))
                        }
                        aria-label={`Remove ${row.name || "stage"}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {stageRows.length < KANBAN_STAGE_RULES.length ? (
                  <button type="button" className="btn-link-purple" onClick={addStageRow}>
                    + Add stage
                  </button>
                ) : null}
              </div>
            )}
            <div className="drip-create-actions">
              {step === 1 ? (
                <>
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
                    disabled={!name.trim() || selected.length === 0}
                    onClick={() => setStep(2)}
                  >
                    Next
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-link-purple"
                    disabled={creating}
                    onClick={() => setStep(1)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-dark"
                    disabled={creating || !stagesValid}
                    onClick={() => void handleCreate()}
                  >
                    {creating ? "Creating…" : "Create list"}
                  </button>
                </>
              )}
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
              <button type="button" className="btn-dark" onClick={openCreate}>
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
                    <div className="auto-history-meta kb-list-meta">
                      <span className="auto-history-pill">
                        {item.campaigns.length} campaign
                        {item.campaigns.length === 1 ? "" : "s"}
                      </span>
                      {item.campaigns[0] ? (
                        <span className="kb-list-campaign" title={item.campaigns[0].name}>
                          {item.campaigns[0].name}
                        </span>
                      ) : null}
                      {item.campaigns.length > 1 ? (
                        <span
                          className="kb-list-more"
                          title={item.campaigns
                            .slice(1)
                            .map((campaign) => campaign.name)
                            .join("\n")}
                        >
                          +{item.campaigns.length - 1}
                        </span>
                      ) : null}
                      <span className="kb-list-updated">
                        Updated {formatUpdated(item.updatedAt)}
                      </span>
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
