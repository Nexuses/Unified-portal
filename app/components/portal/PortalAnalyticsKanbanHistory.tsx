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
  buildCreateStageRows,
  engagementStageRows,
  type PipelineScope,
  type StageSetupRow,
} from "@/lib/analytics-kanban-pipeline-import";
import {
  fetchDripCampaigns,
  type DripCampaign,
} from "@/lib/drip-campaigns";

type StageRow = StageSetupRow;

const RULE_ORDER = KANBAN_STAGE_RULES.map((item) => item.value);

function stageDot(row: StageRow) {
  if (row.color) {
    return row.color;
  }
  if (row.rule) {
    return KANBAN_DOT_COLORS[Math.max(0, RULE_ORDER.indexOf(row.rule))];
  }
  return KANBAN_DOT_COLORS[4];
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
  const [campaignsOpen, setCampaignsOpen] = useState(true);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [sourceBoardId, setSourceBoardId] = useState("");
  const [pipelineScope, setPipelineScope] = useState<PipelineScope>("full");
  const [pipelineStageIds, setPipelineStageIds] = useState<string[]>([]);
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [stageRows, setStageRows] = useState<StageRow[]>(engagementStageRows);
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

  const stagesValid = useMemo(() => {
    if (stageRows.length === 0 || stageRows.some((row) => !row.name.trim())) {
      return false;
    }
    const engagementRules = stageRows
      .filter((row) => !row.custom && row.rule)
      .map((row) => row.rule!);
    if (new Set(engagementRules).size !== engagementRules.length) {
      return false;
    }
    const names = stageRows.map((row) => row.name.trim().toLowerCase());
    return new Set(names).size === names.length;
  }, [stageRows]);

  const sourceBoard = useMemo(
    () => lists.find((item) => item.id === sourceBoardId) ?? null,
    [lists, sourceBoardId],
  );

  const hasCampaignSource = selected.length > 0;
  const hasPipelineSource = Boolean(
    sourceBoard &&
      sourceBoard.campaigns.length > 0 &&
      (pipelineScope === "full"
        ? sourceBoard.stages.length > 0
        : pipelineStageIds.length > 0),
  );

  const visiblePipelines = useMemo(() => {
    const query = pipelineQuery.trim().toLowerCase();
    if (!query) {
      return lists;
    }
    return lists.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.campaigns.some((campaign) => campaign.name.toLowerCase().includes(query)),
    );
  }, [lists, pipelineQuery]);

  const step1Ready = Boolean(name.trim() && (hasCampaignSource || hasPipelineSource));

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
    setPipelineQuery("");
    setCampaignsOpen(true);
    setPipelineOpen(false);
    setSourceBoardId("");
    setPipelineScope("full");
    setPipelineStageIds([]);
    setSelected([]);
    setName("");
    setStep(1);
    setStageRows(engagementStageRows());
    setShowCreate(true);
  }

  function selectSourceBoard(board: KanbanList) {
    setSourceBoardId(board.id);
    setPipelineScope("full");
    setPipelineStageIds(board.stages.map((stage) => stage.id));
  }

  function clearSourceBoard() {
    setSourceBoardId("");
    setPipelineScope("full");
    setPipelineStageIds([]);
  }

  function togglePipelineStage(stageId: string) {
    setPipelineScope("stages");
    setPipelineStageIds((current) =>
      current.includes(stageId)
        ? current.filter((id) => id !== stageId)
        : [...current, stageId],
    );
  }

  function toggleCampaign(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function goToStageSetup() {
    if (!step1Ready) {
      return;
    }
    setStageRows(
      buildCreateStageRows({
        hasCampaigns: hasCampaignSource,
        pipeline: hasPipelineSource ? sourceBoard : null,
        pipelineScope,
        pipelineStageIds,
      }),
    );
    setStep(2);
  }

  function updateStageRow(key: string, patch: Partial<Omit<StageRow, "key">>) {
    setStageRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addStageRow() {
    setStageRows((rows) => {
      const used = new Set(
        rows.filter((row) => row.rule).map((row) => row.rule as KanbanStageRule),
      );
      const next = KANBAN_STAGE_RULES.find((item) => !used.has(item.value));
      if (!next) {
        return rows;
      }
      return [
        ...rows,
        {
          key: `s-${next.value}-${Date.now()}`,
          name: next.label,
          rule: next.value,
          color: KANBAN_DOT_COLORS[RULE_ORDER.indexOf(next.value)],
          custom: false,
        },
      ];
    });
  }

  function addCustomStageRow() {
    setStageRows((rows) => [
      ...rows,
      {
        key: `custom-${Date.now()}`,
        name: "",
        color: KANBAN_DOT_COLORS[4],
        custom: true,
        customLabel: "Custom",
      },
    ]);
  }

  async function handleCreate() {
    const title = name.trim();
    if (!title || !stagesValid || creating) {
      return;
    }
    setCreating(true);
    setError("");
    try {
      const byKey = new Map<string, KanbanCampaignRef>();
      for (const campaign of pickableCampaigns) {
        const key = campaignKey(campaign);
        if (!selected.includes(key)) {
          continue;
        }
        byKey.set(key, {
          campaignId: campaign.id,
          kind: campaign.kind === "oneone" ? "oneone" : "drip",
          name: campaign.name,
        });
      }
      if (hasPipelineSource && sourceBoard) {
        for (const campaign of sourceBoard.campaigns) {
          const key = `${campaign.kind}:${campaign.campaignId}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              campaignId: campaign.campaignId,
              kind: campaign.kind === "oneone" ? "oneone" : "drip",
              name: campaign.name,
            });
          }
        }
      }
      const picked = [...byKey.values()];
      if (picked.length === 0) {
        throw new Error("Select at least one campaign or an old pipeline with campaigns");
      }
      const stages = stageRows.map((row) => ({
        name: row.name.trim(),
        color: stageDot(row),
        ...(row.custom || !row.rule
          ? { custom: true as const }
          : { rule: row.rule }),
      }));
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
          <h2>Pipeline</h2>
          <p className="desc">
            Saved boards. Create a list from campaigns or copy stages from an
            old pipeline, then open it to work the board.
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
            <h3>{step === 1 ? "Choose source" : "Set up stages"}</h3>
            <p className="drip-create-copy">
              {step === 1
                ? "Name the list. You can pick campaigns, an old pipeline, or both."
                : hasCampaignSource && hasPipelineSource
                  ? "Synced stages (Sent / Open / Click / Reply) plus Custom stages from the old pipeline — old boards cannot sync engagement rules."
                  : hasPipelineSource
                    ? "Custom stages from the old pipeline. Engagement cannot be synced from another board."
                    : "Name each stage and pick what moves a person into it. People go to the furthest synced stage they reach."}
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
                <div className="an-kanban-create-accordions">
                  <div className={`an-kanban-accordion${campaignsOpen ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="an-kanban-accordion-trigger"
                      aria-expanded={campaignsOpen}
                      onClick={() => setCampaignsOpen((open) => !open)}
                    >
                      <span>Campaigns</span>
                      <em>
                        {selected.length > 0
                          ? `${selected.length} selected`
                          : "Pick sent or running campaigns"}
                      </em>
                    </button>
                    {campaignsOpen ? (
                      <div className="an-kanban-accordion-body">
                        <div className="an-kanban-pick">
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
                      </div>
                    ) : null}
                  </div>

                  <div className={`an-kanban-accordion${pipelineOpen ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="an-kanban-accordion-trigger"
                      aria-expanded={pipelineOpen}
                      onClick={() => setPipelineOpen((open) => !open)}
                    >
                      <span>Old pipeline</span>
                      <em>
                        {sourceBoard
                          ? pipelineScope === "full"
                            ? `${sourceBoard.name} · full pipeline`
                            : `${sourceBoard.name} · ${pipelineStageIds.length} stage${pipelineStageIds.length === 1 ? "" : "s"}`
                          : "Optional — add campaigns and Custom stages from a board"}
                      </em>
                    </button>
                    {pipelineOpen ? (
                      <div className="an-kanban-accordion-body">
                        <div className="an-kanban-pick">
                          {lists.length === 0 ? (
                            <p>No old pipelines yet. Create one from campaigns first.</p>
                          ) : (
                            <input
                              className="an-kanban-pick-search"
                              value={pipelineQuery}
                              onChange={(event) => setPipelineQuery(event.target.value)}
                              placeholder="Search pipelines…"
                            />
                          )}
                          {lists.length === 0 ? null : visiblePipelines.length === 0 ? (
                            <p>No pipelines match that search.</p>
                          ) : (
                            <div className="an-kanban-pick-list">
                              {sourceBoardId ? (
                                <button
                                  type="button"
                                  className="btn-link-purple"
                                  onClick={clearSourceBoard}
                                >
                                  Clear old pipeline
                                </button>
                              ) : null}
                              {visiblePipelines.map((board) => {
                                const active = sourceBoardId === board.id;
                                return (
                                  <div key={board.id} className="an-kanban-pipeline-block">
                                    <label className="an-kanban-pick-row">
                                      <input
                                        type="radio"
                                        name="kanban-source-pipeline"
                                        checked={active}
                                        onChange={() => selectSourceBoard(board)}
                                      />
                                      <strong>{board.name}</strong>
                                      <em>
                                        {board.campaigns.length} campaign
                                        {board.campaigns.length === 1 ? "" : "s"} ·{" "}
                                        {board.stages.length} stage
                                        {board.stages.length === 1 ? "" : "s"}
                                      </em>
                                    </label>
                                    {active ? (
                                      <div className="an-kanban-pipeline-stages">
                                        <label className="an-kanban-pick-row an-kanban-pipeline-scope">
                                          <input
                                            type="radio"
                                            name={`kanban-pipeline-scope-${board.id}`}
                                            checked={pipelineScope === "full"}
                                            onChange={() => {
                                              setPipelineScope("full");
                                              setPipelineStageIds(
                                                board.stages.map((stage) => stage.id),
                                              );
                                            }}
                                          />
                                          <strong>Full pipeline</strong>
                                          <em>Import every stage as Custom</em>
                                        </label>
                                        <label className="an-kanban-pick-row an-kanban-pipeline-scope">
                                          <input
                                            type="radio"
                                            name={`kanban-pipeline-scope-${board.id}`}
                                            checked={pipelineScope === "stages"}
                                            onChange={() => setPipelineScope("stages")}
                                          />
                                          <strong>Choose stages</strong>
                                          <em>Pick one or more Custom stages</em>
                                        </label>
                                        {pipelineScope === "stages" ? (
                                          <div className="an-kanban-pipeline-stage-list">
                                            {board.stages.map((stage) => (
                                              <label
                                                key={stage.id}
                                                className="an-kanban-pick-row an-kanban-pipeline-stage"
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={pipelineStageIds.includes(stage.id)}
                                                  onChange={() => togglePipelineStage(stage.id)}
                                                />
                                                <strong>
                                                  <i
                                                    className="an-kanban-dot"
                                                    style={{ background: stage.color }}
                                                    aria-hidden
                                                  />
                                                  {stage.name}
                                                </strong>
                                                <em>Custom</em>
                                              </label>
                                            ))}
                                          </div>
                                        ) : null}
                                        {board.campaigns.length === 0 ? (
                                          <p>This pipeline has no campaigns linked.</p>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
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
                    stageRows
                      .filter((other) => other.key !== row.key && other.rule)
                      .map((other) => other.rule as KanbanStageRule),
                  );
                  const isCustom = Boolean(row.custom || !row.rule);
                  return (
                    <div key={row.key} className="an-kanban-stage-row">
                      <i className="an-kanban-dot" style={{ background: stageDot(row) }} />
                      <input
                        value={row.name}
                        onChange={(event) => updateStageRow(row.key, { name: event.target.value })}
                        placeholder="Stage name"
                        maxLength={40}
                        aria-label="Stage name"
                      />
                      {isCustom ? (
                        <input
                          className="an-kanban-stage-custom-input"
                          value={row.customLabel ?? "Custom"}
                          onChange={(event) =>
                            updateStageRow(row.key, {
                              custom: true,
                              customLabel: event.target.value,
                              rule: undefined,
                            })
                          }
                          placeholder="Custom"
                          maxLength={40}
                          aria-label="Custom moves-in note"
                        />
                      ) : (
                        <select
                          value={row.rule}
                          onChange={(event) =>
                            updateStageRow(row.key, {
                              rule: event.target.value as KanbanStageRule,
                              custom: false,
                            })
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
                      )}
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
                <div className="an-kanban-stage-add-row">
                  {stageRows.filter((row) => !row.custom && row.rule).length <
                  KANBAN_STAGE_RULES.length ? (
                    <button type="button" className="btn-link-purple" onClick={addStageRow}>
                      + Add synced stage
                    </button>
                  ) : null}
                  <button type="button" className="btn-link-purple" onClick={addCustomStageRow}>
                    + Add custom stage
                  </button>
                </div>
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
                    disabled={!step1Ready}
                    onClick={goToStageSetup}
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
