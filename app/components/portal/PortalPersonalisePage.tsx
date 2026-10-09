"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  contactNeedsEmail,
  pitchBlocks,
  stepDelayDays,
  type PitchInline,
  type PersonaliseContact,
  type PersonalisePlan,
} from "@/lib/personalise-types";
import SmtpSenderSelect from "@/app/components/portal/SmtpSenderSelect";
import CampaignScheduleDrawer, {
  type CampaignScheduleInput,
} from "@/app/components/portal/CampaignScheduleDrawer";

type SenderOption = {
  id: string;
  provider: string;
  providerName: string;
  fromEmail: string;
};

type RolloutResult = {
  campaignId: string;
};

function personName(contact: PersonaliseContact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function initials(contact: PersonaliseContact) {
  const letters = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .map((part) => part.trim().charAt(0).toUpperCase())
    .join("");
  return letters.slice(0, 2) || "?";
}

function Inline({ parts }: { parts: PitchInline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.bold ? <strong key={index}>{part.text}</strong> : <Fragment key={index}>{part.text}</Fragment>,
      )}
    </>
  );
}

function PitchPreview({ body }: { body: string }) {
  const blocks = useMemo(() => pitchBlocks(body), [body]);
  return (
    <div className="pz-pitch">
      {blocks.map((block, index) => {
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.label ? <strong>{item.label}:</strong> : null}
                  {item.label ? " " : null}
                  <Inline parts={item.text} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "signoff") {
          return (
            <p key={index} className="pz-signoff">
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  {line}
                </Fragment>
              ))}
            </p>
          );
        }
        return (
          <p key={index}>
            <Inline parts={block.text} />
          </p>
        );
      })}
    </div>
  );
}

