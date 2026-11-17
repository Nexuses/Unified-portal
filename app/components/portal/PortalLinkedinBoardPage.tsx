"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import LinkedinMachineWindow from "@/app/components/portal/LinkedinMachineWindow";
import { DEFAULT_STAGE_COLOR, KANBAN_DOT_COLORS } from "@/lib/analytics-kanban";
import {
  addLinkedinStage,
  fetchLinkedinCampaign,
  moveLinkedinContact,
  setLinkedinCampaignPaused,
  type LinkedinCampaignDetail,
} from "@/lib/linkedin-campaigns";
import { PORTAL_ROUTES, portalContactRoute } from "@/lib/portal-nav";

export default function PortalLinkedinBoardPage({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<LinkedinCampaignDetail | null>(null);
  const [error, setError] = useState("");
  const [desktopUrl, setDesktopUrl] = useState("");
  const [desktopError, setDesktopError] = useState("");
  const [openingDesktop, setOpeningDesktop] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState<string>(DEFAULT_STAGE_COLOR);
  const [addingStage, setAddingStage] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const moving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (moving.current) return;
      try {
        const next = await fetchLinkedinCampaign(campaignId);
        if (!cancelled && !moving.current) setCampaign(next);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the campaign");
        }
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [campaignId]);

  async function openVirtualMachine() {
    setOpeningDesktop(true);
    setDesktopError("");
    try {
      const response = await fetch("/api/linkedin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "watch" }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        desktopUrl?: string;
      } | null;
      if (!response.ok || !data?.desktopUrl) {
        throw new Error(data?.error || "Could not open the virtual machine");
      }
      setDesktopUrl(data.desktopUrl);
    } catch (openError) {
      setDesktopError(
        openError instanceof Error ? openError.message : "Could not open the virtual machine",
      );
    } finally {
      setOpeningDesktop(false);
    }
  }

  async function addStage() {
    const label = stageName.trim();
    if (!label) return;
    setStageBusy(true);
    setStageError("");
    try {
      const next = await addLinkedinStage(campaignId, label, stageColor);
      setCampaign(next);
      setStageName("");
      setStageColor(DEFAULT_STAGE_COLOR);
      setAddingStage(false);
    } catch (addError) {
      setStageError(addError instanceof Error ? addError.message : "Could not add the stage");
    } finally {
      setStageBusy(false);
    }
  }

  async function dropContact(contactId: string, stage: string) {
    if (!campaign || !contactId) return;
    const contact = campaign.contacts.find((item) => item.id === contactId);
    if (!contact || contact.stage === stage) return;
    const previous = campaign;
    moving.current = true;
    setCampaign({
      ...campaign,
      contacts: campaign.contacts.map((item) =>
        item.id === contactId ? { ...item, stage } : item,
      ),
    });
    setStageError("");
    try {
      const next = await moveLinkedinContact(campaignId, contactId, stage);
      setCampaign(next);
    } catch (moveError) {
      setCampaign(previous);
      setStageError(moveError instanceof Error ? moveError.message : "Could not move the contact");
    } finally {
      moving.current = false;
    }
  }

  if (error) {
    return <p className="crm-error">{error}</p>;
  }
  if (!campaign) {
    return <div className="drip-empty">Loading campaign...</div>;
  }

  return (
    <div className="an-kanban li-board">
      <div className="crm-page-head drip-page-head li-board-head">
        <div className="li-board-title">
          <Link href={PORTAL_ROUTES.linkedin} className="drip-back" aria-label="Back to campaigns">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <h2>{campaign.name}</h2>
        </div>
        <div className="li-board-actions">
          <button
            type="button"
            className="btn-soft"
            disabled={pausing}
            onClick={() => {
              if (!campaign) return;
              const nextPaused = campaign.status !== "paused";
              setPausing(true);
              setStageError("");
              void setLinkedinCampaignPaused(campaign.id, nextPaused)
                .then((next) => setCampaign(next))
                .catch((pauseError) => {
                  setStageError(pauseError instanceof Error ? pauseError.message : "Could not update the campaign");
                })
                .finally(() => setPausing(false));
            }}
          >
            {pausing ? "Saving…" : campaign.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="btn-dark li-board-vm"
            disabled={openingDesktop}
            onClick={() => void openVirtualMachine()}
          >
            {openingDesktop ? "Opening…" : "View virtual machine"}
          </button>
        </div>
      </div>
      {desktopError ? <p className="crm-error li-board-vm-error">{desktopError}</p> : null}
      {stageError ? <p className="crm-error li-board-vm-error">{stageError}</p> : null}
      {campaign.status === "paused" ? (
        <p className="li-board-sending">This campaign is paused. Nothing is sent until you resume it.</p>
      ) : campaign.status === "complete" ? (
        <p className="li-board-sending">
          All messages are sent. This campaign is complete and still checks for replies.
        </p>
      ) : campaign.sending ? (
        <p className="li-board-sending">Checking LinkedIn and sending the messages that are due.</p>
      ) : campaign.contacts.some((contact) => contact.stage === "request_sent") ? (
        <p className="li-board-sending">
          Connection requests stay here until the person accepts or rejects. Accepted people get their messages after the delay.
        </p>
      ) : null}
      <div className="li-board-metrics">
        <div className="li-board-metric">
          <span>Total contacts</span>
          <strong>{campaign.peopleCount}</strong>
        </div>
        <div className="li-board-metric">
          <span>Connection requests sent</span>
          <strong>{campaign.requestsSent}</strong>
        </div>
        <div className="li-board-metric">
          <span>Messages sent</span>
          <strong>{campaign.messagesSent}</strong>
        </div>
        <div className="li-board-metric">
          <span>Replies</span>
          <strong>{campaign.replyCount}</strong>
        </div>
      </div>
      <div
        className="an-kanban-board"
        onDragOver={(event) => event.preventDefault()}
      >
        {campaign.columns.map((column) => {
          const contacts = campaign.contacts.filter((contact) => contact.stage === column.id);
          return (
            <section
              className={`an-kanban-col${draggingId ? " droppable" : ""}`}
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const contactId = event.dataTransfer.getData("text/plain") || draggingId;
                setDraggingId("");
                void dropContact(contactId, column.id);
              }}
            >
              <header className="an-kanban-col-head">
                <i className="an-kanban-dot" style={{ background: column.color }} />
                <h3>{column.label}</h3>
                <em>{contacts.length}</em>
              </header>
              <div className="an-kanban-cards">
                {contacts.map((contact) => (
                  <article
                    className={`an-kanban-card${draggingId === contact.id ? " dragging" : ""}`}
                    key={contact.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", contact.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDraggingId(contact.id);
                    }}
                    onDragEnd={() => setDraggingId("")}
                  >
                    <span className="an-kanban-card-copy">
                      {contact.crmContactId ? (
                        <Link
                          className="an-kanban-card-name is-link"
                          href={portalContactRoute(contact.crmContactId)}
                          draggable={false}
                        >
                          {contact.name}
                        </Link>
                      ) : (
                        <span className="an-kanban-card-name">{contact.name}</span>
                      )}
                      <a
                        className="li-board-logo"
                        href={contact.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        draggable={false}
                        aria-label={`${contact.name} on LinkedIn`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="#0A66C2"
                            d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.11 20.45H3.56V9h3.55v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.73V1.73C24 .77 23.21 0 22.23 0z"
                          />
                        </svg>
                      </a>
                      {contact.note ? <span className="li-board-note">{contact.note}</span> : null}
                      {contact.message ? <span className="li-board-note">{contact.message}</span> : null}
                      {column.id === "reply" ? (
                        <span className="li-board-note">They replied.</span>
                      ) : null}
                      {column.id === "connection_rejected" && !contact.note ? (
                        <span className="li-board-note">They rejected the connection request.</span>
                      ) : null}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
        {addingStage ? (
          <form
            className="an-kanban-add"
            onSubmit={(event) => {
              event.preventDefault();
              void addStage();
            }}
          >
            <input
              value={stageName}
              onChange={(event) => setStageName(event.target.value)}
              placeholder="Stage name"
              aria-label="New stage name"
              maxLength={40}
              autoFocus
              disabled={stageBusy}
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
                  setAddingStage(false);
                  setStageName("");
                  setStageColor(DEFAULT_STAGE_COLOR);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn-dark" disabled={stageBusy || !stageName.trim()}>
                {stageBusy ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="an-kanban-add-btn"
            onClick={() => setAddingStage(true)}
            aria-label="Add stage"
          >
            +
          </button>
        )}
      </div>
      {desktopUrl ? (
        <LinkedinMachineWindow desktopUrl={desktopUrl} onClose={() => setDesktopUrl("")} />
      ) : null}
    </div>
  );
}
