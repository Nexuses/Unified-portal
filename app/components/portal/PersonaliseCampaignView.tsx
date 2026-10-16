"use client";

import { useEffect, useMemo, useState } from "react";
import { SmtpProviderBadge } from "@/app/components/portal/SmtpProviderBadge";
import SmtpSenderSelect, { type SmtpSenderOption } from "@/app/components/portal/SmtpSenderSelect";
import { formatTimezoneLabel, listCampaignTimezones } from "@/lib/campaign-timezones";
import { patchDripCampaign, type DripCampaign } from "@/lib/drip-campaigns";
import type { SmtpProviderId } from "@/lib/smtp-senders";
import type {
  PersonaliseCampaignSnapshot,
  PersonaliseSentContact,
  PersonaliseSentStep,
} from "@/lib/personalise-types";

function personName(contact: PersonaliseSentContact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;
}

function initials(contact: PersonaliseSentContact) {
  const letters = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .map((part) => part.trim().charAt(0).toUpperCase())
    .join("");
  return letters.slice(0, 2) || contact.email.charAt(0).toUpperCase() || "?";
}

function formatWhen(iso?: string) {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepStatus(step: PersonaliseSentStep): { label: string; tone: string } {
  if (step.status === "sent") {
    return { label: `Sent ${formatWhen(step.sentAt)}`.trim(), tone: "sent" };
  }
  if (step.status === "failed") {
    if (step.error === "Replied") {
      return { label: "Stopped · replied", tone: "stopped" };
    }
    if (step.error === "Unsubscribed" || step.error === "Suppressed") {
      return { label: "Stopped · unsubscribed", tone: "stopped" };
    }
    return { label: step.error ? `Failed · ${step.error}` : "Failed", tone: "failed" };
  }
  if (step.status === "sending") {
    return { label: "Sending", tone: "pending" };
  }
  if (step.availableAt) {
    return { label: `Due ${formatWhen(step.availableAt)}`, tone: "pending" };
  }
  return { label: "Waiting for previous email", tone: "pending" };
}

function windowLabel(snapshot: PersonaliseCampaignSnapshot) {
  if (!snapshot.windowStart || !snapshot.windowEnd) {
    return "Any time";
  }
  return `${snapshot.windowStart} – ${snapshot.windowEnd}`;
}

function senderLabel(email: string) {
  const local = email.split("@")[0] ?? "";
  const name = local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
  return name || email;
}

export default function PersonaliseCampaignView({
  campaignId,
  editable = false,
  onBack,
  onSaved,
}: {
  campaignId: string;
  editable?: boolean;
  onBack: () => void;
  onSaved?: (campaign: DripCampaign) => void;
}) {
  const [snapshot, setSnapshot] = useState<PersonaliseCampaignSnapshot | null>(null);
  const [error, setError] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [senders, setSenders] = useState<SmtpSenderOption[]>([]);
  const [listName, setListName] = useState("");
  const [senderId, setSenderId] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [emailGapMinutes, setEmailGapMinutes] = useState(5);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const timezones = useMemo(() => listCampaignTimezones(timezone), [timezone]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/personalise/${encodeURIComponent(campaignId)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as PersonaliseCampaignSnapshot & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Could not load the campaign.");
        }
        if (!cancelled) {
          setSnapshot(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the campaign.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    setListName(snapshot.listName || snapshot.name);
    setWindowStart(snapshot.windowStart || "09:00");
    setWindowEnd(snapshot.windowEnd || "18:00");
    setTimezone(snapshot.timezone || "Asia/Kolkata");
    setEmailGapMinutes(snapshot.emailGapMinutes);
  }, [snapshot]);

  useEffect(() => {
    if (!editable) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/smtp/senders");
        const data = (await response.json()) as SmtpSenderOption[] | { error?: string };
        if (!response.ok || !Array.isArray(data) || cancelled) {
          return;
        }
        setSenders(data);
      } catch {
        // The sender field stays empty until the list loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editable]);

  useEffect(() => {
    if (!snapshot || senders.length === 0) {
      return;
    }
    setSenderId((current) => {
      if (current && senders.some((sender) => sender.id === current)) {
        return current;
      }
      const match =
        senders.find((sender) => sender.id === snapshot.senderId) ??
        senders.find(
          (sender) => sender.fromEmail.toLowerCase() === snapshot.senderEmail.toLowerCase(),
        );
      return match?.id ?? "";
    });
  }, [snapshot, senders]);

  async function saveSetup() {
    if (!editable || saving) {
      return;
    }
    const name = listName.trim();
    const sender = senders.find((item) => item.id === senderId);
    if (!name) {
      setSaveError("Add a list name.");
      return;
    }
    if (!sender) {
      setSaveError("Select a sender.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(windowStart) || !/^\d{2}:\d{2}$/.test(windowEnd)) {
      setSaveError("Sending hours need a start and stop time.");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSavedNote("");
    try {
      const updated = await patchDripCampaign(
        campaignId,
        {
          name: name || undefined,
          listName: name || undefined,
          senderId: sender.id,
          senderEmail: sender.fromEmail,
          senderName: senderLabel(sender.fromEmail),
          windowStart,
          windowEnd,
          emailGapMinutes,
          timezone,
          timezoneEnabled: true,
        },
        "oneone",
      );
      onSaved?.(updated);
      setSavedNote("Saved. The campaign stays paused until you resume it.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save the setup.");
    } finally {
      setSaving(false);
    }
  }

  const totalEmails = snapshot
    ? snapshot.contacts.reduce((sum, contact) => sum + contact.steps.length, 0)
    : 0;

  return (
    <div className="drip-detail-page">
      <div className="drip-detail-head">
        <div className="drip-detail-title-wrap">
          <button type="button" className="drip-back" aria-label="Back to report" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h2>{snapshot?.name ?? "Campaign setup"}</h2>
        </div>
        <div className="drip-detail-actions">
          {editable ? (
            <button type="button" className="btn-dark" disabled={saving || !snapshot} onClick={() => void saveSetup()}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          ) : null}
          <button type="button" className="btn-soft" onClick={onBack}>
            Back to report
          </button>
        </div>
      </div>

      <div className="personalise-create">
        {error ? <p className="crm-error">{error}</p> : null}
        {!snapshot && !error ? <p className="personalise-lead">Loading campaign…</p> : null}

        {snapshot ? (
          <div className="personalise-setup">
            <div className="personalise-setup-head">
              <div className="pz-file">
                <span className="pz-file-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 3v5h5" />
                  </svg>
                </span>
                <div>
                  <strong>{snapshot.listName || snapshot.name}</strong>
                  <span>
                    {snapshot.contacts.length.toLocaleString()}{" "}
                    {snapshot.contacts.length === 1 ? "contact" : "contacts"} ·{" "}
                    {totalEmails.toLocaleString()} emails
                  </span>
                </div>
              </div>
            </div>

            <div className="pz-card">
              <h3 className="pz-card-title">Campaign setup</h3>
              {editable ? (
                <>
                  <div className="personalise-fields">
                    <div className="crm-field">
                      <label htmlFor="personalise-edit-list">List name</label>
                      <input
                        id="personalise-edit-list"
                        value={listName}
                        onChange={(event) => setListName(event.target.value)}
                      />
                    </div>
                    <div className="crm-field">
                      <label id="personalise-edit-sender-label">Sender</label>
                      <SmtpSenderSelect
                        id="personalise-edit-sender"
                        labelledBy="personalise-edit-sender-label"
                        className="pz-sender-select"
                        senders={senders}
                        value={senderId}
                        onChange={setSenderId}
                        placeholder="No sender yet"
                      />
                    </div>
                    <div className="crm-field">
                      <label htmlFor="personalise-edit-start">Start sending</label>
                      <input
                        id="personalise-edit-start"
                        type="time"
                        value={windowStart}
                        onChange={(event) => setWindowStart(event.target.value)}
                      />
                    </div>
                    <div className="crm-field">
                      <label htmlFor="personalise-edit-end">Stop sending</label>
                      <input
                        id="personalise-edit-end"
                        type="time"
                        value={windowEnd}
                        onChange={(event) => setWindowEnd(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="personalise-fields personalise-fields-extra">
                    <div className="crm-field">
                      <label htmlFor="personalise-edit-timezone">Time zone</label>
                      <select
                        id="personalise-edit-timezone"
                        className="pz-timezone-select"
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                      >
                        {timezones.map((zone) => (
                          <option key={zone} value={zone}>
                            {formatTimezoneLabel(zone)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="crm-field">
                      <label htmlFor="personalise-edit-gap">Gap (minutes)</label>
                      <input
                        id="personalise-edit-gap"
                        type="number"
                        min={0}
                        max={1440}
                        value={emailGapMinutes}
                        onChange={(event) =>
                          setEmailGapMinutes(Math.max(0, Math.min(1440, Number(event.target.value) || 0)))
                        }
                      />
                    </div>
                  </div>
                  <p className="personalise-hint">
                    Changes apply to emails that have not been sent yet. Resume the campaign from the
                    report when you want sending to continue.
                  </p>
                  {saveError ? <p className="crm-error">{saveError}</p> : null}
                  {savedNote ? <p className="personalise-hint">{savedNote}</p> : null}
                </>
              ) : (
                <dl className="pz-setup-summary">
                  <div>
                    <dt>List name</dt>
                    <dd>{snapshot.listName || "—"}</dd>
                  </div>
                  <div>
                    <dt>Sender</dt>
                    <dd className="pz-setup-sender">
                      <SmtpProviderBadge
                        iconOnly
                        providerId={(snapshot.senderProvider || undefined) as SmtpProviderId | undefined}
                      />
                      <span>{snapshot.senderEmail || "—"}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Sending hours</dt>
                    <dd>{windowLabel(snapshot)}</dd>
                  </div>
                  <div>
                    <dt>Gap (minutes)</dt>
                    <dd>{snapshot.emailGapMinutes}</dd>
                  </div>
                  {snapshot.scheduledFor ? (
                    <div>
                      <dt>Scheduled for</dt>
                      <dd>{formatWhen(snapshot.scheduledFor)}</dd>
                    </div>
                  ) : null}
                </dl>
              )}
            </div>

            <div className="pz-contacts">
              {snapshot.contacts.map((contact, index) => {
                const open = openIndex === index;
                const meta = [contact.position, contact.companyName].filter(Boolean).join(" · ");
                const sent = contact.steps.filter((step) => step.status === "sent").length;
                return (
                  <section
                    key={contact.email}
                    className={`pz-contact${open ? " is-open" : ""}`}
                  >
                    <div
                      className="pz-contact-head"
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setOpenIndex(open ? null : index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setOpenIndex(open ? null : index);
                        }
                      }}
                    >
                      <span className="pz-avatar" aria-hidden="true">
                        {initials(contact)}
                      </span>
                      <div className="pz-contact-id">
                        <strong>{personName(contact)}</strong>
                        <span>{meta || contact.email}</span>
                      </div>
                      {contact.personalLinkedIn ? (
                        <a
                          className="pz-chip pz-chip-link"
                          href={contact.personalLinkedIn}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          LinkedIn
                        </a>
                      ) : null}
                      <span className="pz-contact-email">{contact.email}</span>
                      {contact.repliedAt ? <span className="pz-chip pz-chip-ok">Replied</span> : null}
                      {contact.unsubscribedAt ? (
                        <span className="pz-chip pz-chip-danger">Unsubscribed</span>
                      ) : null}
                      <span className="pz-chip">
                        {sent}/{contact.steps.length} sent
                      </span>
                      <svg
                        className="pz-chevron"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>

                    {open ? (
                      <ol className="pz-steps">
                        {contact.steps.map((step, stepIndex) => {
                          const status = stepStatus(step);
                          return (
                            <li key={stepIndex} className="pz-step">
                              <span className="pz-step-dot" aria-hidden="true">
                                {stepIndex + 1}
                              </span>
                              <div className="pz-step-card">
                                <div className="pz-step-head">
                                  <strong>
                                    {stepIndex === 0 ? "First email" : `Follow-up ${stepIndex}`}
                                  </strong>
                                  {stepIndex > 0 ? (
                                    <>
                                      <span className="pz-chip">
                                        Day {step.day} · {step.day}{" "}
                                        {step.day === 1 ? "day" : "days"} after email 1
                                      </span>
                                      <span className="pz-chip pz-chip-soft">
                                        {step.delayDays} {step.delayDays === 1 ? "day" : "days"} after
                                        email {stepIndex}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="pz-chip">Day 0 · Sent first</span>
                                  )}
                                  <span className={`pz-chip pz-status-${status.tone}`}>
                                    {status.label}
                                  </span>
                                </div>
                                <div className="pz-subject">
                                  {step.subject ? (
                                    <>
                                      <span>Subject</span>
                                      <strong>{step.subject}</strong>
                                    </>
                                  ) : (
                                    <span className="pz-thread">Reply in the same thread</span>
                                  )}
                                </div>
                                <div
                                  className="pz-pitch pz-pitch-html"
                                  dangerouslySetInnerHTML={{ __html: step.html }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