export default function PortalPersonalisePage({
  onCreated,
}: {
  onCreated: (campaignId: string) => void;
}) {
  const [plan, setPlan] = useState<PersonalisePlan | null>(null);
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [senderId, setSenderId] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [emailGapMinutes, setEmailGapMinutes] = useState(5);
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [busy, setBusy] = useState<"extract" | "rollout" | null>(null);
  const [error, setError] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [suppressed, setSuppressed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/smtp/senders");
        const data = (await response.json()) as SenderOption[] | { error?: string };
        if (!response.ok || !Array.isArray(data)) {
          return;
        }
        const allowed = data.filter(
          (sender) => sender.provider === "gmail" || sender.provider === "outlook",
        );
        if (!cancelled) {
          setSenders(allowed);
          setSenderId((current) => current || allowed[0]?.id || "");
        }
      } catch {
        // The rollout form shows an empty sender list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const missingEmails = useMemo(
    () => (plan ? plan.contacts.filter(contactNeedsEmail).length : 0),
    [plan],
  );

  const emailKey = useMemo(
    () =>
      plan
        ? plan.contacts
            .map((contact) => contact.email.trim().toLowerCase())
            .filter((email) => email.includes("@"))
            .join("\n")
        : "",
    [plan],
  );

  useEffect(() => {
    if (!emailKey) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/personalise/suppressed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: emailKey.split("\n") }),
        });
        const data = (await response.json()) as { suppressed?: string[] };
        if (!cancelled && response.ok) {
          setSuppressed(new Set(data.suppressed ?? []));
        }
      } catch {
        // Rollout skips unsubscribed contacts on the server as well.
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [emailKey]);

  function isUnsubscribed(contact: PersonaliseContact) {
    return suppressed.has(contact.email.trim().toLowerCase());
  }

  const unsubscribedCount = plan ? plan.contacts.filter(isUnsubscribed).length : 0;

  function removeContacts(shouldRemove: (contact: PersonaliseContact, index: number) => boolean) {
    setPlan((current) =>
      current
        ? {
            ...current,
            contacts: current.contacts.filter((contact, index) => !shouldRemove(contact, index)),
          }
        : current,
    );
    setOpenIndex(null);
  }

  function updateContact(index: number, patch: Partial<PersonaliseContact>) {
    setPlan((current) => {
      if (!current) {
        return current;
      }
      const contacts = current.contacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, ...patch } : contact,
      );
      return { ...current, contacts };
    });
  }

  async function onFile(file: File | null) {
    if (!file) {
      return;
    }
    setBusy("extract");
    setError("");
    setFileLabel(file.name);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/personalise/extract", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as PersonalisePlan & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not read that file.");
      }
      setPlan(data);
      setOpenIndex(0);
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function rollOut(schedule: CampaignScheduleInput) {
    if (!plan) {
      return;
    }
    setBusy("rollout");
    setError("");
    try {
      const response = await fetch("/api/personalise/rollout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listName: plan.listName,
          fileName: plan.fileName,
          contacts: plan.contacts,
          senderId,
          windowStart,
          windowEnd,
          emailGapMinutes,
          mode: schedule.mode,
          scheduledFor: schedule.scheduledFor,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<RolloutResult> & {
        error?: string;
      };
      if (!response.ok || !data.campaignId) {
        throw new Error(data.error || "Could not schedule the campaign.");
      }
      setScheduleOpen(false);
      onCreated(data.campaignId);
    } finally {
      setBusy(null);
    }
  }

  const canSchedule =
    busy === null &&
    missingEmails === 0 &&
    Boolean(senderId) &&
    Boolean(plan?.listName.trim()) &&
    (plan?.contacts.length ?? 0) > unsubscribedCount;

  return (
    <div className="personalise-create">
      <p className="personalise-lead">
        Upload a doc or spreadsheet. Contacts, subjects, pitches, and follow-up gaps are
        read from the file, even when the layout changes.
      </p>

      {error ? <p className="crm-error">{error}</p> : null}

      {!plan ? (
        <label className={`personalise-drop${busy === "extract" ? " is-busy" : ""}`}>
          <input
            type="file"
            accept=".docx,.xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              void onFile(file);
            }}
          />
          <span className="pz-drop-icon" aria-hidden="true">
            {busy === "extract" ? (
              <span className="pz-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
            )}
          </span>
          <strong>{busy === "extract" ? "Reading the file…" : "Upload a doc or spreadsheet"}</strong>
          <span>
            {busy === "extract"
              ? "Finding contacts, subjects, pitches, and follow-up days."
              : "Click to choose a .docx, .xlsx, .csv, or .txt file"}
          </span>
        </label>
      ) : null}

      {plan ? (
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
                <strong>{fileLabel || plan.fileName || "Uploaded file"}</strong>
                <span>
                  {plan.contacts.length.toLocaleString()}{" "}
                  {plan.contacts.length === 1 ? "contact" : "contacts"} ·{" "}
                  {plan.contacts
                    .reduce((sum, contact) => sum + contact.steps.length, 0)
                    .toLocaleString()}{" "}
                  emails
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn-soft"
              disabled={busy !== null}
              onClick={() => {
                setPlan(null);
                setFileLabel("");
                setError("");
              }}
            >
              Choose another file
            </button>
          </div>

          <div className="pz-card">
          <h3 className="pz-card-title">Campaign setup</h3>
          <div className="personalise-fields">
            <div className="crm-field">
              <label htmlFor="personalise-list-name">List name</label>
              <input
                id="personalise-list-name"
                value={plan.listName}
                onChange={(event) =>
                  setPlan((current) =>
                    current ? { ...current, listName: event.target.value } : current,
                  )
                }
              />
            </div>
            <div className="crm-field">
              <label id="personalise-sender-label">Sender</label>
              <SmtpSenderSelect
                id="personalise-sender"
                labelledBy="personalise-sender-label"
                className="pz-sender-select"
                senders={senders}
                value={senderId}
                onChange={setSenderId}
                placeholder="No Gmail or Outlook sender"
              />
            </div>
            <div className="crm-field">
              <label htmlFor="personalise-start">Start sending</label>
              <input
                id="personalise-start"
                type="time"
                value={windowStart}
                onChange={(event) => setWindowStart(event.target.value)}
              />
            </div>
            <div className="crm-field">
              <label htmlFor="personalise-end">Stop sending</label>
              <input
                id="personalise-end"
                type="time"
                value={windowEnd}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
            </div>
            <div className="crm-field">
              <label htmlFor="personalise-gap" title="Gap between emails, in minutes">
                Gap (minutes)
              </label>
              <input
                id="personalise-gap"
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
            Follow-up waits come from the file. Emails only go out between the start and stop
            times, with this gap between each send.
          </p>
          </div>
          {missingEmails > 0 ? (
            <p className="crm-error">
              {missingEmails === 1
                ? "1 contact has no email. Add it before scheduling."
                : `${missingEmails} contacts have no email. Add them before scheduling.`}
            </p>
          ) : null}
          {unsubscribedCount > 0 ? (
            <div className="pz-unsub-banner" role="status">
              <span>
                {unsubscribedCount === 1
                  ? "1 contact is on the unsubscribe list and will not be emailed."
                  : `${unsubscribedCount} contacts are on the unsubscribe list and will not be emailed.`}
              </span>
              <button
                type="button"
                className="btn-soft"
                onClick={() => removeContacts((contact) => isUnsubscribed(contact))}
              >
                {unsubscribedCount === 1 ? "Remove contact" : "Remove all"}
              </button>
            </div>
          ) : null}

          <div className="personalise-actions">
            <span className="personalise-hint">
              Creates the list <strong>{plan.listName.trim() || "—"}</strong>. Send now or pick a
              date and time.
            </span>
            <button
              type="button"
              className="btn-dark"
              disabled={!canSchedule}
              onClick={() => setScheduleOpen(true)}
            >
              Schedule
            </button>
          </div>

          <div className="pz-contacts">
            {plan.contacts.map((contact, index) => {
              const delays = stepDelayDays(contact.steps);
              const open = openIndex === index;
              const missing = contactNeedsEmail(contact);
              const unsubscribed = isUnsubscribed(contact);
              const meta = [contact.position, contact.companyName].filter(Boolean).join(" · ");
              return (
                <section
                  key={`${personName(contact)}-${index}`}
                  className={`pz-contact${open ? " is-open" : ""}${unsubscribed ? " is-unsubscribed" : ""}`}
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
                      <span>{meta || "No position or company"}</span>
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
                    <input
                      className={`pz-email${missing ? " is-missing" : ""}`}
                      type="email"
                      value={contact.email}
                      placeholder="Add email"
                      aria-label={`Email for ${personName(contact)}`}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) => updateContact(index, { email: event.target.value })}
                    />
                    {unsubscribed ? (
                      <>
                        <span className="pz-chip pz-chip-danger">Unsubscribed</span>
                        <button
                          type="button"
                          className="pz-remove"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeContacts((_, contactIndex) => contactIndex === index);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span className="pz-chip">
                        {contact.steps.length} {contact.steps.length === 1 ? "email" : "emails"}
                      </span>
                    )}
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
                      {contact.steps.map((step, stepIndex) => (
                        <li key={`${step.label}-${stepIndex}`} className="pz-step">
                          <span className="pz-step-dot" aria-hidden="true">
                            {stepIndex + 1}
                          </span>
                          <div className="pz-step-card">
                            <div className="pz-step-head">
                              <strong>{step.label || `Email ${stepIndex + 1}`}</strong>
                              {stepIndex > 0 ? (
                                <>
                                  <span className="pz-chip">
                                    Day {step.day} · {step.day} {step.day === 1 ? "day" : "days"} after email 1
                                  </span>
                                  <span className="pz-chip pz-chip-soft">
                                    {delays[stepIndex]} {delays[stepIndex] === 1 ? "day" : "days"} after email {stepIndex}
                                  </span>
                                </>
                              ) : (
                                <span className="pz-chip">Day 0 · Sent first</span>
                              )}
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
                            <PitchPreview body={step.body} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              );
            })}
          </div>

        </div>
      ) : null}

      {scheduleOpen && plan ? (
        <CampaignScheduleDrawer
          timezone="Asia/Kolkata"
          onClose={() => {
            if (busy !== "rollout") {
              setScheduleOpen(false);
            }
          }}
          onConfirm={rollOut}
        />
      ) : null}
    </div>
  );
}
