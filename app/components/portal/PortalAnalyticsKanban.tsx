"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  autoStageId,
  chatKanbanBoard,
  DEFAULT_STAGE_COLOR,
  fetchKanbanBoard,
  KANBAN_DOT_COLORS,
  patchKanbanBoard,
  portalKanbanRoute,
  stageIdForPerson,
  type KanbanBoard,
  type KanbanCampaignRef,
  type KanbanPerson,
  type KanbanStage,
} from "@/lib/analytics-kanban";
import {
  fetchDripCampaigns,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { PORTAL_ROUTES, portalContactRoute } from "@/lib/portal-nav";

function campaignKey(campaign: Pick<DripCampaign, "id" | "kind">) {
  return `${campaign.kind === "oneone" ? "oneone" : "drip"}:${campaign.id}`;
}

function displayName(person: KanbanPerson) {
  const name = person.fullName.trim();
  if (name && name.toLowerCase() !== person.email.trim().toLowerCase()) {
    return name;
  }
  return person.email;
}

function stageLabel(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return name;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function stageDotColor(stage: KanbanStage) {
  return stage.color || DEFAULT_STAGE_COLOR;
}

function cardInitials(name: string, email: string) {
  if (name && name.toLowerCase() !== email) {
    const parts = name.split(/\s+/).filter(Boolean);
    const letters = `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
    if (letters) {
      return letters;
    }
  }
  return (email[0] || "?").toUpperCase();
}

function StageGrip() {
  return (
    <span className="an-kanban-grip" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export default function PortalAnalyticsKanban({ boardId }: { boardId: string }) {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState<string>(DEFAULT_STAGE_COLOR);
  const [adding, setAdding] = useState(false);
  const [draggingPerson, setDraggingPerson] = useState("");
  const [draggingStage, setDraggingStage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chat, setChat] = useState<Array<{ role: "user" | "assistant"; content: string }>>(
    [],
  );
  const [editingCampaigns, setEditingCampaigns] = useState(false);
  const [allCampaigns, setAllCampaigns] = useState<DripCampaign[]>([]);
  const [pickedCampaigns, setPickedCampaigns] = useState<string[]>([]);
  const [savingCampaigns, setSavingCampaigns] = useState(false);
  const [campaignQuery, setCampaignQuery] = useState("");
  const boardRef = useRef<HTMLDivElement | null>(null);

  function scrollElementIntoView(
    container: HTMLElement,
    target: HTMLElement,
    axis: "left" | "top",
    pad: number,
  ) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const start = axis === "left" ? containerRect.left : containerRect.top;
    const end = axis === "left" ? containerRect.right : containerRect.bottom;
    const targetStart = axis === "left" ? targetRect.left : targetRect.top;
    const targetEnd = axis === "left" ? targetRect.right : targetRect.bottom;
    let delta = 0;
    if (targetEnd > end) {
      delta = targetEnd - end + pad;
    } else if (targetStart < start) {
      delta = targetStart - start - pad;
    }
    if (delta !== 0) {
      container.scrollBy({
        [axis]: delta,
        behavior: "smooth",
      });
    }
  }

  function scrollBoardToHiddenMatch() {
    const scroller = boardRef.current;
    if (!scroller || !leadQuery.trim()) {
      return;
    }
    const matches = Array.from(
      scroller.querySelectorAll<HTMLElement>(".an-kanban-card.matched"),
    );
    if (matches.length === 0) {
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const target =
      matches.find((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left > scrollerRect.right - 8 || rect.right > scrollerRect.right + 8;
      }) ?? matches[0];
    scrollElementIntoView(scroller, target, "left", 24);
    const columnCards = target.closest<HTMLElement>(".an-kanban-cards");
    if (columnCards) {
      scrollElementIntoView(columnCards, target, "top", 12);
    }
  }

  function scrollBoardWhileDragging(event: React.DragEvent<HTMLElement>) {
    const scroller = boardRef.current;
    if (!scroller) {
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const edge = 88;
    const speed = 24;
    if (event.clientX > rect.right - edge) {
      scroller.scrollLeft += speed;
    } else if (event.clientX < rect.left + edge) {
      scroller.scrollLeft -= speed;
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchKanbanBoard(boardId)
      .then((next) => {
        if (!cancelled) {
          setBoard(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBoard(null);
          setError(err instanceof Error ? err.message : "Failed to load board");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const columns = useMemo(() => {
    if (!board) {
      return [];
    }
    return board.stages.map((stage) => ({
      stage,
      people: board.people.filter(
        (person) =>
          stageIdForPerson(person, board.placements, board.stages) === stage.id,
      ),
    }));
  }, [board]);

  useEffect(() => {
    if (!leadQuery.trim()) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollBoardToHiddenMatch();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [leadQuery, columns]);

  async function persist(next: Pick<KanbanBoard, "stages" | "placements">) {
    if (!board) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await patchKanbanBoard(board.id, next);
      setBoard(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function movePerson(person: KanbanPerson, stageId: string) {
    if (!board) {
      return;
    }
    const email = person.email.trim().toLowerCase();
    const next = { ...board.placements };
    if (autoStageId(person) === stageId) {
      delete next[email];
    } else {
      next[email] = stageId;
    }
    setBoard({ ...board, placements: next });
    void persist({ stages: board.stages, placements: next });
  }

  function moveStage(fromId: string, toId: string) {
    if (!board || fromId === toId) {
      return;
    }
    const from = board.stages.findIndex((stage) => stage.id === fromId);
    const to = board.stages.findIndex((stage) => stage.id === toId);
    if (from < 0 || to < 0) {
      return;
    }
    const stages = [...board.stages];
    const [item] = stages.splice(from, 1);
    stages.splice(to, 0, item);
    setBoard({ ...board, stages });
    void persist({ stages, placements: board.placements });
  }

  function addStage() {
    const name = stageName.trim();
    if (!board || !name) {
      return;
    }
    if (board.stages.some((stage) => stage.name.toLowerCase() === name.toLowerCase())) {
      setError("That stage already exists");
      return;
    }
    const stage: KanbanStage = {
      id: `stage-${Math.random().toString(36).slice(2, 10)}`,
      name,
      color: stageColor,
    };
    const stages = [...board.stages, stage];
    setStageName("");
    setStageColor(DEFAULT_STAGE_COLOR);
    setAdding(false);
    setBoard({ ...board, stages });
    void persist({ stages, placements: board.placements });
  }

  function removeStage(stageId: string) {
    if (!board) {
      return;
    }
    const stages = board.stages.filter((stage) => stage.id !== stageId);
    const placements = { ...board.placements };
    for (const [email, id] of Object.entries(placements)) {
      if (id === stageId) {
        delete placements[email];
      }
    }
    setBoard({ ...board, stages, placements });
    void persist({ stages, placements });
  }

  const pickableCampaigns = useMemo(
    () =>
      allCampaigns
        .filter(
          (campaign) =>
            campaign.status === "sent" ||
            campaign.status === "sending" ||
            campaign.status === "paused" ||
            (campaign.delivered ?? campaign.recipients) > 0,
        )
        .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")),
    [allCampaigns],
  );

  const visibleCampaigns = useMemo(() => {
    const query = campaignQuery.trim().toLowerCase();
    if (!query) {
      return pickableCampaigns;
    }
    return pickableCampaigns.filter((campaign) => {
      const kind = campaign.kind === "oneone" ? "1-1" : "drip";
      const status =
        campaign.status === "sending"
          ? "running"
          : campaign.status === "paused"
            ? "paused"
            : "sent";
      return (
        campaign.name.toLowerCase().includes(query) ||
        kind.includes(query) ||
        status.includes(query)
      );
    });
  }, [campaignQuery, pickableCampaigns]);

  async function openCampaignEditor() {
    setEditingCampaigns(true);
    setCampaignQuery("");
    setChatOpen(false);
    if (board) {
      setPickedCampaigns(
        board.campaigns.map(
          (campaign) => `${campaign.kind}:${campaign.campaignId}`,
        ),
      );
    }
    if (allCampaigns.length > 0) {
      return;
    }
    try {
      const [drip, oneone] = await Promise.all([
        fetchDripCampaigns("drip"),
        fetchDripCampaigns("oneone"),
      ]);
      setAllCampaigns([...drip, ...oneone]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    }
  }

  async function saveCampaigns() {
    if (!board || pickedCampaigns.length === 0 || savingCampaigns) {
      return;
    }
    const campaigns: KanbanCampaignRef[] = pickableCampaigns
      .filter((campaign) => pickedCampaigns.includes(campaignKey(campaign)))
      .map((campaign) => ({
        campaignId: campaign.id,
        kind: campaign.kind === "oneone" ? "oneone" : "drip",
        name: campaign.name,
      }));
    if (campaigns.length === 0) {
      setError("Select at least one campaign");
      return;
    }
    setSavingCampaigns(true);
    setError("");
    try {
      const saved = await patchKanbanBoard(board.id, { campaigns });
      setBoard(saved);
      setEditingCampaigns(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaigns");
    } finally {
      setSavingCampaigns(false);
    }
  }

  async function sendChat() {
    const message = chatDraft.trim();
    if (!board || !message || chatBusy) {
      return;
    }
    const next = [...chat, { role: "user" as const, content: message }];
    setChat(next);
    setChatDraft("");
    setChatBusy(true);
    setChatError("");
    try {
      const result = await chatKanbanBoard(board.id, {
        message,
        history: next.slice(0, -1),
      });
      setBoard(result.board);
      setChat([...next, { role: "assistant", content: result.reply }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to chat");
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="an-page an-kanban-page">
      <div className="an-kanban-head">
        <div className="an-kanban-title">
          <Link
            href={PORTAL_ROUTES["analytics-kanban"]}
            className="cd-back"
            aria-label="Back to kanban lists"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <h2>{board?.name || "Kanban"}</h2>
        </div>
        {board ? (
          <div className="an-kanban-head-actions-top">
            <button
              type="button"
              className="btn-dark"
              onClick={() => {
                setChatOpen(true);
                setEditingCampaigns(false);
              }}
            >
              Chat
            </button>
            <button
              type="button"
              className="btn-soft"
              onClick={() => void openCampaignEditor()}
            >
              Campaigns
            </button>
          </div>
        ) : null}
      </div>

      {board ? (
        <div className="drip-toolbar an-kanban-toolbar-search">
          <label className="drip-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={leadQuery}
              onChange={(event) => setLeadQuery(event.target.value)}
              placeholder="Search a lead by name or email…"
            />
          </label>
        </div>
      ) : null}

      {error ? <div className="an-error">{error}</div> : null}
      {loading && !board ? <div className="an-empty">Loading board…</div> : null}

      {board && editingCampaigns ? (
        <div className="an-kanban-campaigns">
          <div className="an-kanban-campaigns-top">
            <strong>Edit campaigns</strong>
            <span>Add or remove sent and running campaigns on this board.</span>
          </div>
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
                      checked={pickedCampaigns.includes(key)}
                      onChange={() =>
                        setPickedCampaigns((current) =>
                          current.includes(key)
                            ? current.filter((item) => item !== key)
                            : [...current, key],
                        )
                      }
                    />
                    <strong>{campaign.name}</strong>
                    <em>
                      {campaign.kind === "oneone" ? "1-1" : "Drip"} ·{" "}
                      {campaign.status === "sending" ? "Running" : campaign.status === "paused" ? "Paused" : "Sent"}
                    </em>
                  </label>
                );
              })}
            </div>
          )}
          <div className="an-kanban-add-actions">
            <button
              type="button"
              className="btn-link-purple"
              onClick={() => setEditingCampaigns(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-dark"
              disabled={savingCampaigns || pickedCampaigns.length === 0}
              onClick={() => void saveCampaigns()}
            >
              {savingCampaigns ? "Saving…" : "Save campaigns"}
            </button>
          </div>
        </div>
      ) : null}

      {board ? (
        <div className="an-kanban">
          <div
            ref={boardRef}
            className="an-kanban-board"
            onDragOver={(event) => {
              event.preventDefault();
              scrollBoardWhileDragging(event);
            }}
          >
            {columns.map(({ stage, people }) => (
              <section
                key={stage.id}
                className={`an-kanban-col${draggingPerson ? " droppable" : ""}${
                  draggingStage === stage.id ? " dragging-stage" : ""
                }${draggingStage && draggingStage !== stage.id ? " stage-target" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  scrollBoardWhileDragging(event);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingStage) {
                    moveStage(draggingStage, stage.id);
                    setDraggingStage("");
                    return;
                  }
                  const email = event.dataTransfer.getData("text/plain");
                  const person = board.people.find(
                    (item) => item.email.trim().toLowerCase() === email,
                  );
                  if (person) {
                    movePerson(person, stage.id);
                  }
                  setDraggingPerson("");
                }}
              >
                <header className="an-kanban-col-head">
                  <i
                    className="an-kanban-dot"
                    style={{ background: stageDotColor(stage) }}
                  />
                  <h3>{stageLabel(stage.name)}</h3>
                  <em>{people.length}</em>
                  <span className="an-kanban-head-actions">
                    <button
                      type="button"
                      className="an-kanban-grip-btn"
                      draggable
                      aria-label={`Move ${stage.name}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/stage", stage.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingStage(stage.id);
                      }}
                      onDragEnd={() => setDraggingStage("")}
                    >
                      <StageGrip />
                    </button>
                    {!stage.system ? (
                      <button
                        type="button"
                        className="an-kanban-remove"
                        onClick={() => removeStage(stage.id)}
                        aria-label={`Remove ${stage.name}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                </header>
                <div className="an-kanban-cards">
                  {people.map((person) => {
                    const email = person.email.trim().toLowerCase();
                    const name = displayName(person);
                    const query = leadQuery.trim().toLowerCase();
                    const matched =
                      query.length > 0 &&
                      (name.toLowerCase().includes(query) ||
                        email.includes(query));
                    return (
                      <article
                        key={person.id}
                        className={`an-kanban-card${draggingPerson === email ? " dragging" : ""}${
                          matched ? " matched" : ""
                        }`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", email);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingPerson(email);
                        }}
                        onDragEnd={() => setDraggingPerson("")}
                      >
                        <span className="an-kanban-avatar" aria-hidden>
                          {cardInitials(name, email)}
                        </span>
                        <span className="an-kanban-card-copy">
                          {person.contactId ? (
                            <Link
                              className="an-kanban-card-name"
                              href={portalContactRoute(
                                person.contactId,
                                portalKanbanRoute(board.id),
                              )}
                            >
                              {name}
                            </Link>
                          ) : (
                            <strong className="an-kanban-card-name">{name}</strong>
                          )}
                          {name.toLowerCase() !== email ? (
                            <em className="an-kanban-card-email">{person.email}</em>
                          ) : null}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            {adding ? (
              <form
                className="an-kanban-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  addStage();
                }}
              >
                <input
                  value={stageName}
                  onChange={(event) => setStageName(event.target.value)}
                  placeholder="Stage name"
                  autoFocus
                  disabled={saving}
                />
                <div className="an-kanban-colors" role="radiogroup" aria-label="Stage color">
                  {KANBAN_DOT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={stageColor === color}
                      className={`an-kanban-color${stageColor === color ? " selected" : ""}`}
                      style={{ background: color }}
                      onClick={() => setStageColor(color)}
                      aria-label={`Use ${color}`}
                    />
                  ))}
                </div>
                <div className="an-kanban-add-actions">
                  <button
                    type="button"
                    className="btn-link-purple"
                    onClick={() => {
                      setAdding(false);
                      setStageName("");
                      setStageColor(DEFAULT_STAGE_COLOR);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-dark"
                    disabled={saving || !stageName.trim()}
                  >
                    Add
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="an-kanban-add-btn"
                onClick={() => setAdding(true)}
                aria-label="Add stage"
              >
                +
              </button>
            )}
          </div>
        </div>
      ) : null}

      {chatOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => setChatOpen(false)}
        >
          <div
            className="an-kanban-chat-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="an-kanban-chat-head">
              <span className="an-kanban-chat-mark" aria-hidden />
              <div>
                <h3>Board assistant</h3>
                <p>Move leads or add a stage.</p>
              </div>
              <button
                type="button"
                className="an-kanban-chat-x"
                aria-label="Close chat"
                onClick={() => setChatOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="an-kanban-chat-body">
              <div className="an-kanban-chat-thread">
                {chat.length === 0 ? (
                  <div className="an-kanban-chat-empty">
                    <p>Ask the board to move a lead or create a stage.</p>
                    <div className="an-kanban-chat-chips">
                      {[
                        "Create stage Meeting",
                        "Move everyone in Prospect to Engage",
                      ].map((hint) => (
                        <button
                          key={hint}
                          type="button"
                          className="an-kanban-chat-chip"
                          onClick={() => setChatDraft(hint)}
                        >
                          {hint}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.map((turn, index) => (
                    <div
                      key={`${turn.role}-${index}`}
                      className={`an-kanban-chat-row ${turn.role}`}
                    >
                      {turn.role === "assistant" ? (
                        <span className="an-kanban-chat-mark sm" aria-hidden />
                      ) : null}
                      <div className={`an-kanban-chat-bubble ${turn.role}`}>
                        {turn.content}
                      </div>
                    </div>
                  ))
                )}
                {chatBusy ? (
                  <div className="an-kanban-chat-row assistant">
                    <span className="an-kanban-chat-mark sm" aria-hidden />
                    <div className="an-kanban-chat-bubble assistant thinking">
                      <i /><i /><i />
                    </div>
                  </div>
                ) : null}
              </div>
              {chatError ? <p className="an-kanban-chat-error">{chatError}</p> : null}
              <form
                className="an-kanban-chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat();
                }}
              >
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendChat();
                    }
                  }}
                  placeholder="Write a message… Enter to send"
                  disabled={chatBusy}
                  rows={2}
                />
                <button
                  type="submit"
                  className="an-kanban-chat-send"
                  disabled={chatBusy || !chatDraft.trim()}
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
