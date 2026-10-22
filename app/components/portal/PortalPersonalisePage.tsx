"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SIGNATURE_HTML,
  MAX_STEP_GAP_DAYS,
  applyStepGaps,
  cleanReplyTo,
  cleanSignatureHtml,
  contactNeedsEmail,
  defaultStepGaps,
  pitchBlocks,
  stepDelayDays,
  type PitchInline,
  type PersonaliseContact,
  type PersonalisePlan,
} from "@/lib/personalise-types";
import SmtpSenderSelect from "@/app/components/portal/SmtpSenderSelect";
import { formatTimezoneLabel, listCampaignTimezones } from "@/lib/campaign-timezones";
import CampaignScheduleDrawer, {
  type CampaignScheduleInput,
} from "@/app/components/portal/CampaignScheduleDrawer";
import {
  SEND_WEEKDAYS,
  createDripCampaign,
  patchDripCampaign,
  type DripCampaign,
} from "@/lib/drip-campaigns";

const CONTACTS_PAGE_SIZE = 50;

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

function SignatureFrame({ html, signOff = "" }: { html: string; signOff?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState<{ height: number; width?: number }>({ height: 80 });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff}body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222}p.signoff{margin:0 0 8px}</style></head><body>${signOff ? `<p class="signoff">${signOff}</p>` : ""}${html}</body></html>`;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const body = frame.contentDocument?.body;
      const root = frame.contentDocument?.documentElement;
      if (!body || !root) return;
      const available = frame.parentElement?.clientWidth ?? 0;
      const wide = root.scrollWidth > available + 1 ? root.scrollWidth : undefined;
      setSize({ height: Math.max(40, Math.ceil(body.scrollHeight)), width: wide });
      if (!observer) {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", measure);
    if (frame.contentDocument?.readyState === "complete") measure();
    return () => {
      frame.removeEventListener("load", measure);
      observer?.disconnect();
    };
  }, [doc]);

  return (
    <div className="pz-signature-scroll">
      <iframe
        ref={frameRef}
        className="pz-signature-frame"
        title="Signature preview"
        sandbox="allow-same-origin allow-popups"
        srcDoc={doc}
        style={{ height: size.height, width: size.width ?? "100%" }}
      />
    </div>
  );
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

function PitchPreview({ body, signature }: { body: string; signature: string }) {
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
        if (block.type === "signoff" && signature) {
          return (
            <Fragment key={index}>
              <p className="pz-signoff">{block.lines[0]}</p>
              <SignatureFrame html={signature} />
            </Fragment>
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
      {signature && !blocks.some((block) => block.type === "signoff") ? (
        <SignatureFrame html={signature} />
      ) : null}
    </div>
  );
}

export default function PortalPersonalisePage({
  onCreated,
  campaignId: initialCampaignId,
  initialCampaign,
}: {
  onCreated: (campaignId: string) => void;
  /** Existing draft from the Personalise list (resume after upload). */
  campaignId?: string;
  initialCampaign?: DripCampaign | null;
}) {
  const initialPlan = initialCampaign?.personalisePlan ?? null;
  const [plan, setPlan] = useState<PersonalisePlan | null>(
    initialPlan
      ? {
          listName: initialPlan.listName,
          fileName: initialPlan.fileName,
          contacts: initialPlan.contacts,
        }
      : null,
  );
  const [draftCampaignId, setDraftCampaignId] = useState(initialCampaignId || "");
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [senderId, setSenderId] = useState(initialCampaign?.senderId || "");
  const [replyTo, setReplyTo] = useState(initialCampaign?.replyToEmail || "");
  const [windowStart, setWindowStart] = useState(initialCampaign?.windowStart || "09:00");
  const [windowEnd, setWindowEnd] = useState(initialCampaign?.windowEnd || "18:00");
  const [sendStartDay, setSendStartDay] = useState(initialCampaign?.sendStartDay ?? 1);
  const [sendEndDay, setSendEndDay] = useState(initialCampaign?.sendEndDay ?? 0);
  const [emailGapMinutes, setEmailGapMinutes] = useState(
    initialCampaign?.emailGapMinutes ?? 5,
  );
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [busy, setBusy] = useState<"extract" | "rollout" | null>(null);
  const [error, setError] = useState("");
  const [fileLabel, setFileLabel] = useState(initialPlan?.fileName || "");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [suppressed, setSuppressed] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [stepGaps, setStepGaps] = useState<number[]>(() =>
    initialPlan ? defaultStepGaps(initialPlan.contacts) : [],
  );
  const [signatureHtml, setSignatureHtml] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState("");
  const [signatureTab, setSignatureTab] = useState<"code" | "preview">("code");
  const [timezone, setTimezone] = useState(initialCampaign?.timezone || "Asia/Kolkata");
  const timezones = useMemo(() => listCampaignTimezones(timezone), [timezone]);
  const [signatureTouched, setSignatureTouched] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<Record<string, string>>({});
  const cleanSignature = useMemo(() => cleanSignatureHtml(signatureHtml), [signatureHtml]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/inbox/signatures");
        const data = (await response.json()) as { signatures?: { senderId: string; html: string }[] };
        if (cancelled || !response.ok) return;
        setSavedSignatures(
          Object.fromEntries((data.signatures ?? []).map((item) => [item.senderId, item.html])),
        );
      } catch {
        // Signatures are optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const savedForSender = savedSignatures[senderId] ?? "";
  const activeSignature = signatureTouched ? cleanSignature : cleanSignatureHtml(savedForSender);

  function openSignatureEditor() {
    const current = signatureTouched ? signatureHtml : savedForSender;
    setSignatureDraft(current);
    setSignatureTab(cleanSignatureHtml(current) ? "preview" : "code");
    setSignatureOpen(true);
  }

  function saveSignature(value: string) {
    setSignatureHtml(value.slice(0, MAX_SIGNATURE_HTML));
    setSignatureTouched(true);
    setSignatureOpen(false);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/smtp/senders");
        const data = (await response.json()) as SenderOption[] | { error?: string };
        if (!response.ok || !Array.isArray(data)) {
          return;
        }
        if (!cancelled) {
          setSenders(data);
          setSenderId((current) => current || data[0]?.id || "");
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

  function changeStepGap(index: number, value: number) {
    const gaps = stepGaps.map((gap, gapIndex) =>
      gapIndex === index ? Math.max(0, Math.min(MAX_STEP_GAP_DAYS, Math.round(value) || 0)) : gap,
    );
    setStepGaps(gaps);
    setPlan((current) =>
      current ? { ...current, contacts: applyStepGaps(current.contacts, gaps) } : current,
    );
  }

  async function persistDraft(nextPlan: PersonalisePlan, existingId = draftCampaignId) {
    const name = nextPlan.listName.trim() || nextPlan.fileName.trim() || "Personalise campaign";
    const firstSubject = nextPlan.contacts[0]?.steps[0]?.subject?.trim();
    const patch = {
      tags: ["personalise"],
      status: "draft" as const,
      personalisePlan: nextPlan,
      listName: nextPlan.listName,
      recipients: nextPlan.contacts.length,
      subject: firstSubject || undefined,
      senderId: senderId || undefined,
      windowStart,
      windowEnd,
      sendStartDay,
      sendEndDay,
      emailGapMinutes,
      timezone,
      timezoneEnabled: true,
      replyToEnabled: Boolean(cleanReplyTo(replyTo)),
      replyToEmail: cleanReplyTo(replyTo) || undefined,
    };

    if (existingId) {
      await patchDripCampaign(existingId, { ...patch, name }, "oneone");
      return existingId;
    }

    const created = await createDripCampaign(name, "oneone", { autoNumber: true });
    await patchDripCampaign(created.id, patch, "oneone");
    setDraftCampaignId(created.id);
    return created.id;
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
      const gaps = defaultStepGaps(data.contacts);
      const nextPlan = { ...data, contacts: applyStepGaps(data.contacts, gaps) };
      setStepGaps(gaps);
      setPlan(nextPlan);
      setOpenIndex(0);
      setPage(1);
      // Save as a Personalise draft so it shows in the campaign list immediately.
      await persistDraft(nextPlan);
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
    const replyAddress = cleanReplyTo(replyTo);
    if (replyAddress === null) {
      setError("Reply to must be an email address.");
      return;
    }
    setBusy("rollout");
    setError("");
    try {
      let campaignId = draftCampaignId;
      if (!campaignId) {
        campaignId = await persistDraft(plan);
      } else {
        await persistDraft(plan, campaignId);
      }
      const response = await fetch("/api/personalise/rollout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          listName: plan.listName,
          fileName: plan.fileName,
          contacts: plan.contacts,
          senderId,
          windowStart,
          windowEnd,
          sendStartDay,
          sendEndDay,
          emailGapMinutes,
          mode: schedule.mode,
          scheduledFor: schedule.scheduledFor,
          signatureHtml: activeSignature,
          timezone,
          replyTo: replyAddress,
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

  const contactCount = plan?.contacts.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(contactCount / CONTACTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOffset = (currentPage - 1) * CONTACTS_PAGE_SIZE;
  const pageContacts = plan
    ? plan.contacts.slice(pageOffset, pageOffset + CONTACTS_PAGE_SIZE)
    : [];

  function goToPage(next: number) {
    setPage(Math.max(1, Math.min(totalPages, next)));
    setOpenIndex(null);
  }

  const pagination =
    contactCount > CONTACTS_PAGE_SIZE ? (
      <div className="drip-pagination">
        <span className="drip-page-range">
          {pageOffset + 1}-{pageOffset + pageContacts.length} of {contactCount.toLocaleString()}
        </span>
        <div className="drip-page-controls">
          <select
            value={currentPage}
            onChange={(event) => goToPage(Number(event.target.value))}
            aria-label="Page"
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
            onClick={() => goToPage(currentPage - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <button
            type="button"
            className="drip-page-arrow"
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="personalise-create">
      <p className="personalise-lead">
        Upload a doc or spreadsheet. Contacts, subjects, pitches, and follow-up gaps are
        read from the file, even when the layout changes. The upload is saved as a draft
        campaign so you can leave and come back.{" "}
        <a className="pz-sample-link" href="/samples/personalise-sample.csv" download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Download sample
        </a>
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
                  {draftCampaignId ? " · Saved as draft" : ""}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn-soft"
              disabled={busy !== null}
              onClick={() => {
                setPlan(null);
                setStepGaps([]);
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
                placeholder="No sender yet"
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
              <label htmlFor="personalise-start-day">Start day</label>
              <select
                id="personalise-start-day"
                className="pz-timezone-select"
                value={sendStartDay}
                onChange={(event) => setSendStartDay(Number(event.target.value))}
              >
                {SEND_WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="crm-field">
              <label htmlFor="personalise-end-day">End day</label>
              <select
                id="personalise-end-day"
                className="pz-timezone-select"
                value={sendEndDay}
                onChange={(event) => setSendEndDay(Number(event.target.value))}
              >
                {SEND_WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="personalise-fields personalise-fields-extra">
            <div className="crm-field">
              <label>Signature</label>
              <div className="pz-signature-field">
                <button type="button" className="btn-soft pz-signature-btn" onClick={openSignatureEditor}>
                  {activeSignature ? "Edit signature" : "Insert signature"}
                </button>
              </div>
            </div>
            <div className="crm-field">
              <label htmlFor="personalise-timezone">Time zone</label>
              <select
                id="personalise-timezone"
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
            <div className="crm-field">
              <label htmlFor="personalise-reply-to">Reply to</label>
              <input
                id="personalise-reply-to"
                type="email"
                value={replyTo}
                placeholder="Replies go to the sender"
                onChange={(event) => setReplyTo(event.target.value)}
              />
            </div>
          </div>
          <p className="personalise-hint">
            Emails only go out from the start day through the end day, between the start and
            stop times in {timezone}, with this gap between each send. The signature goes below
            the sign-off, like &ldquo;Best regards,&rdquo; in every email.
          </p>
          </div>
          {stepGaps.length > 0 ? (
            <div className="pz-card pz-gaps">
              <h3 className="pz-card-title">Days between emails</h3>
              <p className="personalise-hint">
                The file has {stepGaps.length + 1} emails per contact. Set how many days to wait
                before each follow-up. This replaces the days in the file for every contact.
              </p>
              <div className="pz-gap-list">
                {stepGaps.map((gap, index) => {
                  const day = stepGaps.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
                  return (
                    <label key={index} className="pz-gap-row">
                      <span className="pz-gap-name">
                        <strong>Follow-up {index + 1}</strong>
                        <em>
                          Email {index + 2} · Day {day}
                        </em>
                      </span>
                      <span className="pz-gap-input">
                        <input
                          type="number"
                          min={0}
                          max={MAX_STEP_GAP_DAYS}
                          value={gap}
                          onChange={(event) => changeStepGap(index, Number(event.target.value))}
                          aria-label={`Days before follow-up ${index + 1}`}
                        />
                        <span>
                          {gap === 1 ? "day" : "days"} after email {index + 1}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
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

          {pagination}
          <div className="pz-contacts">
            {pageContacts.map((contact, pageIndex) => {
              const index = pageOffset + pageIndex;
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
                            <PitchPreview body={step.body} signature={activeSignature} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              );
            })}
          </div>
          {pagination}
        </div>
      ) : null}

      {signatureOpen ? (
        <div className="crm-modal-backdrop" role="presentation" onClick={() => setSignatureOpen(false)}>
          <div
            className="crm-modal pz-signature-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pz-signature-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="pz-signature-title">Email signature</h3>
                <p>Paste your signature HTML. It goes below the sign-off in every email.</p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={() => setSignatureOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body pz-signature-modal-body">
              <div className="pz-signature-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={signatureTab === "code"}
                  className={signatureTab === "code" ? "active" : ""}
                  onClick={() => setSignatureTab("code")}
                >
                  Code
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={signatureTab === "preview"}
                  className={signatureTab === "preview" ? "active" : ""}
                  onClick={() => setSignatureTab("preview")}
                >
                  Preview
                </button>
              </div>
              {signatureTab === "code" ? (
                <textarea
                  className="pz-signature-input"
                  value={signatureDraft}
                  onChange={(event) => setSignatureDraft(event.target.value.slice(0, MAX_SIGNATURE_HTML))}
                  placeholder={'<table><tr><td><strong>Your Name</strong><br>Title, Company<br><a href="https://example.com">example.com</a></td></tr></table>'}
                  spellCheck={false}
                  rows={14}
                  aria-label="Signature HTML"
                  autoFocus
                />
              ) : cleanSignatureHtml(signatureDraft) ? (
                <div className="pz-signature-preview">
                  <SignatureFrame html={cleanSignatureHtml(signatureDraft)} signOff="Best regards," />
                </div>
              ) : (
                <p className="pz-signature-empty">Paste the signature HTML in Code first.</p>
              )}
            </div>
            <div className="crm-modal-foot pz-signature-modal-foot">
              {signatureDraft.trim() ? (
                <button type="button" className="btn-link-purple" onClick={() => saveSignature("")}>
                  Remove signature
                </button>
              ) : (
                <span />
              )}
              <div className="pz-signature-modal-actions">
                <button type="button" className="btn-soft" onClick={() => setSignatureOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-dark"
                  disabled={!cleanSignatureHtml(signatureDraft) && !activeSignature}
                  onClick={() => saveSignature(signatureDraft)}
                >
                  Save signature
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {scheduleOpen && plan ? (
        <CampaignScheduleDrawer
          timezone={timezone}
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
