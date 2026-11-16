"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LinkedinMachineWindow from "@/app/components/portal/LinkedinMachineWindow";
import {
  addLinkedinStage,
  fetchLinkedinCampaign,
  moveLinkedinContact,
  type LinkedinCampaignDetail,
} from "@/lib/linkedin-campaigns";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

export default function PortalLinkedinBoardPage({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<LinkedinCampaignDetail | null>(null);
  const [error, setError] = useState("");
  const [desktopUrl, setDesktopUrl] = useState("");
  const [desktopError, setDesktopError] = useState("");
  const [openingDesktop, setOpeningDesktop] = useState(false);
  const [stageName, setStageName] = useState("");
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchLinkedinCampaign(campaignId);
        if (!cancelled) setCampaign(next);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the campaign");
        }
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
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
      const next = await addLinkedinStage(campaignId, label);
      setCampaign(next);
      setStageName("");
    } catch (addError) {
      setStageError(addError instanceof Error ? addError.message : "Could not add the stage");
    } finally {
      setStageBusy(false);
    }
  }

  async function moveContact(contactId: string, stage: string) {
    setStageError("");
    try {
      const next = await moveLinkedinContact(campaignId, contactId, stage);
      setCampaign(next);
    } catch (moveError) {
      setStageError(moveError instanceof Error ? moveError.message : "Could not move the contact");
    }
  }

  if (error) {
    return <p className="crm-error">{error}</p>;
  }
  if (!campaign) {
    return <div className="drip-empty">Loading campaign...</div>;
  }

  return (
    <div className="an-kanban">
      <div className="crm-page-head drip-page-head li-board-head">
        <div>
          <Link href={PORTAL_ROUTES.linkedin} className="li-board-back">
            LinkedIn Automation
          </Link>
          <h2>{campaign.name}</h2>
        </div>
        <div className="li-board-actions">
          <form
            className="li-board-stage"
            onSubmit={(event) => {
              event.preventDefault();
              void addStage();
            }}
          >
            <input
              value={stageName}
              onChange={(event) => setStageName(event.target.value)}
              placeholder="New stage"
              aria-label="New stage name"
              maxLength={40}
            />
            <button type="submit" className="btn-soft" disabled={stageBusy || !stageName.trim()}>
              {stageBusy ? "Adding…" : "Add stage"}
            </button>
          </form>
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
      {campaign.status === "complete" ? (
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
      <div className="an-kanban-board">
        {campaign.columns.map((column) => {
          const contacts = campaign.contacts.filter((contact) => contact.stage === column.id);
          return (
            <section className="an-kanban-col" key={column.id}>
              <header className="an-kanban-col-head">
                <i className="an-kanban-dot" style={{ background: column.color }} />
                <h3>{column.label}</h3>
                <em>{contacts.length}</em>
              </header>
              <div className="an-kanban-cards">
                {contacts.map((contact) => (
                  <article className="an-kanban-card" key={contact.id}>
                    <span className="an-kanban-card-copy">
                      <span className="an-kanban-card-name">{contact.name}</span>
                      <a
                        className="li-board-link"
                        href={contact.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        LinkedIn
                      </a>
                      {contact.note ? <span className="li-board-note">{contact.note}</span> : null}
                      {contact.message ? <span className="li-board-note">{contact.message}</span> : null}
                      {column.id === "reply" ? (
                        <span className="li-board-note">They replied.</span>
                      ) : null}
                      {column.id === "connection_rejected" && !contact.note ? (
                        <span className="li-board-note">They rejected the connection request.</span>
                      ) : null}
                      <select
                        className="li-card-move"
                        aria-label={`Move ${contact.name}`}
                        value={contact.stage}
                        onChange={(event) => void moveContact(contact.id, event.target.value)}
                      >
                        {campaign.columns.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </span>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {desktopUrl ? (
        <LinkedinMachineWindow desktopUrl={desktopUrl} onClose={() => setDesktopUrl("")} />
      ) : null}
    </div>
  );
}
