"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import type { SmtpSender } from "@/lib/smtp-senders";
import type { Contact, CrmList } from "@/lib/crm";
import {
  campaignSequences,
  createEmptySequence,
  fetchDripCampaign,
  fetchDripCampaigns,
  getRemainingEmailCredits,
  isOneOneCampaign,
  MAX_INDIVIDUAL_CONTACTS,
  mergeBlastReport,
  overlaySequenceOnCampaign,
  patchDripCampaign,
  sequenceCampaignPatch,
  sequencesReady,
  zonedDateTimeToIso,
  type CampaignIndividualContact,
  type CampaignKind,
  type CampaignSequence,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { formatSenderDisplayName } from "@/lib/mxtoolbox";
import { PORTAL_ROUTES, portalCampaignRoute } from "@/lib/portal-nav";
import {
  DEFAULT_UTM_CAMPAIGN,
  DEFAULT_UTM_MEDIUM,
  DEFAULT_UTM_SOURCE,
} from "@/lib/campaign-tracking";
import {
  AUTOMATION_FOLLOW_UP_TAG,
  campaignHasAutomationTag,
  ensureAutomationCampaignTags,
} from "@/lib/automations";
import PortalCampaignReport from "@/app/components/portal/PortalCampaignReport";
import { getEmailTemplate, loadEmailTemplates } from "@/lib/email-templates";
import { normalizeEmailMergeTags, replaceUnsubscribeVariables } from "@/lib/email-variables";
import {
  addSavedTestEmail,
  isValidEmail,
  loadSavedTestEmails,
  removeSavedTestEmail,
} from "@/lib/test-list";

type SetupStep = {
  id: string;
  title: string;
  subtitle?: ReactNode;
  action: string;
  done: boolean;
  noIcon?: boolean;
  locked?: boolean;
};

function isAutomationCampaign(campaign: DripCampaign | null | undefined) {
  return campaignHasAutomationTag(campaign);
}

function isAutomationFollowUpCampaign(
  campaign: DripCampaign | null | undefined,
  queryFollowUp: boolean,
) {
  if (queryFollowUp) {
    return true;
  }
  return Boolean(campaign?.tags?.includes(AUTOMATION_FOLLOW_UP_TAG));
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ListTabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function SegmentTabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function ContactTabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 6-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

type RecipientPickerTab = "recent" | "lists" | "segments" | "contacts";

function listMetaLabel(list: CrmList) {
  return `List · #${list.displayId}`;
}

function InfoIcon() {
  return (
    <span className="drip-field-info" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}

function SenderPhonePreview({
  senderName,
  subject,
  previewText,
}: {
  senderName: string;
  subject?: string;
  previewText?: string;
}) {
  const displayName = senderName || "Sender name";
  const preview = previewText?.trim() || "Your preview text";

  return (
    <div className="drip-sender-preview">
      <div className="drip-phone-mockup" aria-hidden="true">
        <div className="drip-phone-shell drip-phone-shell-iphone11">
          <span className="drip-phone-side-btn drip-phone-side-silent" />
          <span className="drip-phone-side-btn drip-phone-side-vol-up" />
          <span className="drip-phone-side-btn drip-phone-side-vol-down" />
          <span className="drip-phone-side-btn drip-phone-side-power" />
          <div className="drip-phone-frame">
            <div className="drip-phone-screen">
              <div className="drip-phone-notch">
                <span className="drip-phone-speaker" />
                <span className="drip-phone-sensor" />
                <span className="drip-phone-camera" />
              </div>
              <div className="drip-phone-status">
                <span className="drip-phone-time">9:47</span>
                <div className="drip-phone-status-icons">
                  <span className="drip-phone-signal">
                    <i /><i /><i /><i />
                  </span>
                  <span className="drip-phone-wifi" />
                  <span className="drip-phone-battery" />
                </div>
              </div>

              <div className="drip-phone-inbox-title">Inbox</div>

              <div className="drip-phone-email active">
                <div className="drip-phone-email-top">
                  <span className="sender">{displayName}</span>
                  <span className="time">17:45</span>
                </div>
                <div className="subject">{subject?.trim() || "Message subject..."}</div>
                <div className="preview">{preview}</div>
              </div>

              {[0, 1, 2].map((index) => (
                <div
                  className={`drip-phone-email placeholder drip-phone-email-fade-${index + 1}`}
                  key={index}
                >
                  <div className="drip-phone-email-top">
                    <span className="sender">{displayName}</span>
                    <span className="time">17:45</span>
                  </div>
                  <div className="line" />
                  <div className="line short" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="drip-phone-caption">
        Actual email preview may vary depending on the email client.
      </p>
    </div>
  );
}

function SenderPanel({
  campaign,
  senders,
  optionsLoading,
  draftSenderId,
  draftSenderName,
  onClose,
  onSave,
  onEmailChange,
  onNameChange,
}: {
  campaign: DripCampaign;
  senders: SmtpSender[];
  optionsLoading: boolean;
  draftSenderId: string;
  draftSenderName: string;
  onClose: () => void;
  onSave: () => void;
  onEmailChange: (senderId: string) => void;
  onNameChange: (name: string) => void;
}) {
  const savedSenderId = campaign.senderId ?? "";
  const savedSenderName = (campaign.senderName ?? "").trim();
  const hasChanges =
    draftSenderId !== savedSenderId ||
    draftSenderName.trim() !== savedSenderName;
  const canSave = Boolean(draftSenderId) && senders.length > 0 && hasChanges;

  return (
    <div className="drip-sender-panel">
      <div className="drip-sender-panel-head">
        <div className="drip-sender-panel-title">
          <span className="drip-modal-step-icon done" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div>
            <h3>Sender</h3>
            <p>Who is sending this email campaign?</p>
          </div>
        </div>
        <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drip-sender-panel-body">
        {optionsLoading ? (
          <div className="drip-picker-empty">Loading senders...</div>
        ) : senders.length === 0 ? (
          <div className="drip-picker-empty">
            No senders configured.{" "}
            <Link href={PORTAL_ROUTES.smtp} className="link-blue">
              Add a sender
            </Link>
          </div>
        ) : (
          <>
            <div className="drip-sender-form">
              <div className="crm-field">
                <label htmlFor="drip-sender-email">
                  Email address
                  <InfoIcon />
                </label>
                <select
                  id="drip-sender-email"
                  value={draftSenderId}
                  onChange={(event) => onEmailChange(event.target.value)}
                >
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.fromEmail}
                    </option>
                  ))}
                </select>
              </div>

              <div className="crm-field">
                <label htmlFor="drip-sender-name">
                  Name
                  <InfoIcon />
                </label>
                <input
                  id="drip-sender-name"
                  value={draftSenderName}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder="Sender name"
                />
              </div>
            </div>

            <SenderPhonePreview senderName={draftSenderName} subject={campaign.subject} />
          </>
        )}
      </div>

      <div className="drip-sender-panel-foot">
        <button type="button" className="btn-link-purple" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-dark"
          onClick={onSave}
          disabled={!canSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function EmojiToolbarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BracesToolbarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 4C5 4 4 7 4 9s1 2 1 3-1 2-1 3 1 5 4 5" />
      <path d="M16 4c3 0 4 3 4 5s-1 2-1 3 1 2 1 3-1 5-4 5" />
    </svg>
  );
}

function SparkleToolbarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m8 8 2 2M14 14l2 2M16 8l-2 2M8 16l2-2" />
    </svg>
  );
}

const SUBJECT_EMOJIS = [
  "😀", "😊", "😉", "🙂", "😍", "🤩", "👍", "👏", "🎉", "🔥",
  "✨", "💡", "📧", "📅", "✅", "⭐", "💜", "🚀", "📣", "🙏",
];

const CONTACT_VARIABLES = [
  { label: "FIRSTNAME", tag: "{{ contact.FIRSTNAME }}" },
  { label: "LASTNAME", tag: "{{ contact.LASTNAME }}" },
  { label: "EMAIL", tag: "{{ contact.EMAIL }}" },
  { label: "COMPANY", tag: "{{ contact.COMPANY }}" },
  { label: "UNSUBSCRIBE", tag: "{{ unsubscribe }}" },
];

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyContactVariables(text: string, contact: Contact | null, forHtml = false) {
  if (!text) {
    return "";
  }

  const normalized = normalizeEmailMergeTags(text);
  const withUnsubscribe = replaceUnsubscribeVariables(normalized, "#unsubscribe");

  if (!contact) {
    return withUnsubscribe;
  }

  const values: Record<string, string> = {
    FIRSTNAME: contact.firstName || "",
    LASTNAME: contact.lastName || "",
    EMAIL: contact.email || "",
    COMPANY: contact.companyName || "",
  };

  return withUnsubscribe.replace(/\{\{\s*contact\.([A-Za-z]+)\s*\}\}/g, (_, key: string) => {
    const value = values[key.toUpperCase()] ?? "";
    return forHtml ? escapeHtml(value) : value;
  });
}

function insertIntoTextarea(
  value: string,
  insertion: string,
  textarea: HTMLTextAreaElement | null,
  onChange: (value: string) => void,
) {
  if (!textarea) {
    onChange(`${value}${insertion}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const nextValue = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  onChange(nextValue);

  requestAnimationFrame(() => {
    textarea.focus();
    const cursor = start + insertion.length;
    textarea.setSelectionRange(cursor, cursor);
  });
}

function PersonVariableIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c1.5-3 3.5-4.5 7-4.5s5.5 1.5 7 4.5" />
    </svg>
  );
}

function DataFeedVariableIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    </svg>
  );
}

function SubjectTextareaField({
  id,
  label,
  required,
  value,
  onChange,
  placeholder,
  boxClassName,
  showAiButton = false,
  autoFocus = false,
}: {
  id: string;
  label: ReactNode;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  boxClassName: string;
  showAiButton?: boolean;
  autoFocus?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const variableButtonRef = useRef<HTMLButtonElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [variableOpen, setVariableOpen] = useState(false);
  const [variableView, setVariableView] = useState<"main" | "contact">("main");
  const [variableSearch, setVariableSearch] = useState("");
  const [variablePopoverStyle, setVariablePopoverStyle] = useState({ top: 0, left: 0 });

  function updateVariablePopoverPosition() {
    if (!variableButtonRef.current || !boxRef.current) {
      return;
    }

    const boxRect = boxRef.current.getBoundingClientRect();
    const buttonRect = variableButtonRef.current.getBoundingClientRect();
    setVariablePopoverStyle({
      left: buttonRect.left - boxRect.left,
      top: buttonRect.bottom - boxRect.top + 14,
    });
  }

  useLayoutEffect(() => {
    if (!variableOpen) {
      return;
    }

    updateVariablePopoverPosition();
    window.addEventListener("resize", updateVariablePopoverPosition);
    return () => window.removeEventListener("resize", updateVariablePopoverPosition);
  }, [variableOpen, variableView]);

  useEffect(() => {
    if (!emojiOpen && !variableOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false);
        setVariableOpen(false);
        setVariableView("main");
        setVariableSearch("");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [emojiOpen, variableOpen]);

  const filteredContactVariables = CONTACT_VARIABLES.filter((variable) => {
    const query = variableSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return (
      variable.label.toLowerCase().includes(query) ||
      variable.tag.toLowerCase().includes(query)
    );
  });

  function closeMenus() {
    setEmojiOpen(false);
    setVariableOpen(false);
    setVariableView("main");
    setVariableSearch("");
  }

  function handleEmojiSelect(emoji: string) {
    insertIntoTextarea(value, emoji, textareaRef.current, onChange);
    setEmojiOpen(false);
  }

  function handleVariableInsert(tag: string) {
    insertIntoTextarea(value, tag, textareaRef.current, onChange);
    closeMenus();
  }

  const showContactInMain =
    variableSearch.trim().length === 0 ||
    "contact attributes".includes(variableSearch.trim().toLowerCase()) ||
    filteredContactVariables.length > 0;

  const showDataFeedsInMain =
    variableSearch.trim().length === 0 ||
    "data feeds".includes(variableSearch.trim().toLowerCase());

  const menuOpen = emojiOpen || variableOpen;

  return (
    <div className={`crm-field${menuOpen ? " drip-subject-field-open" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div
        className={`drip-subject-box ${boxClassName}${menuOpen ? " drip-subject-box-popover-open" : ""}${variableOpen ? " drip-subject-box-variable-open" : ""}`}
        ref={boxRef}
      >
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={closeMenus}
          onClick={closeMenus}
          placeholder={placeholder}
          rows={3}
          required={required}
          autoFocus={autoFocus}
        />

        <div className="drip-subject-box-toolbar">
          <button
            type="button"
            className={emojiOpen ? "active" : undefined}
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            onClick={() => {
              setEmojiOpen((open) => !open);
              setVariableOpen(false);
              setVariableView("main");
              setVariableSearch("");
            }}
          >
            <EmojiToolbarIcon />
          </button>

          <button
            ref={variableButtonRef}
            type="button"
            className={variableOpen ? "active" : undefined}
            aria-label="Insert personalization"
            aria-expanded={variableOpen}
            onClick={() => {
              setVariableOpen((open) => !open);
              setEmojiOpen(false);
              textareaRef.current?.blur();
              if (variableOpen) {
                setVariableView("main");
                setVariableSearch("");
              }
            }}
          >
            <BracesToolbarIcon />
          </button>

          {showAiButton ? (
            <button type="button" className="drip-subject-ai-btn" aria-label="Generate with AI">
              <SparkleToolbarIcon />
            </button>
          ) : null}
        </div>

        {variableOpen ? (
          <div
            className="drip-subject-variable-popover"
            role="dialog"
            aria-label="Variables"
            style={{ top: variablePopoverStyle.top, left: variablePopoverStyle.left }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drip-variable-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="text"
                value={variableSearch}
                onChange={(event) => setVariableSearch(event.target.value)}
                placeholder="Search for a variable"
                autoFocus
              />
            </div>

            {variableView === "main" ? (
              <div className="drip-variable-menu">
                {showContactInMain ? (
                  <button
                    type="button"
                    className="drip-variable-menu-item"
                    onClick={() => setVariableView("contact")}
                  >
                    <span className="drip-variable-menu-icon">
                      <PersonVariableIcon />
                    </span>
                    <span className="drip-variable-menu-copy">
                      <span className="title">Contact attributes</span>
                      <span className="desc">
                        Information associated with a contact, such as their name, email address,
                        or phone number.
                      </span>
                    </span>
                    <span className="drip-variable-menu-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ) : null}
                {showDataFeedsInMain ? (
                  <button type="button" className="drip-variable-menu-item" disabled>
                    <span className="drip-variable-menu-icon">
                      <DataFeedVariableIcon />
                    </span>
                    <span className="drip-variable-menu-copy">
                      <span className="title">Data feeds</span>
                      <span className="desc">
                        Information from external sources such as a list of products.
                      </span>
                    </span>
                    <span className="drip-variable-menu-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="drip-variable-submenu">
                <div className="drip-variable-back-row">
                  <button
                    type="button"
                    className="drip-variable-back"
                    onClick={() => {
                      setVariableView("main");
                      setVariableSearch("");
                    }}
                  >
                    <span className="drip-variable-back-arrow" aria-hidden="true">
                      ←
                    </span>
                    Back
                  </button>
                </div>
                <div className="drip-variable-list">
                  {filteredContactVariables.length === 0 ? (
                    <div className="drip-variable-empty">No variables found.</div>
                  ) : (
                    filteredContactVariables.map((variable) => (
                      <button
                        key={variable.label}
                        type="button"
                        className="drip-variable-option"
                        onClick={() => handleVariableInsert(variable.tag)}
                      >
                        <span className="name">{variable.label}</span>
                        <span className="tag">{variable.tag}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {emojiOpen ? (
          <div
            className="drip-subject-emoji-popover"
            role="dialog"
            aria-label="Emoji picker"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {SUBJECT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="drip-subject-emoji-option"
                onClick={() => handleEmojiSelect(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SubjectPanel({
  campaign,
  draftSubject,
  draftPreviewText,
  onClose,
  onSave,
  onSubjectChange,
  onPreviewTextChange,
}: {
  campaign: DripCampaign;
  draftSubject: string;
  draftPreviewText: string;
  onClose: () => void;
  onSave: () => void;
  onSubjectChange: (value: string) => void;
  onPreviewTextChange: (value: string) => void;
}) {
  const savedSubject = (campaign.subject ?? "").trim();
  const savedPreviewText = (campaign.previewText ?? "").trim();
  const hasChanges =
    draftSubject.trim() !== savedSubject ||
    draftPreviewText.trim() !== savedPreviewText;
  const canSave = draftSubject.trim().length > 0 && hasChanges;
  const senderName = campaign.senderName ?? "Sender name";

  return (
    <div className="drip-sender-panel drip-subject-panel">
      <div className="drip-sender-panel-head">
        <div className="drip-sender-panel-title">
          <span className="drip-modal-step-icon done" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div>
            <h3>Subject</h3>
            <p>Add a subject line for this campaign.</p>
          </div>
        </div>
        <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drip-sender-panel-body">
        <div className="drip-subject-form">
          <SubjectTextareaField
            id="drip-campaign-subject"
            label={
              <>
                Subject line <span className="drip-required-mark">*</span>
                <InfoIcon />
              </>
            }
            required
            value={draftSubject}
            onChange={onSubjectChange}
            placeholder="Final Reminder for the IFRS Webinar"
            boxClassName="drip-subject-box-line"
            showAiButton
            autoFocus
          />

          <SubjectTextareaField
            id="drip-campaign-preview-text"
            label={
              <>
                Preview text
                <InfoIcon />
              </>
            }
            value={draftPreviewText}
            onChange={onPreviewTextChange}
            boxClassName="drip-subject-box-preview"
          />
        </div>

        <SenderPhonePreview
          senderName={senderName}
          subject={draftSubject}
          previewText={draftPreviewText}
        />
      </div>

      <div className="drip-sender-panel-foot">
        <button type="button" className="btn-link-purple" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-dark" onClick={onSave} disabled={!canSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function contactToCampaignContact(contact: Contact): CampaignIndividualContact {
  return {
    id: contact.id,
    email: contact.email,
    fullName: contact.fullName,
  };
}

function individualContactsEqual(
  left: CampaignIndividualContact[],
  right: CampaignIndividualContact[],
) {
  if (left.length !== right.length) {
    return false;
  }

  const leftIds = left.map((contact) => contact.id).sort();
  const rightIds = right.map((contact) => contact.id).sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}

function recipientsSelectionChanged(
  savedListId: string,
  savedIndividualContacts: CampaignIndividualContact[],
  draftListId: string,
  draftIndividualContacts: CampaignIndividualContact[],
) {
  const savedUsesIndividual = savedIndividualContacts.length > 0;
  const draftUsesIndividual = draftIndividualContacts.length > 0;

  if (savedUsesIndividual !== draftUsesIndividual) {
    return true;
  }

  if (draftUsesIndividual) {
    return !individualContactsEqual(savedIndividualContacts, draftIndividualContacts);
  }

  return draftListId !== savedListId;
}

function AddIndividualContactsModal({
  contacts,
  initialSelection,
  onClose,
  onContinue,
}: {
  contacts: Contact[];
  initialSelection: CampaignIndividualContact[];
  onClose: () => void;
  onContinue: (selection: CampaignIndividualContact[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignIndividualContact[]>(initialSelection);

  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts
      .filter((contact) => {
        if (!needle) {
          return true;
        }
        return (
          contact.email.toLowerCase().includes(needle) ||
          contact.fullName.toLowerCase().includes(needle)
        );
      })
      .slice(0, 50);
  }, [contacts, query]);

  const hasChanges = useMemo(
    () => !individualContactsEqual(draft, initialSelection),
    [draft, initialSelection],
  );

  function toggleContact(contact: Contact) {
    const exists = draft.some((item) => item.id === contact.id);
    if (exists) {
      setDraft((current) => current.filter((item) => item.id !== contact.id));
      return;
    }

    if (draft.length >= MAX_INDIVIDUAL_CONTACTS) {
      return;
    }

    setDraft((current) => [...current, contactToCampaignContact(contact)]);
    setQuery("");
    setDropdownOpen(false);
  }

  function removeContact(contactId: string) {
    setDraft((current) => current.filter((item) => item.id !== contactId));
  }

  return (
    <div className="crm-modal-backdrop" onClick={onClose}>
      <div
        className="crm-modal drip-add-contacts-modal"
        onClick={(event) => {
          event.stopPropagation();
          setDropdownOpen(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drip-add-contacts-title"
      >
        <div className="crm-modal-head drip-add-contacts-head">
          <h3 id="drip-add-contacts-title">Add individual contacts</h3>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="crm-modal-body drip-add-contacts-body">
          <div className="crm-field">
            <label htmlFor="drip-individual-emails">Email addresses</label>
            <p className="drip-add-contacts-help">
              Add up to {MAX_INDIVIDUAL_CONTACTS} email addresses from your contacts.
            </p>
            <div
              className={`drip-individual-email-control${dropdownOpen ? " open" : ""}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="drip-individual-email-input-wrap"
                role="combobox"
                aria-expanded={dropdownOpen}
                aria-controls="drip-individual-email-listbox"
                onClick={() => {
                  setDropdownOpen(true);
                  document.getElementById("drip-individual-emails")?.focus();
                }}
              >
                <div className="drip-send-to-chips">
                  {draft.map((contact) => (
                    <span className="drip-send-to-chip" key={contact.id}>
                      {contact.email}
                      <button
                        type="button"
                        className="drip-send-to-chip-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeContact(contact.id);
                        }}
                        aria-label={`Remove ${contact.email}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {draft.length < MAX_INDIVIDUAL_CONTACTS ? (
                    <input
                      id="drip-individual-emails"
                      type="text"
                      value={query}
                      onFocus={() => setDropdownOpen(true)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setQuery(value);
                        setDropdownOpen(true);
                      }}
                      placeholder={draft.length === 0 ? "Search contacts" : ""}
                    />
                  ) : null}
                </div>
                <span className="drip-send-to-toggle" aria-hidden="true">
                  {dropdownOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </span>
              </div>
              {dropdownOpen ? (
                <div
                  className="drip-individual-email-dropdown"
                  id="drip-individual-email-listbox"
                  role="listbox"
                >
                  {filteredContacts.length === 0 ? (
                    <div className="drip-recipients-picker-empty">No contacts match your search.</div>
                  ) : (
                    filteredContacts.map((contact) => {
                      const selected = draft.some((item) => item.id === contact.id);
                      return (
                        <button
                          type="button"
                          key={contact.id}
                          className={`drip-individual-email-option${selected ? " selected" : ""}`}
                          onClick={() => toggleContact(contact)}
                        >
                          <span
                            className={`drip-recipient-checkbox${selected ? " checked" : ""}`}
                            aria-hidden="true"
                          >
                            {selected ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            ) : null}
                          </span>
                          <span className="email">{contact.email}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="crm-modal-foot drip-add-contacts-foot">
          <button type="button" className="btn-link-purple" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-dark"
            onClick={() => onContinue(draft)}
            disabled={!hasChanges || draft.length === 0}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RecipientsPanel({
  lists,
  contacts,
  optionsLoading,
  draftListId,
  draftIndividualContacts,
  savedListId,
  savedIndividualContacts,
  remainingEmails,
  onClose,
  onSave,
  onListChange,
  onClearList,
  onIndividualContactsChange,
}: {
  lists: CrmList[];
  contacts: Contact[];
  optionsLoading: boolean;
  draftListId: string;
  draftIndividualContacts: CampaignIndividualContact[];
  savedListId: string;
  savedIndividualContacts: CampaignIndividualContact[];
  remainingEmails: number;
  onClose: () => void;
  onSave: () => void;
  onListChange: (listId: string) => void;
  onClearList: () => void;
  onIndividualContactsChange: (contacts: CampaignIndividualContact[]) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<RecipientPickerTab>("recent");
  const [addContactsOpen, setAddContactsOpen] = useState(false);
  const selectedList = lists.find((list) => list.id === draftListId) ?? null;
  const usingIndividual = draftIndividualContacts.length > 0;
  const recipientCount = usingIndividual
    ? draftIndividualContacts.length
    : selectedList?.contactCount ?? 0;
  const usagePct = Math.min(
    100,
    Math.round((recipientCount / Math.max(remainingEmails + recipientCount, 1)) * 100),
  );
  const selectedCount = usingIndividual
    ? draftIndividualContacts.length
    : draftListId
      ? 1
      : 0;
  const selectionTotal = usingIndividual ? MAX_INDIVIDUAL_CONTACTS : lists.length;

  const visibleLists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? lists.filter((list) => list.name.toLowerCase().includes(query))
      : lists;

    if (activeTab === "lists") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    }

    if (activeTab === "recent") {
      const sorted = [...filtered].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      if (!draftListId) {
        return sorted;
      }

      const selected = sorted.find((list) => list.id === draftListId);
      if (!selected) {
        return sorted;
      }

      return [selected, ...sorted.filter((list) => list.id !== draftListId)];
    }

    return [];
  }, [lists, searchQuery, activeTab, draftListId]);

  function toggleList(listId: string) {
    onIndividualContactsChange([]);
    onListChange(draftListId === listId ? "" : listId);
  }

  function toggleIndividualContact(contact: CampaignIndividualContact) {
    onListChange("");
    const exists = draftIndividualContacts.some((item) => item.id === contact.id);
    if (exists) {
      onIndividualContactsChange(
        draftIndividualContacts.filter((item) => item.id !== contact.id),
      );
      return;
    }

    if (draftIndividualContacts.length >= MAX_INDIVIDUAL_CONTACTS) {
      return;
    }

    onIndividualContactsChange([...draftIndividualContacts, contact]);
  }

  function clearRecipients() {
    onClearList();
    onIndividualContactsChange([]);
  }

  const visibleIndividualContacts = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const source = draftIndividualContacts.length > 0 ? draftIndividualContacts : [];
    if (!needle) {
      return source;
    }
    return source.filter(
      (contact) =>
        contact.email.toLowerCase().includes(needle) ||
        contact.fullName.toLowerCase().includes(needle),
    );
  }, [draftIndividualContacts, searchQuery]);

  const hasChanges = recipientsSelectionChanged(
    savedListId,
    savedIndividualContacts,
    draftListId,
    draftIndividualContacts,
  );
  const hasValidSelection = usingIndividual
    ? draftIndividualContacts.length > 0
    : Boolean(draftListId);
  const canSave = hasChanges && hasValidSelection;

  return (
    <div className="drip-recipients-panel">
      <div className="drip-sender-panel-head">
        <div className="drip-sender-panel-title">
          <span className="drip-modal-step-icon done" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div>
            <h3>Recipients</h3>
            <p>
              <strong>{recipientCount.toLocaleString()}</strong> recipients •{" "}
              {remainingEmails.toLocaleString()} remaining emails
            </p>
          </div>
        </div>
        <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drip-recipients-panel-body">
        {optionsLoading ? (
          <div className="drip-picker-empty">Loading recipients...</div>
        ) : lists.length === 0 && contacts.length === 0 ? (
          <div className="drip-picker-empty">
            No lists or contacts yet.{" "}
            <Link href={PORTAL_ROUTES.lists} className="link-blue">
              Create a list
            </Link>
          </div>
        ) : (
          <>
            <div className="crm-field drip-send-to-field">
              <label>Send to</label>
              <div
                className={`drip-send-to-control${listOpen ? " open" : ""}${searchFocused ? " search-focused" : ""}`}
              >
                <div
                  className="drip-send-to-input-wrap"
                  onClick={() => {
                    setListOpen((open) => !open);
                    if (listOpen) {
                      setSearchFocused(false);
                    }
                  }}
                  role="combobox"
                  aria-expanded={listOpen}
                  aria-controls="drip-recipients-picker"
                >
                  <div className="drip-send-to-chips">
                    {usingIndividual ? (
                      draftIndividualContacts.map((contact) => (
                        <span className="drip-send-to-chip" key={contact.id}>
                          {contact.email}
                          <span
                            role="button"
                            tabIndex={0}
                            className="drip-send-to-chip-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              onIndividualContactsChange(
                                draftIndividualContacts.filter((item) => item.id !== contact.id),
                              );
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                onIndividualContactsChange(
                                  draftIndividualContacts.filter((item) => item.id !== contact.id),
                                );
                              }
                            }}
                            aria-label={`Remove ${contact.email}`}
                          >
                            ×
                          </span>
                        </span>
                      ))
                    ) : selectedList ? (
                      <span className="drip-send-to-chip">
                        {selectedList.name}
                        <span
                          role="button"
                          tabIndex={0}
                          className="drip-send-to-chip-remove"
                          onClick={(event) => {
                            event.stopPropagation();
                            onClearList();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              onClearList();
                            }
                          }}
                          aria-label="Remove list"
                        >
                          ×
                        </span>
                      </span>
                    ) : (
                      <span className="drip-send-to-placeholder">Select recipients</span>
                    )}
                  </div>
                  <span className="drip-send-to-toggle" aria-hidden="true">
                    {listOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  </span>
                </div>

                {listOpen ? (
                  <div
                    className="drip-recipients-picker"
                    id="drip-recipients-picker"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div
                      className="drip-recipients-picker-search"
                      onClick={(event) => {
                        event.stopPropagation();
                        (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus();
                      }}
                    >
                      <SearchIcon />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onFocus={() => {
                          setListOpen(true);
                          setSearchFocused(true);
                        }}
                        onBlur={() => setSearchFocused(false)}
                        placeholder="Search"
                        aria-label="Search lists"
                      />
                    </div>

                    <div className="drip-recipients-picker-tabs" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        className={activeTab === "recent" ? "active" : ""}
                        onClick={() => setActiveTab("recent")}
                      >
                        Recently used
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className={activeTab === "lists" ? "active" : ""}
                        onClick={() => setActiveTab("lists")}
                      >
                        <ListTabIcon />
                        Lists
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className={activeTab === "segments" ? "active" : ""}
                        onClick={() => setActiveTab("segments")}
                      >
                        <SegmentTabIcon />
                        Segments
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className={activeTab === "contacts" ? "active" : ""}
                        onClick={() => setActiveTab("contacts")}
                      >
                        <ContactTabIcon />
                        Individual contacts
                      </button>
                    </div>

                    {activeTab === "segments" ? (
                      <div className="drip-recipients-picker-empty">
                        No segments yet.{" "}
                        <Link href={PORTAL_ROUTES.segments} className="link-blue">
                          Create a segment
                        </Link>
                      </div>
                    ) : activeTab === "contacts" ? (
                      draftIndividualContacts.length === 0 ? (
                        <div className="drip-individual-empty">
                          <p className="title">There are no contacts in this list yet.</p>
                          <p className="desc">
                            Add up to {MAX_INDIVIDUAL_CONTACTS} email addresses from your contacts.
                          </p>
                          <button
                            type="button"
                            className="drip-add-contact-btn"
                            onClick={() => setAddContactsOpen(true)}
                          >
                            <span className="plus" aria-hidden="true">+</span>
                            Add contact
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="drip-recipients-unselect-all"
                            onClick={() => onIndividualContactsChange([])}
                            disabled={selectedCount === 0}
                          >
                            <span
                              className={`drip-recipient-checkbox${selectedCount > 0 ? " minus" : ""}`}
                              aria-hidden="true"
                            />
                            Unselect all options ({selectedCount}/{selectionTotal})
                          </button>

                          <div className="drip-recipients-picker-list">
                            {visibleIndividualContacts.map((contact) => {
                              const selected = draftIndividualContacts.some(
                                (item) => item.id === contact.id,
                              );
                              return (
                                <button
                                  type="button"
                                  key={contact.id}
                                  className={`drip-recipients-picker-row${selected ? " selected" : ""}`}
                                  onClick={() => toggleIndividualContact(contact)}
                                >
                                  <span
                                    className={`drip-recipient-checkbox${selected ? " checked" : ""}`}
                                    aria-hidden="true"
                                  >
                                    {selected ? (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <path d="M20 6 9 17l-5-5" />
                                      </svg>
                                    ) : null}
                                  </span>
                                  <span className="drip-recipients-picker-copy">
                                    <span className="name">{contact.fullName}</span>
                                    <span className="meta">{contact.email}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {draftIndividualContacts.length < MAX_INDIVIDUAL_CONTACTS ? (
                            <div className="drip-individual-add-wrap">
                              <button
                                type="button"
                                className="drip-add-contact-btn"
                                onClick={() => setAddContactsOpen(true)}
                              >
                                <span className="plus" aria-hidden="true">+</span>
                                Add contact
                              </button>
                            </div>
                          ) : null}
                        </>
                      )
                    ) : (
                      <>
                        <button
                          type="button"
                          className="drip-recipients-unselect-all"
                          onClick={clearRecipients}
                          disabled={selectedCount === 0}
                        >
                          <span
                            className={`drip-recipient-checkbox${selectedCount > 0 ? " minus" : ""}`}
                            aria-hidden="true"
                          />
                          Unselect all options ({selectedCount}/{selectionTotal})
                        </button>

                        <div className="drip-recipients-picker-list">
                          {visibleLists.length === 0 ? (
                            <div className="drip-recipients-picker-empty">No lists match your search.</div>
                          ) : (
                            visibleLists.map((list) => {
                              const selected = draftListId === list.id;
                              return (
                                <button
                                  type="button"
                                  key={list.id}
                                  className={`drip-recipients-picker-row${selected ? " selected" : ""}`}
                                  onClick={() => toggleList(list.id)}
                                >
                                  <span
                                    className={`drip-recipient-checkbox${selected ? " checked" : ""}`}
                                    aria-hidden="true"
                                  >
                                    {selected ? (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <path d="M20 6 9 17l-5-5" />
                                      </svg>
                                    ) : null}
                                  </span>
                                  <span className="drip-recipients-picker-copy">
                                    <span className="name">{list.name}</span>
                                    <span className="meta">{listMetaLabel(list)}</span>
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="drip-recipients-summary">
              <div className="drip-recipients-summary-top">
                <strong>{recipientCount.toLocaleString()} recipients</strong>
                <span>{remainingEmails.toLocaleString()} remaining emails</span>
              </div>
              <div className="drip-recipients-progress" aria-hidden="true">
                <div style={{ width: `${usagePct}%` }} />
              </div>
              <p>
                Send to as many recipients as you wish, within your plan limits.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="drip-sender-panel-foot">
        <button type="button" className="btn-link-purple" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-dark"
          onClick={onSave}
          disabled={!canSave}
        >
          Save
        </button>
      </div>

      {addContactsOpen ? (
        <AddIndividualContactsModal
          contacts={contacts}
          initialSelection={draftIndividualContacts}
          onClose={() => setAddContactsOpen(false)}
          onContinue={(selection) => {
            onListChange("");
            onIndividualContactsChange(selection);
            setAddContactsOpen(false);
            setActiveTab("contacts");
          }}
        />
      ) : null}
    </div>
  );
}

function SetupErrorToast({
  message,
  durationMs = 7000,
  variant = "error",
  onDone,
}: {
  message: string;
  durationMs?: number;
  variant?: "error" | "success";
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
    // Toast is remounted with a new key when shown again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div className={`drip-error-toast${variant === "success" ? " success" : ""}`} role="status">
      <div className="drip-error-toast-body">
        <span className="drip-error-toast-icon" aria-hidden="true">
          {variant === "success" ? (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="currentColor" />
              <path d="M7.5 12.5 10.5 15.5 16.5 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="currentColor" />
              <path d="M12 10.5v6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="7.4" r="1.15" fill="#fff" />
            </svg>
          )}
        </span>
        <span className="drip-error-toast-text">{message}</span>
      </div>
      <div className="drip-error-toast-progress" aria-hidden="true">
        <span style={{ animationDuration: `${durationMs}ms` }} />
      </div>
    </div>
  );
}

function ResetDesignIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function DownloadHtmlIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function ViewHtmlIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 7 4 12l4 5" />
      <path d="m16 7 4 5-4 5" />
    </svg>
  );
}

function HorizontalDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

function DesignSavedCard({
  html,
  fileName,
  compact = false,
  onEdit,
  onReset,
  onPreview,
}: {
  html: string;
  fileName: string;
  compact?: boolean;
  onEdit: () => void;
  onReset: () => void;
  onPreview: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewHtmlOpen, setViewHtmlOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [moreOpen]);

  function downloadHtml() {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = fileName.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "campaign-design";
    link.href = url;
    link.download = `${safeName}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`drip-design-saved${compact ? " drip-design-saved-compact" : ""}`}>
      <div className="drip-design-saved-head">
        <div className="drip-design-saved-title">
          {compact ? null : (
            <span className="drip-step-icon done" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          )}
          <div className="title">Design</div>
        </div>
        <div className="drip-design-saved-actions">
          <div className="drip-design-saved-more-wrap" ref={moreRef}>
            <button
              type="button"
              className={`drip-design-saved-more${moreOpen ? " active" : ""}`}
              aria-label="More options"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <HorizontalDotsIcon />
            </button>
            {moreOpen ? (
              <div className="drip-html-more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onReset();
                  }}
                >
                  <ResetDesignIcon />
                  Reset design
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    downloadHtml();
                  }}
                >
                  <DownloadHtmlIcon />
                  Download HTML
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    setViewHtmlOpen(true);
                  }}
                >
                  <ViewHtmlIcon />
                  View HTML code
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="drip-step-action" onClick={onEdit}>
            Edit design
          </button>
        </div>
      </div>
      <div className="drip-design-saved-preview">
        {html.trim() ? (
          <div className="drip-design-saved-thumb">
            <iframe title="Saved email design" sandbox="" srcDoc={html} />
            <button type="button" className="drip-design-preview-hover-btn" onClick={onPreview}>
              Preview &amp; Test
            </button>
          </div>
        ) : (
          <div className="drip-design-saved-empty">No design preview yet.</div>
        )}
      </div>

      {viewHtmlOpen ? (
        <div
          className="drip-view-html-backdrop"
          role="presentation"
          onMouseDown={() => setViewHtmlOpen(false)}
        >
          <div
            className="drip-view-html-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drip-view-html-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drip-view-html-head">
              <h3 id="drip-view-html-title">HTML code</h3>
              <button
                type="button"
                className="crm-modal-close"
                onClick={() => setViewHtmlOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <pre className="drip-view-html-code">{html || "No HTML saved yet."}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8l3 4 4-6 4 6 3-4 2 10H3L5 8Z" strokeLinejoin="round" />
    </svg>
  );
}

function PaperPlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m22 2-7 20-4-9-9-4Z" strokeLinejoin="round" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function EyePreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 9h8M8 15h5" />
      <path d="M18 7v10M15 10l3-3 3 3M15 14l3 3 3-3" />
    </svg>
  );
}

type PreviewTestTab = "preview" | "test";

function PeoplePreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="9" r="2.4" />
      <path d="M3.5 19c.8-3 3.2-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M13.5 19c.4-1.8 1.6-3 3.2-3 1.8 0 3.3 1.2 3.8 3" />
    </svg>
  );
}

function DesktopPreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function MobilePreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="8" y="3" width="8" height="18" rx="1.6" />
      <path d="M11 18h2" />
    </svg>
  );
}

function QuitWithoutSavingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l4-4-4-4" />
      <path d="M14 12H4" />
    </svg>
  );
}
function MoreDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function PreviewTestModal({
  campaign,
  html,
  contacts,
  onClose,
}: {
  campaign: DripCampaign;
  html: string;
  contacts: Contact[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PreviewTestTab>("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [contactSearch, setContactSearch] = useState("");
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [savedTestEmails, setSavedTestEmails] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testSuccessToast, setTestSuccessToast] = useState(0);
  const contactSearchRef = useRef<HTMLDivElement>(null);
  const recipientFieldRef = useRef<HTMLDivElement>(null);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return contacts.filter(
      (contact) =>
        contact.email.toLowerCase().includes(query) ||
        contact.fullName.toLowerCase().includes(query),
    );
  }, [contactSearch, contacts]);

  const selectedContact =
    contacts.find((contact) => contact.id === selectedContactId) ?? null;

  const previewSubject = applyContactVariables(campaign.subject ?? "", selectedContact);
  const previewPreviewText = applyContactVariables(campaign.previewText ?? "", selectedContact);
  const previewHtml = applyContactVariables(html, selectedContact, true);

  useEffect(() => {
    setSavedTestEmails(loadSavedTestEmails());
  }, [tab]);

  const filteredSavedEmails = useMemo(() => {
    const query = recipientDraft.trim().toLowerCase();
    const available = savedTestEmails.filter((email) => !selectedRecipients.includes(email));
    if (!query) {
      return available;
    }
    return available.filter((email) => email.includes(query));
  }, [recipientDraft, savedTestEmails, selectedRecipients]);

  useEffect(() => {
    if (!contactDropdownOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!contactSearchRef.current?.contains(event.target as Node)) {
        setContactDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [contactDropdownOpen]);

  useEffect(() => {
    if (!recipientOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!recipientFieldRef.current?.contains(event.target as Node)) {
        setRecipientOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [recipientOpen]);

  function commitRecipientEmail(raw?: string) {
    const parts = (raw ?? recipientDraft)
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const valid = parts.filter(isValidEmail);
    if (valid.length === 0) {
      return false;
    }

    setSelectedRecipients((current) => Array.from(new Set([...current, ...valid])));
    let nextSaved = savedTestEmails;
    for (const email of valid) {
      nextSaved = addSavedTestEmail(email);
    }
    setSavedTestEmails(nextSaved);
    setRecipientDraft("");
    setRecipientOpen(true);
    return true;
  }

  async function sendTestEmail() {
    commitRecipientEmail();
    const emails = Array.from(
      new Set([
        ...selectedRecipients,
        ...recipientDraft
          .split(/[\s,;]+/)
          .map((item) => item.trim().toLowerCase())
          .filter(isValidEmail),
      ]),
    );

    if (emails.length === 0) {
      setTestStatus("Add at least one recipient email.");
      return;
    }

    if (!campaign.senderId) {
      setTestStatus("Select a sender before sending a test.");
      return;
    }

    setSendingTest(true);
    setTestStatus("");

    try {
      const response = await fetch("/api/campaigns/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: campaign.senderId,
          to: emails,
          subject: previewSubject || campaign.subject || "",
          html: previewHtml || html,
          fromName: campaign.senderName,
          replyTo: campaign.replyToEnabled ? campaign.replyToEmail : undefined,
          campaignName: campaign.name,
          utmEnabled: campaign.utmEnabled,
          utmSourceEnabled: campaign.utmSourceEnabled,
          utmSource: campaign.utmSource,
          utmMediumEnabled: campaign.utmMediumEnabled,
          utmMedium: campaign.utmMedium,
          utmCampaignEnabled: campaign.utmCampaignEnabled,
          utmCampaign: campaign.utmCampaign,
        }),
      });
      const payload = (await response.json()) as { error?: string; sent?: number };
      if (!response.ok) {
        setTestStatus(payload.error || "Failed to send test email.");
        return;
      }
      setTestSuccessToast((value) => value + 1);
    } catch {
      setTestStatus("Failed to send test email.");
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="drip-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="drip-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drip-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drip-preview-head">
          <h3 id="drip-preview-title">Preview &amp; test</h3>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drip-preview-tabs">
          <button
            type="button"
            className={tab === "preview" ? "active" : undefined}
            onClick={() => setTab("preview")}
          >
            <PeoplePreviewIcon />
            Preview
          </button>
          <button
            type="button"
            className={tab === "test" ? "active" : undefined}
            onClick={() => setTab("test")}
          >
            <PaperPlaneIcon />
            Send test email
          </button>
        </div>

        <div className="drip-preview-body">
          <div className="drip-preview-left">
            <div className="drip-preview-top">
              <div className="drip-preview-meta">
                <div className="drip-preview-meta-row">
                  <span className="label">From:</span>
                  <span className="value">{campaign.senderEmail || ""}</span>
                </div>
                <div className="drip-preview-meta-row">
                  <span className="label">Subject:</span>
                  <span className="value">{previewSubject}</span>
                </div>
                <div className="drip-preview-meta-row">
                  <span className="label">Preview:</span>
                  <span className="value">{previewPreviewText}</span>
                </div>
              </div>
              <div className="drip-preview-device-row">
              <button
                type="button"
                className={device === "desktop" ? "active" : undefined}
                aria-label="Desktop preview"
                onClick={() => setDevice("desktop")}
              >
                <DesktopPreviewIcon />
              </button>
              <button
                type="button"
                className={device === "mobile" ? "active" : undefined}
                aria-label="Mobile preview"
                onClick={() => setDevice("mobile")}
              >
                <MobilePreviewIcon />
              </button>
            </div>
            </div>
            <div className={`drip-preview-frame ${device}`}>
              {previewHtml.trim() ? (
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={previewHtml}
                />
              ) : (
                <div className="drip-preview-empty">Paste HTML to preview this email.</div>
              )}
            </div>
          </div>

          <aside className="drip-preview-right">
            {tab === "preview" ? (
              <>
                <h4>Who would you like to preview this email as?</h4>
                <p>Select a contact</p>
                <div className="drip-preview-search-wrap" ref={contactSearchRef}>
                  <label className="drip-design-search drip-preview-search">
                    <SearchIcon />
                    <input
                      type="text"
                      value={contactSearch}
                      onChange={(event) => {
                        const next = event.target.value;
                        setContactSearch(next);
                        setContactDropdownOpen(next.trim().length > 0);
                      }}
                      placeholder="Search by email"
                    />
                    {contactSearch ? (
                      <button
                        type="button"
                        className="drip-preview-search-clear"
                        aria-label="Clear search"
                        onClick={() => {
                          setContactSearch("");
                          setContactDropdownOpen(false);
                          setSelectedContactId("");
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </label>
                  {contactDropdownOpen ? (
                    <div className="drip-preview-contact-dropdown">
                      {filteredContacts.length === 0 ? (
                        <div className="drip-preview-empty-list">No contacts found.</div>
                      ) : (
                        filteredContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            className={`drip-preview-contact${selectedContactId === contact.id ? " selected" : ""}`}
                            onClick={() => {
                              setSelectedContactId(contact.id);
                              setContactSearch(contact.email);
                              setContactDropdownOpen(false);
                            }}
                          >
                            {contact.email}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
                {selectedContact ? (
                  <div className="drip-preview-selected">
                    Previewing as {selectedContact.fullName || selectedContact.email}
                  </div>
                ) : null}
              </>
            ) : null}

            {tab === "test" ? (
              <>
                <h4>Who do you want to test your email with?</h4>
                <p>Send your email to one or more recipients.</p>
                <div className="drip-preview-recipients">
                  <div className="drip-preview-recipients-label">
                    Recipients <span className="drip-required-mark">*</span>
                  </div>
                  <div className="drip-preview-recipients-field" ref={recipientFieldRef}>
                    <label className="drip-design-search drip-preview-search drip-preview-recipient-input">
                      <div className="drip-preview-recipient-body">
                        <div className="drip-preview-recipient-chips">
                          {selectedRecipients[0] ? (
                            <span className="drip-preview-recipient-chip">
                              <span>{selectedRecipients[0]}</span>
                              <button
                                type="button"
                                aria-label={`Remove ${selectedRecipients[0]}`}
                                onClick={() =>
                                  setSelectedRecipients((current) => current.slice(1))
                                }
                              >
                                ×
                              </button>
                            </span>
                          ) : null}
                          {selectedRecipients.length > 1 ? (
                            <button
                              type="button"
                              className="drip-preview-recipient-more"
                              onClick={() => setRecipientOpen(true)}
                            >
                              +{selectedRecipients.length - 1}
                            </button>
                          ) : null}
                          <input
                            type="text"
                            value={recipientDraft}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (/[,;\s]$/.test(next) && isValidEmail(next.slice(0, -1))) {
                                commitRecipientEmail(next.slice(0, -1));
                                return;
                              }
                              setRecipientDraft(next);
                              setRecipientOpen(true);
                            }}
                            onFocus={() => setRecipientOpen(true)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === ",") {
                                event.preventDefault();
                                commitRecipientEmail();
                              }
                              if (event.key === "Backspace" && !recipientDraft && selectedRecipients.length > 0) {
                                setSelectedRecipients((current) => current.slice(0, -1));
                              }
                            }}
                            placeholder={selectedRecipients.length === 0 ? "Search by email" : ""}
                          />
                        </div>
                      </div>
                      <ChevronDownIcon />
                    </label>
                    {recipientOpen ? (
                      <div className="drip-preview-recipients-menu">
                        {filteredSavedEmails.length === 0 ? (
                          <div className="drip-preview-empty-list">
                            {recipientDraft.trim()
                              ? "Press Enter to save this email."
                              : "No saved emails yet. Type an address and press Enter."}
                          </div>
                        ) : (
                          filteredSavedEmails.map((email) => (
                            <div
                              key={email}
                              className="drip-preview-saved-email"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  commitRecipientEmail(email);
                                }}
                              >
                                {email}
                              </button>
                              <button
                                type="button"
                                className="drip-preview-saved-remove"
                                aria-label={`Remove ${email}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSavedTestEmails(removeSavedTestEmail(email));
                                  setSelectedRecipients((current) =>
                                    current.filter((item) => item !== email),
                                  );
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="drip-preview-send-row">
                    <button
                      type="button"
                      className="btn-dark drip-preview-send"
                      disabled={
                        sendingTest ||
                        selectedRecipients.length === 0 ||
                        !html.trim() ||
                        !campaign.senderId
                      }
                      onClick={() => {
                        void sendTestEmail();
                      }}
                    >
                      {sendingTest ? (
                        <>
                          <span className="drip-btn-spinner" aria-hidden="true" />
                          Sending...
                        </>
                      ) : (
                        "Send Test"
                      )}
                    </button>
                  </div>
                  {testStatus ? <div className="drip-preview-status error">{testStatus}</div> : null}
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </div>
      {testSuccessToast > 0 ? (
        <SetupErrorToast
          key={testSuccessToast}
          variant="success"
          message="Test sent successfully"
          onDone={() => setTestSuccessToast(0)}
        />
      ) : null}
    </div>
  );
}

function CustomHtmlEditor({
  campaign,
  contacts,
  initialHtml,
  onQuit,
  onSaveAndQuit,
}: {
  campaign: DripCampaign;
  contacts: Contact[];
  initialHtml: string;
  onQuit: () => void;
  onSaveAndQuit: (html: string) => void;
}) {
  const [htmlDraft, setHtmlDraft] = useState(() => normalizeEmailMergeTags(initialHtml));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const htmlInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [moreOpen]);

  function applyNormalizedHtml(next: string, cursor?: number) {
    setHtmlDraft(next);
    if (cursor === undefined) {
      return;
    }
    requestAnimationFrame(() => {
      const input = htmlInputRef.current;
      if (!input) {
        return;
      }
      input.setSelectionRange(cursor, cursor);
    });
  }

  function handleHtmlPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text");
    if (!pasted) {
      return;
    }

    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    const merged = htmlDraft.slice(0, start) + pasted + htmlDraft.slice(end);
    const normalized = normalizeEmailMergeTags(merged);
    if (normalized === merged) {
      return;
    }

    event.preventDefault();
    const prefix = normalizeEmailMergeTags(htmlDraft.slice(0, start) + pasted);
    applyNormalizedHtml(normalized, prefix.length);
  }

  function handleSaveAndQuit() {
    onSaveAndQuit(normalizeEmailMergeTags(htmlDraft));
  }

  return (
    <div className="drip-html-editor" role="dialog" aria-modal="true" aria-label="Custom HTML editor">
      <header className="drip-html-editor-bar">
        <div className="drip-html-editor-brand">
          <span className="drip-html-editor-logo" aria-hidden="true">
            B
          </span>
          <span className="drip-html-editor-name">{campaign.name}</span>
        </div>
        <div className="drip-html-editor-actions">
          <button
            type="button"
            className="drip-html-btn-outline"
            onClick={() => {
              setHtmlDraft((current) => normalizeEmailMergeTags(current));
              setPreviewOpen(true);
            }}
          >
            Preview &amp; Test
          </button>
          <button type="button" className="drip-html-btn-dark" onClick={handleSaveAndQuit}>
            Save &amp; Quit
          </button>
          <div className="drip-html-more-wrap" ref={moreRef}>
            <button
              type="button"
              className={`drip-html-more${moreOpen ? " active" : ""}`}
              aria-label="More options"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreDotsIcon />
            </button>
            {moreOpen ? (
              <div className="drip-html-more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onQuit();
                  }}
                >
                  <QuitWithoutSavingIcon />
                  Quit without saving
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="drip-html-editor-canvas">
        <div className="drip-html-variable-hint">
          Unsubscribe tags already in your HTML, such as{" "}
          <code>{"{{ unsubscribe }}"}</code> or{" "}
          <code>{'<a href="{{ unsubscribe }}">Unsubscribe</a>'}</code>, are
          turned into real unsubscribe links on send. If you omit them, a
          footer unsubscribe link is added automatically. Other merge tags
          become <code>{"{{ contact.FIRSTNAME }}"}</code>,{" "}
          <code>{"{{ contact.LASTNAME }}"}</code>,{" "}
          <code>{"{{ contact.EMAIL }}"}</code>, and{" "}
          <code>{"{{ contact.COMPANY }}"}</code>.
        </div>
        <textarea
          ref={htmlInputRef}
          className="drip-html-editor-input"
          value={htmlDraft}
          onChange={(event) => setHtmlDraft(event.target.value)}
          onPaste={handleHtmlPaste}
          onBlur={() => setHtmlDraft((current) => normalizeEmailMergeTags(current))}
          placeholder="Paste or write your custom HTML email here."
          spellCheck={false}
        />
      </div>

      {previewOpen ? (
        <PreviewTestModal
          campaign={campaign}
          html={htmlDraft}
          contacts={contacts}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

function DesignEmailModal({
  campaign,
  contacts,
  startInEditor = false,
  onClose,
  onSaveDesign,
}: {
  campaign: DripCampaign;
  contacts: Contact[];
  startInEditor?: boolean;
  onClose: () => void;
  onSaveDesign: (patch: Pick<DripCampaign, "hasDesign" | "designHtml" | "designSourceCampaignId">) => void;
}) {
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(startInEditor);
  const [search, setSearch] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState<{
    id: string;
    name: string;
    subject: string;
    html: string;
  } | null>(null);
  const [campaignEmails, setCampaignEmails] = useState<
    { id: string; name: string; subject: string; html: string }[]
  >([]);

  useEffect(() => {
    if (htmlEditorOpen) {
      return;
    }

    let cancelled = false;
    async function loadCampaignEmails() {
      const fromTemplates = loadEmailTemplates().map((item) => ({
        id: item.id,
        name: item.name,
        subject: item.subject,
        html: item.html,
      }));

      let fromCampaigns: { id: string; name: string; subject: string; html: string }[] =
        [];
      try {
        const campaigns = await fetchDripCampaigns();
        fromCampaigns = campaigns
          .filter((item) => item.hasDesign && item.designHtml?.trim())
          .map((item) => ({
            id: `campaign-${item.id}`,
            name: item.name,
            subject: item.subject ?? "",
            html: item.designHtml ?? "",
          }));
      } catch {
        fromCampaigns = [];
      }

      if (cancelled) {
        return;
      }

      const current =
        campaign.designHtml?.trim()
          ? [
              {
                id: `campaign-${campaign.id}`,
                name: campaign.name,
                subject: campaign.subject ?? "",
                html: campaign.designHtml,
              },
            ]
          : [];

      const merged: { id: string; name: string; subject: string; html: string }[] = [];
      const seenIds = new Set<string>();
      const seenHtml = new Set<string>();

      for (const item of [...current, ...fromTemplates, ...fromCampaigns]) {
        const htmlKey = item.html.trim();
        if (seenIds.has(item.id) || (htmlKey && seenHtml.has(htmlKey))) {
          continue;
        }
        seenIds.add(item.id);
        if (htmlKey) {
          seenHtml.add(htmlKey);
        }
        merged.push(item);
      }

      setCampaignEmails(merged);
    }

    void loadCampaignEmails();
    return () => {
      cancelled = true;
    };
  }, [
    htmlEditorOpen,
    campaign.id,
    campaign.name,
    campaign.subject,
    campaign.designHtml,
    campaign.hasDesign,
  ]);

  const filteredEmails = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return campaignEmails;
    }

    return campaignEmails.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query),
    );
  }, [campaignEmails, search]);

  function handleSaveCustomHtml(html: string) {
    const normalized = normalizeEmailMergeTags(html);
    const trimmed = normalized.trim();
    onSaveDesign({
      hasDesign: Boolean(trimmed),
      designHtml: normalized,
      designSourceCampaignId: undefined,
    });
  }

  function handleUseTemplate(templateId: string) {
    const fromList = campaignEmails.find((item) => item.id === templateId);
    const template = fromList ?? getEmailTemplate(templateId);

    const html =
      template && "html" in template
        ? template.html
        : "";

    if (!html?.trim()) {
      return;
    }

    onSaveDesign({
      hasDesign: true,
      designHtml: normalizeEmailMergeTags(html),
      designSourceCampaignId: templateId,
    });
  }

  function templateDisplayId(id: string) {
    return `#${id.replace(/^campaign-/, "")}`;
  }

  if (htmlEditorOpen) {
    return (
      <CustomHtmlEditor
        campaign={campaign}
        contacts={contacts}
        initialHtml={campaign.designHtml ?? ""}
        onQuit={onClose}
        onSaveAndQuit={handleSaveCustomHtml}
      />
    );
  }

  return (
    <div className="drip-design-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="drip-design-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drip-design-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {previewTemplate ? (
          <>
            <div className="drip-design-modal-head">
              <h3 id="drip-design-modal-title">{previewTemplate.name}</h3>
              <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>
            <div className="drip-template-preview-body">
              <div className="drip-template-preview-stage">
                <div className="drip-template-preview-id">
                  {templateDisplayId(previewTemplate.id)}
                </div>
                <div className="drip-template-preview-frame">
                  {previewTemplate.html.trim() ? (
                    <iframe title={previewTemplate.name} sandbox="" srcDoc={previewTemplate.html} />
                  ) : (
                    <div className="drip-design-saved-empty">No preview available.</div>
                  )}
                </div>
              </div>
              <div className="drip-template-preview-footer">
                <button
                  type="button"
                  className="drip-template-preview-back"
                  onClick={() => setPreviewTemplate(null)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="drip-template-preview-use"
                  onClick={() => handleUseTemplate(previewTemplate.id)}
                >
                  Use template
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="drip-design-modal-head">
              <h3 id="drip-design-modal-title">Create an email</h3>
              <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="drip-design-modal-body">
              <aside className="drip-design-sidebar">
                <button
                  type="button"
                  className="drip-design-create-btn"
                  onClick={() => setHtmlEditorOpen(true)}
                >
                  Custom HTML Code
                </button>

                <div className="drip-design-sidebar-section">
                  <div className="drip-design-sidebar-label">Your emails</div>
                  <button type="button" className="drip-design-sidebar-item active">
                    <span className="drip-design-sidebar-item-icon">
                      <PaperPlaneIcon />
                    </span>
                    <span className="drip-design-sidebar-item-label">Campaign emails</span>
                  </button>
                </div>
              </aside>

              <div className="drip-design-main">
                <div className="drip-design-main-head">
                  <h4>All saved templates</h4>
                  <p>Start building your email using a previously saved template.</p>
                </div>

                <div className="drip-design-toolbar">
                  <label className="drip-design-search">
                    <SearchIcon />
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by name or ID"
                    />
                  </label>
                  <button type="button" className="drip-design-sort">
                    <SortIcon />
                    Sort by
                  </button>
                </div>

                {filteredEmails.length === 0 ? (
                  <div className="drip-design-empty">
                    {campaignEmails.length === 0
                      ? "No saved campaign emails yet. Use Custom HTML Code to create your first design."
                      : "No campaign emails match your search."}
                  </div>
                ) : (
                  <div className="drip-design-grid">
                    {filteredEmails.map((item) => (
                      <article key={item.id} className="drip-design-card">
                        <div className="drip-design-card-thumb">
                          {item.html.trim() ? (
                            <div className="drip-design-card-iframe-wrap">
                              <iframe title={item.name} sandbox="" srcDoc={item.html} />
                            </div>
                          ) : (
                            <div className="drip-design-card-preview-copy">
                              {item.subject || "Saved email design"}
                            </div>
                          )}
                          <button
                            type="button"
                            className="drip-design-card-eye"
                            aria-label={`Preview ${item.name}`}
                            onClick={() => setPreviewTemplate(item)}
                          >
                            <EyePreviewIcon />
                          </button>
                        </div>
                        <div className="drip-design-card-meta">
                          <div className="drip-design-card-id">{templateDisplayId(item.id)}</div>
                          <div className="drip-design-card-name">{item.name}</div>
                          <button
                            type="button"
                            className="drip-design-card-use"
                            onClick={() => handleUseTemplate(item.id)}
                          >
                            Use template
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function senderDisplayName(sender: SmtpSender) {
  const formatted = formatSenderDisplayName(sender.fromEmail);
  const match = formatted.match(/^(.+?)\s*</);
  return match?.[1]?.trim() || sender.providerName;
}

const SCHEDULE_TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
];

function formatTimezoneLabel(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    return `${timeZone} ${offset.replace("GMT", "GMT ")}`.trim();
  } catch {
    return timeZone;
  }
}

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function SettingsSavedCard({
  replyToEnabled,
  attachmentEnabled,
  attachmentName,
  timezoneEnabled,
  timezone,
  utmEnabled,
  onEdit,
}: {
  replyToEnabled: boolean;
  attachmentEnabled: boolean;
  attachmentName?: string;
  timezoneEnabled: boolean;
  timezone?: string;
  utmEnabled: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="drip-settings-saved">
      <div className="drip-settings-saved-head">
        <div className="drip-settings-saved-title">Additional settings</div>
        <button type="button" className="drip-settings-saved-edit" onClick={onEdit}>
          Edit settings
        </button>
      </div>
      <div className="drip-settings-saved-card">
        <div className="drip-settings-saved-section">Sending and Tracking</div>
        <ul className="drip-settings-saved-list">
          {replyToEnabled ? (
            <li>You’re using a different ‘Reply-to’ Email address.</li>
          ) : null}
          {attachmentEnabled ? (
            <li>
              {attachmentName
                ? `An attachment is added (${attachmentName}).`
                : "An attachment is added to this campaign."}
            </li>
          ) : null}
          {timezoneEnabled ? (
            <li>Time zone is {formatTimezoneLabel(timezone || "Asia/Kolkata")}.</li>
          ) : null}
          {utmEnabled ? (
            <li>UTM tracking is on — campaign links include UTM parameters.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function HelpQuestionIcon({ help }: { help: string }) {
  return (
    <span className="drip-help-icon" title={help} aria-label={help}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.4-1.1.8-1.1 1.6" />
        <circle cx="12" cy="16.6" r="0.85" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

function SettingsToggle({
  on,
  label,
  help,
  description,
  onToggle,
  children,
}: {
  on: boolean;
  label: string;
  help: string;
  description?: string;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="drip-settings-item">
      <div className="drip-settings-row">
        <button
          type="button"
          className={`drip-toggle${on ? " on" : ""}`}
          role="switch"
          aria-checked={on}
          aria-label={label}
          onClick={onToggle}
        >
          {on ? (
            <svg className="drip-toggle-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : null}
          <span className="drip-toggle-knob" />
        </button>
        <span className="drip-settings-label">{label}</span>
        <HelpQuestionIcon help={help} />
      </div>
      {on && description ? <p className="drip-settings-desc">{description}</p> : null}
      {on && children ? <div className="drip-settings-extra">{children}</div> : null}
    </div>
  );
}

function UtmParamRow({
  label,
  param,
  value,
  onValueChange,
}: {
  label: string;
  param: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="drip-utm-param">
      <div className="drip-settings-row">
        <button
          type="button"
          className="drip-toggle on drip-toggle-locked"
          role="switch"
          aria-checked="true"
          aria-disabled="true"
          aria-label={`${label} (${param}) is required`}
          title="Required when UTM tracking is on"
          tabIndex={-1}
        >
          <svg className="drip-toggle-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span className="drip-toggle-knob" />
        </button>
        <span className="drip-settings-label drip-utm-label">
          {label} ({param})
        </span>
      </div>
      <input
        type="text"
        className="drip-utm-value"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={`${param} value`}
      />
    </div>
  );
}

function SettingsPanel({
  campaign,
  draftReplyToEnabled,
  draftReplyToEmail,
  draftAttachmentEnabled,
  draftAttachmentName,
  draftTimezoneEnabled,
  draftTimezone,
  draftUtmEnabled,
  draftUtmSource,
  draftUtmMedium,
  draftUtmCampaign,
  onClose,
  onSave,
  onReplyToEnabledChange,
  onReplyToEmailChange,
  onAttachmentEnabledChange,
  onAttachmentNameChange,
  onTimezoneEnabledChange,
  onTimezoneChange,
  onUtmEnabledChange,
  onUtmSourceChange,
  onUtmMediumChange,
  onUtmCampaignChange,
}: {
  campaign: DripCampaign;
  draftReplyToEnabled: boolean;
  draftReplyToEmail: string;
  draftAttachmentEnabled: boolean;
  draftAttachmentName: string;
  draftTimezoneEnabled: boolean;
  draftTimezone: string;
  draftUtmEnabled: boolean;
  draftUtmSource: string;
  draftUtmMedium: string;
  draftUtmCampaign: string;
  onClose: () => void;
  onSave: () => void;
  onReplyToEnabledChange: (value: boolean) => void;
  onReplyToEmailChange: (value: string) => void;
  onAttachmentEnabledChange: (value: boolean) => void;
  onAttachmentNameChange: (value: string) => void;
  onTimezoneEnabledChange: (value: boolean) => void;
  onTimezoneChange: (value: string) => void;
  onUtmEnabledChange: (value: boolean) => void;
  onUtmSourceChange: (value: string) => void;
  onUtmMediumChange: (value: string) => void;
  onUtmCampaignChange: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasChanges =
    draftReplyToEnabled !== Boolean(campaign.replyToEnabled) ||
    draftReplyToEmail.trim() !== (campaign.replyToEmail ?? "") ||
    draftAttachmentEnabled !== Boolean(campaign.attachmentEnabled) ||
    draftAttachmentName !== (campaign.attachmentName ?? "") ||
    draftTimezoneEnabled !== Boolean(campaign.timezoneEnabled) ||
    draftTimezone !== (campaign.timezone || "Asia/Kolkata") ||
    draftUtmEnabled !== Boolean(campaign.utmEnabled) ||
    draftUtmSource.trim() !== (campaign.utmSource?.trim() || DEFAULT_UTM_SOURCE) ||
    draftUtmMedium.trim() !== (campaign.utmMedium?.trim() || DEFAULT_UTM_MEDIUM) ||
    draftUtmCampaign.trim() !== (campaign.utmCampaign?.trim() || DEFAULT_UTM_CAMPAIGN);
  const replyToValid = !draftReplyToEnabled || isValidEmail(draftReplyToEmail.trim());
  const attachmentValid = !draftAttachmentEnabled || Boolean(draftAttachmentName.trim());
  const utmValid =
    !draftUtmEnabled ||
    Boolean(
      draftUtmSource.trim() && draftUtmMedium.trim() && draftUtmCampaign.trim(),
    );
  const canSave = hasChanges && replyToValid && attachmentValid && utmValid;

  return (
    <div className="drip-settings-panel">
      <div className="drip-sender-panel-head">
        <div className="drip-sender-panel-title">
          <div>
            <h3>Additional settings</h3>
          </div>
        </div>
        <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drip-settings-panel-body">
        <div className="drip-settings-section">
          <h4>Sending and Tracking</h4>

          <SettingsToggle
            on={draftReplyToEnabled}
            label="Use a different Reply-to address"
            help="Replies will go to this address instead of the sender."
            onToggle={() => onReplyToEnabledChange(!draftReplyToEnabled)}
          >
            <input
              type="email"
              className="drip-settings-email"
              value={draftReplyToEmail}
              onChange={(event) => onReplyToEmailChange(event.target.value)}
              placeholder="Enter an email address"
            />
          </SettingsToggle>

          <SettingsToggle
            on={draftAttachmentEnabled}
            label="Add an attachment"
            help="Attach a file to this campaign email."
            onToggle={() => onAttachmentEnabledChange(!draftAttachmentEnabled)}
          >
            <div className="drip-settings-file-row">
              <input
                type="text"
                className="drip-settings-file-name"
                value={draftAttachmentName}
                readOnly
                placeholder=""
              />
              <button
                type="button"
                className="drip-settings-file-btn"
                onClick={() => fileRef.current?.click()}
              >
                Select a file
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  onAttachmentNameChange(file?.name ?? "");
                }}
              />
            </div>
          </SettingsToggle>

          <SettingsToggle
            on={draftTimezoneEnabled}
            label="Change the time zone"
            help="Choose the time zone used when scheduling this campaign."
            onToggle={() => onTimezoneEnabledChange(!draftTimezoneEnabled)}
          >
            <div className="drip-schedule-select-wrap drip-settings-timezone">
              <select value={draftTimezone} onChange={(event) => onTimezoneChange(event.target.value)}>
                {SCHEDULE_TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {formatTimezoneLabel(zone)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </div>
          </SettingsToggle>

          <SettingsToggle
            on={draftUtmEnabled}
            label="Activate UTM tracking"
            help="Adds required UTM parameters to every http(s) link, then wraps the link with our click tracker."
            description="Source, medium, and campaign are required. You can edit their values for this campaign."
            onToggle={() => onUtmEnabledChange(!draftUtmEnabled)}
          >
            <UtmParamRow
              label="Source"
              param="utm_source"
              value={draftUtmSource}
              onValueChange={onUtmSourceChange}
            />
            <UtmParamRow
              label="Medium"
              param="utm_medium"
              value={draftUtmMedium}
              onValueChange={onUtmMediumChange}
            />
            <UtmParamRow
              label="Campaign"
              param="utm_campaign"
              value={draftUtmCampaign}
              onValueChange={onUtmCampaignChange}
            />
          </SettingsToggle>
        </div>
      </div>

      <div className="drip-sender-panel-foot">
        <button type="button" className="btn-link-purple" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-dark" onClick={onSave} disabled={!canSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function SequencesPanel({
  campaign,
  sequences,
  windowStart,
  windowEnd,
  emailGapMinutes,
  onClose,
  onSave,
  onChange,
  onDesign,
  onPreview,
  onResetDesign,
}: {
  campaign: DripCampaign;
  sequences: CampaignSequence[];
  windowStart: string;
  windowEnd: string;
  emailGapMinutes: number;
  onClose: () => void;
  onSave: () => void;
  onChange: (patch: {
    sequences: CampaignSequence[];
    windowStart: string;
    windowEnd: string;
    emailGapMinutes: number;
  }) => void;
  onDesign: (sequenceId: string) => void;
  onPreview: (sequenceId: string) => void;
  onResetDesign: (sequenceId: string) => void;
}) {
  function updateSequence(id: string, patch: Partial<CampaignSequence>) {
    onChange({
      sequences: sequences.map((sequence) =>
        sequence.id === id ? { ...sequence, ...patch } : sequence,
      ),
      windowStart,
      windowEnd,
      emailGapMinutes,
    });
  }

  return (
    <div className="drip-settings-panel drip-sequences-panel">
      <div className="drip-sender-panel-head">
        <div className="drip-sender-panel-title">
          <div>
            <h3>Email sequences</h3>
            <p>Each contact gets the next email after the wait you set.</p>
          </div>
        </div>
        <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drip-sequences-timing">
        <div className="crm-field">
          <label htmlFor="seq-window-start">Start sending</label>
          <input
            id="seq-window-start"
            type="time"
            value={windowStart}
            onChange={(event) =>
              onChange({
                sequences,
                windowStart: event.target.value,
                windowEnd,
                emailGapMinutes,
              })
            }
          />
        </div>
        <div className="crm-field">
          <label htmlFor="seq-window-end">Stop sending</label>
          <input
            id="seq-window-end"
            type="time"
            value={windowEnd}
            onChange={(event) =>
              onChange({
                sequences,
                windowStart,
                windowEnd: event.target.value,
                emailGapMinutes,
              })
            }
          />
        </div>
        <div className="crm-field">
          <label htmlFor="seq-gap">Gap between emails (minutes)</label>
          <input
            id="seq-gap"
            type="number"
            min={0}
            max={1440}
            value={emailGapMinutes}
            onChange={(event) =>
              onChange({
                sequences,
                windowStart,
                windowEnd,
                emailGapMinutes: Math.max(0, Number(event.target.value) || 0),
              })
            }
          />
        </div>
      </div>
      <p className="drip-sequences-hint">
        Emails for {campaign.name} only go out between the start and stop times, with the gap
        between each send.
      </p>

      <div className="drip-sequence-list">
        {sequences.map((sequence, index) => (
          <div key={sequence.id} className="drip-sequence-card">
            <div className="drip-sequence-card-head">
              <strong>Sequence {index + 1}</strong>
              {sequences.length > 1 ? (
                <button
                  type="button"
                  className="btn-link-purple"
                  onClick={() =>
                    onChange({
                      sequences: sequences.filter((item) => item.id !== sequence.id),
                      windowStart,
                      windowEnd,
                      emailGapMinutes,
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
            {index > 0 ? (
              <div className="crm-field">
                <label htmlFor={`seq-delay-${sequence.id}`}>Days after previous sequence</label>
                <input
                  id={`seq-delay-${sequence.id}`}
                  type="number"
                  min={0}
                  max={365}
                  value={sequence.delayDays}
                  onChange={(event) =>
                    updateSequence(sequence.id, {
                      delayDays: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                />
                <p className="drip-sequences-hint">
                  Use 0 to send this sequence the same day, after the previous email.
                </p>
              </div>
            ) : (
              <p className="drip-sequences-hint">Sends first when the campaign starts.</p>
            )}
            <div className="crm-field">
              <label htmlFor={`seq-subject-${sequence.id}`}>Subject</label>
              <input
                id={`seq-subject-${sequence.id}`}
                type="text"
                value={sequence.subject ?? ""}
                placeholder="Add a subject line"
                onChange={(event) => updateSequence(sequence.id, { subject: event.target.value })}
              />
            </div>
            <div className="crm-field">
              <label htmlFor={`seq-preview-${sequence.id}`}>Preview text</label>
              <input
                id={`seq-preview-${sequence.id}`}
                type="text"
                value={sequence.previewText ?? ""}
                placeholder="Optional preview text"
                onChange={(event) =>
                  updateSequence(sequence.id, { previewText: event.target.value })
                }
              />
            </div>
            {sequence.hasDesign && sequence.designHtml?.trim() ? (
              <DesignSavedCard
                compact
                html={sequence.designHtml}
                fileName={`${campaign.name}-sequence-${index + 1}`}
                onEdit={() => onDesign(sequence.id)}
                onPreview={() => onPreview(sequence.id)}
                onReset={() => onResetDesign(sequence.id)}
              />
            ) : (
              <div className="drip-sequence-design">
                <span>No design yet.</span>
                <button type="button" className="btn-soft" onClick={() => onDesign(sequence.id)}>
                  Start designing
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn-soft drip-sequence-add"
        onClick={() =>
          onChange({
            sequences: [...sequences, createEmptySequence(sequences.length)],
            windowStart,
            windowEnd,
            emailGapMinutes,
          })
        }
      >
        Add sequence
      </button>

      <div className="drip-sender-panel-foot">
        <button type="button" className="btn-link-purple" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-dark" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function buildSteps(
  campaign: DripCampaign,
  remainingEmails?: number,
  options?: { automationFollowUp?: boolean },
): SetupStep[] {
  const followUp = Boolean(options?.automationFollowUp);
  const senderDone = Boolean(campaign.senderId && campaign.senderEmail);
  const recipientsCount =
    campaign.recipientMode === "individual"
      ? campaign.individualContacts?.length ?? 0
      : campaign.listId
        ? campaign.recipients
        : 0;
  const recipientsDone = followUp
    ? true
    : Boolean(campaign.listId && campaign.listName) ||
      (campaign.individualContacts?.length ?? 0) > 0;
  const oneOne = isOneOneCampaign(campaign);
  const sequenceCount = campaignSequences(campaign).length;

  const contentSteps: SetupStep[] = oneOne
    ? [
        {
          id: "sequences",
          title: "Sequences",
          subtitle: sequencesReady(campaign)
            ? `${sequenceCount} sequence${sequenceCount === 1 ? "" : "s"} ready · ${campaign.windowStart || "09:00"}–${campaign.windowEnd || "18:00"}`
            : "Add emails, a sending window, and days between each sequence.",
          action: "Manage sequences",
          done: sequencesReady(campaign),
        },
      ]
    : [
        {
          id: "subject",
          title: "Subject",
          subtitle: campaign.subject
            ? campaign.subject
            : "Add a subject line for this campaign.",
          action: "Add subject",
          done: Boolean(campaign.subject),
        },
        {
          id: "design",
          title: "Design",
          subtitle: campaign.hasDesign
            ? campaign.designSourceCampaignId
              ? `Based on campaign #${campaign.designSourceCampaignId}`
              : "Custom HTML email saved."
            : "Create your email content.",
          action: "Start designing",
          done: Boolean(campaign.hasDesign),
        },
      ];

  return [
    {
      id: "sender",
      title: "Sender",
      subtitle: senderDone ? (
        <>
          <strong>{campaign.senderName ?? "Sender"}</strong>
          {` · ${campaign.senderEmail}`}
          {followUp ? " · same as step 1" : ""}
        </>
      ) : (
        "Select a verified sender for this campaign."
      ),
      action: followUp ? "Locked" : "Manage sender",
      done: senderDone,
      locked: followUp,
    },
    {
      id: "recipients",
      title: "Recipients",
      subtitle: followUp
        ? recipientsCount > 0
          ? `${recipientsCount.toLocaleString()} engagers so far · auto-filled from opens & clicks`
          : "Filled later automatically from opens & clicks (after the wait)"
        : recipientsDone
          ? remainingEmails !== undefined
            ? `${campaign.recipients.toLocaleString()} recipients • ${remainingEmails.toLocaleString()} remaining emails`
            : `${campaign.recipients.toLocaleString()} recipients`
          : "The people who receive your campaign",
      action: followUp
        ? recipientsCount > 0
          ? "Auto audience"
          : "Pending engagers"
        : recipientsDone
          ? "Manage recipients"
          : "Add recipients",
      done: recipientsDone,
      locked: followUp,
    },
    ...contentSteps,
    {
      id: "settings",
      title: "Additional settings",
      action: "Edit settings",
      done: false,
      noIcon: true,
    },
  ];
}

function ScheduleModal({
  campaign,
  onClose,
  onConfirm,
}: {
  campaign: DripCampaign;
  onClose: () => void;
  onConfirm: (input: { mode: "now" | "later"; scheduledFor?: string }) => Promise<void>;
}) {
  const now = new Date();
  const [mode, setMode] = useState<"now" | "later">("now");
  const [date, setDate] = useState(
    `${now.getFullYear()}-${padTime(now.getMonth() + 1)}-${padTime(now.getDate())}`,
  );
  const [hour, setHour] = useState(padTime(now.getHours()));
  const [minute, setMinute] = useState("30");
  const timezone = campaign.timezoneEnabled
    ? campaign.timezone || "Asia/Kolkata"
    : "Asia/Kolkata";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hours = Array.from({ length: 24 }, (_, index) => padTime(index));
  const minutes = ["00", "15", "30", "45"];

  async function handleConfirm() {
    setSaving(true);
    setError("");
    try {
      await onConfirm({
        mode,
        scheduledFor:
          mode === "later"
            ? zonedDateTimeToIso(date, hour, minute, timezone)
            : undefined,
      });
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Failed to launch campaign");
    }
  }

  return (
    <div className="drip-schedule-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="drip-schedule-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drip-schedule-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drip-schedule-head">
          <h3 id="drip-schedule-title">Schedule</h3>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drip-schedule-body">
          <div className="drip-schedule-question">When would you like to send the campaign?</div>

          <label className="drip-schedule-option">
            <input
              type="radio"
              name="drip-schedule-mode"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            <span>Send now</span>
          </label>

          <label className="drip-schedule-option">
            <input
              type="radio"
              name="drip-schedule-mode"
              checked={mode === "later"}
              onChange={() => setMode("later")}
            />
            <span>Schedule for later</span>
          </label>

          {mode === "later" ? (
            <div className="drip-schedule-later">
              <label className="drip-schedule-field">
                <span>Date</span>
                <div className="drip-schedule-select-wrap">
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  <ChevronDownIcon />
                </div>
              </label>

              <div className="drip-schedule-field">
                <span>Time</span>
                <div className="drip-schedule-time-row">
                  <div className="drip-schedule-select-wrap drip-schedule-time">
                    <select value={hour} onChange={(event) => setHour(event.target.value)}>
                      {hours.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                  <div className="drip-schedule-select-wrap drip-schedule-time">
                    <select value={minute} onChange={(event) => setMinute(event.target.value)}>
                      {minutes.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                </div>
                <div className="drip-schedule-tz">{formatTimezoneLabel(timezone)}</div>
              </div>
            </div>
          ) : null}
          {error ? <div className="drip-schedule-error">{error}</div> : null}
        </div>

        <div className="drip-schedule-foot">
          <button type="button" className="btn-dark" onClick={handleConfirm} disabled={saving}>
            {saving ? (
              <>
                <span className="drip-btn-spinner" aria-hidden="true" />
                {mode === "now" ? "Sending..." : "Scheduling..."}
              </>
            ) : mode === "now" ? (
              "Send now"
            ) : (
              "Schedule"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PortalCampaignDetailPage({
  campaignId,
  kind = "drip",
}: {
  campaignId: string;
  kind?: CampaignKind;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromAutomation = searchParams.get("fromAutomation") === "1";
  const automationStepId = searchParams.get("stepId");
  const queryFollowUp = searchParams.get("automationFollowUp") === "1";
  const automationRecordId = searchParams.get("automationId");
  const [campaign, setCampaign] = useState<DripCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [senderPanelOpen, setSenderPanelOpen] = useState(false);
  const [recipientsPanelOpen, setRecipientsPanelOpen] = useState(false);
  const [subjectPanelOpen, setSubjectPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [sequencesPanelOpen, setSequencesPanelOpen] = useState(false);
  const [designModalOpen, setDesignModalOpen] = useState(false);
  const [designSequenceId, setDesignSequenceId] = useState<string | null>(null);
  const [previewSequenceId, setPreviewSequenceId] = useState<string | null>(null);
  const [campaignPreviewOpen, setCampaignPreviewOpen] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const skipNameSaveRef = useRef(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSuccessMessage, setScheduleSuccessMessage] = useState("");
  const [setupErrorToast, setSetupErrorToast] = useState(0);
  const [persistError, setPersistError] = useState("");
  const [senders, setSenders] = useState<SmtpSender[]>([]);
  const [lists, setLists] = useState<CrmList[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [draftSenderId, setDraftSenderId] = useState("");
  const [draftSenderName, setDraftSenderName] = useState("");
  const [draftListId, setDraftListId] = useState("");
  const [draftIndividualContacts, setDraftIndividualContacts] = useState<
    CampaignIndividualContact[]
  >([]);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftPreviewText, setDraftPreviewText] = useState("");
  const [draftReplyToEnabled, setDraftReplyToEnabled] = useState(false);
  const [draftReplyToEmail, setDraftReplyToEmail] = useState("");
  const [draftAttachmentEnabled, setDraftAttachmentEnabled] = useState(false);
  const [draftAttachmentName, setDraftAttachmentName] = useState("");
  const [draftTimezoneEnabled, setDraftTimezoneEnabled] = useState(false);
  const [draftTimezone, setDraftTimezone] = useState("Asia/Kolkata");
  const [draftUtmEnabled, setDraftUtmEnabled] = useState(false);
  const [draftUtmSource, setDraftUtmSource] = useState(DEFAULT_UTM_SOURCE);
  const [draftUtmMedium, setDraftUtmMedium] = useState(DEFAULT_UTM_MEDIUM);
  const [draftUtmCampaign, setDraftUtmCampaign] = useState(DEFAULT_UTM_CAMPAIGN);
  const [draftSequences, setDraftSequences] = useState<CampaignSequence[]>([]);
  const [draftWindowStart, setDraftWindowStart] = useState("09:00");
  const [draftWindowEnd, setDraftWindowEnd] = useState("18:00");
  const [draftEmailGapMinutes, setDraftEmailGapMinutes] = useState(5);
  const campaignRef = useRef<DripCampaign | null>(null);

  useEffect(() => {
    if (!designModalOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.classList.add("drip-modal-open");
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("drip-modal-open");
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [designModalOpen]);

  useEffect(() => {
    async function loadContacts() {
      try {
        const response = await fetch("/api/crm/contacts");
        const data = await response.json();
        if (response.ok) {
          setContacts(data);
        }
      } catch {
        // Keep existing contacts if the request fails.
      }
    }

    void loadContacts();
  }, [campaignId]);

  const [projectCampaigns, setProjectCampaigns] = useState<DripCampaign[]>([]);
  campaignRef.current = campaign;
  const emailPlanLimit = contacts.length;
  const remainingEmails = useMemo(
    () => getRemainingEmailCredits(projectCampaigns, emailPlanLimit),
    [projectCampaigns, emailPlanLimit],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [next, all] = await Promise.all([
          fetchDripCampaign(campaignId, kind),
          fetchDripCampaigns().catch(() => [] as DripCampaign[]),
        ]);
        if (cancelled) {
          return;
        }
        if (!next && kind === "drip") {
          const fallback = await fetchDripCampaign(campaignId);
          if (cancelled) {
            return;
          }
          if (fallback && isOneOneCampaign(fallback)) {
            router.replace(portalCampaignRoute(fallback.id, "oneone"));
            return;
          }
        }
        setCampaign(next);
        setProjectCampaigns(all);
        if (next) {
          void ensureAutomationCampaignTags([next], kind).then((tagged) => {
            if (!cancelled && tagged[0]) {
              setCampaign(tagged[0]);
            }
          });
        }
      } catch {
        if (!cancelled) {
          setCampaign(null);
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
  }, [campaignId, kind, router]);

  useEffect(() => {
    return () => {
      const current = campaignRef.current;
      if (!current || current.status === "sent" || current.status === "sending" || current.status === "paused") {
        return;
      }
      void patchDripCampaign(campaignId, current, kind).catch(() => undefined);
    };
  }, [campaignId, kind]);

  useEffect(() => {
    if (!senderPanelOpen && !recipientsPanelOpen) {
      return;
    }

    async function loadOptions() {
      setOptionsLoading(true);
      try {
        if (senderPanelOpen) {
          const response = await fetch("/api/smtp/senders");
          const data = await response.json();
          if (response.ok) {
            setSenders(data);
          }
        }

        if (recipientsPanelOpen) {
          const [listsResponse, contactsResponse] = await Promise.all([
            fetch("/api/crm/lists"),
            fetch("/api/crm/contacts"),
          ]);
          const listsData = await listsResponse.json();
          const contactsData = await contactsResponse.json();
          if (listsResponse.ok) {
            setLists(
              (listsData as CrmList[]).filter((list) => list.name !== "Unsubscribe"),
            );
          }
          if (contactsResponse.ok) {
            setContacts(contactsData);
          }
        }
      } finally {
        setOptionsLoading(false);
      }
    }

    void loadOptions();
  }, [senderPanelOpen, recipientsPanelOpen]);

  useEffect(() => {
    if (!senderPanelOpen || senders.length === 0) {
      return;
    }

    const existing =
      senders.find((sender) => sender.id === campaign?.senderId) ??
      senders.find((sender) => sender.id === draftSenderId) ??
      senders[0];

    if (!existing) {
      return;
    }

    setDraftSenderId(existing.id);
    setDraftSenderName(
      campaign?.senderId === existing.id && campaign.senderName
        ? campaign.senderName
        : senderDisplayName(existing),
    );
  }, [senderPanelOpen, senders, campaign?.senderId, campaign?.senderName]);

  useEffect(() => {
    if (!recipientsPanelOpen) {
      return;
    }

    const savedIndividuals = campaign?.individualContacts ?? [];
    setDraftIndividualContacts(savedIndividuals);

    if (savedIndividuals.length > 0) {
      setDraftListId("");
      return;
    }

    setDraftListId(campaign?.listId ?? "");
  }, [recipientsPanelOpen, campaign?.listId, campaign?.individualContacts]);

  useEffect(() => {
    if (!nameEditing) {
      return;
    }
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [nameEditing]);

  const automationFollowUp = isAutomationFollowUpCampaign(campaign, queryFollowUp);

  const steps = useMemo(
    () =>
      campaign
        ? buildSteps(campaign, remainingEmails, {
            automationFollowUp,
          })
        : [],
    [campaign, remainingEmails, automationFollowUp],
  );
  const requiredStepsComplete = steps.filter((step) => !step.noIcon).every((step) => step.done);

  async function persistCampaign(patch: Partial<DripCampaign>) {
    const previous = campaignRef.current;
    setCampaign((current) => {
      if (!current) {
        return current;
      }
      const next = { ...current, ...patch };
      campaignRef.current = next;
      return next;
    });
    try {
      const updated = await patchDripCampaign(campaignId, patch, kind);
      campaignRef.current = updated;
      setCampaign(updated);
      setProjectCampaigns((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      return updated;
    } catch (error) {
      if (previous) {
        campaignRef.current = previous;
        setCampaign(previous);
      }
      throw error;
    }
  }

  function startRename() {
    skipNameSaveRef.current = false;
    setDraftName(campaignRef.current?.name ?? "");
    setNameEditing(true);
  }

  function cancelRename() {
    skipNameSaveRef.current = true;
    setNameEditing(false);
    setDraftName("");
  }

  async function saveRename() {
    if (skipNameSaveRef.current) {
      skipNameSaveRef.current = false;
      return;
    }
    const name = draftName.trim();
    if (!name) {
      cancelRename();
      return;
    }
    if (name === campaignRef.current?.name) {
      setNameEditing(false);
      return;
    }
    try {
      await persistCampaign({ name });
      setNameEditing(false);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign name",
      );
    }
  }

  function pendingDraftPatch(): Partial<DripCampaign> {
    const patch: Partial<DripCampaign> = {};

    if (nameEditing && draftName.trim()) {
      patch.name = draftName.trim();
    }

    if (senderPanelOpen && draftSenderId) {
      const selected = senders.find((sender) => sender.id === draftSenderId);
      if (selected) {
        patch.senderId = selected.id;
        patch.senderName = draftSenderName.trim() || senderDisplayName(selected);
        patch.senderEmail = selected.fromEmail;
      }
    }

    if (recipientsPanelOpen) {
      if (draftIndividualContacts.length > 0) {
        patch.recipientMode = "individual";
        patch.individualContacts = draftIndividualContacts;
        patch.recipients = draftIndividualContacts.length;
        patch.listId = "";
        patch.listName = "";
      } else {
        const selected = lists.find((list) => list.id === draftListId);
        if (selected) {
          patch.recipientMode = "list";
          patch.individualContacts = [];
          patch.listId = selected.id;
          patch.listName = selected.name;
          patch.recipients = selected.contactCount;
        }
      }
    }

    if (subjectPanelOpen && draftSubject.trim()) {
      patch.subject = draftSubject.trim();
      patch.previewText = draftPreviewText.trim();
    }

    if (sequencesPanelOpen) {
      Object.assign(
        patch,
        sequenceCampaignPatch(
          draftSequences,
          draftWindowStart,
          draftWindowEnd,
          draftEmailGapMinutes,
        ),
      );
    }

    if (settingsPanelOpen) {
      patch.replyToEnabled = draftReplyToEnabled;
      patch.replyToEmail = draftReplyToEnabled ? draftReplyToEmail.trim() : "";
      patch.attachmentEnabled = draftAttachmentEnabled;
      patch.attachmentName = draftAttachmentEnabled ? draftAttachmentName : "";
      patch.timezoneEnabled = draftTimezoneEnabled;
      patch.timezone = draftTimezoneEnabled
        ? draftTimezone.trim() || "Asia/Kolkata"
        : "Asia/Kolkata";
      patch.utmEnabled = draftUtmEnabled;
      patch.utmSourceEnabled = true;
      patch.utmSource = draftUtmSource.trim() || DEFAULT_UTM_SOURCE;
      patch.utmMediumEnabled = true;
      patch.utmMedium = draftUtmMedium.trim() || DEFAULT_UTM_MEDIUM;
      patch.utmCampaignEnabled = true;
      patch.utmCampaign = draftUtmCampaign.trim() || DEFAULT_UTM_CAMPAIGN;
    }

    return patch;
  }

  async function goBackToList(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const current = campaignRef.current;
    const draftPatch = pendingDraftPatch();
    if (current && current.status !== "sent" && current.status !== "sending" && current.status !== "paused") {
      try {
        await persistCampaign(
          Object.keys(draftPatch).length > 0
            ? draftPatch
            : current,
        );
      } catch {
        // Navigate anyway; latest successful save is already in MongoDB.
      }
    }
    router.push(
      current?.kind === "oneone" || kind === "oneone"
        ? PORTAL_ROUTES.oneone
        : PORTAL_ROUTES.drip,
    );
  }

  function closeAllPanels() {
    setSenderPanelOpen(false);
    setRecipientsPanelOpen(false);
    setSubjectPanelOpen(false);
    setSettingsPanelOpen(false);
    setSequencesPanelOpen(false);
    setDesignModalOpen(false);
    setDesignSequenceId(null);
  }

  async function handleSaveSender() {
    const selected = senders.find((sender) => sender.id === draftSenderId);
    if (!selected) {
      return;
    }

    try {
      await persistCampaign({
        senderId: selected.id,
        senderName: draftSenderName.trim() || senderDisplayName(selected),
        senderEmail: selected.fromEmail,
      });
      setSenderPanelOpen(false);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  function handleSenderEmailChange(senderId: string) {
    const selected = senders.find((sender) => sender.id === senderId);
    setDraftSenderId(senderId);
    if (selected) {
      setDraftSenderName(senderDisplayName(selected));
    }
  }

  function openSenderPanel() {
    if (automationFollowUp) {
      return;
    }
    closeAllPanels();
    setSenderPanelOpen(true);
  }

  function closeSenderPanel() {
    setSenderPanelOpen(false);
  }

  function openRecipientsPanel() {
    if (automationFollowUp) {
      return;
    }
    closeAllPanels();
    setRecipientsPanelOpen(true);
    setDraftListId(campaign?.listId ?? "");
    setDraftIndividualContacts(campaign?.individualContacts ?? []);
  }

  function closeRecipientsPanel() {
    setRecipientsPanelOpen(false);
  }

  function openSubjectPanel() {
    closeAllPanels();
    setSubjectPanelOpen(true);
    setDraftSubject(campaign?.subject ?? "");
    setDraftPreviewText(campaign?.previewText ?? "");
  }

  function closeSubjectPanel() {
    setSubjectPanelOpen(false);
  }

  function openSettingsPanel() {
    closeAllPanels();
    setSettingsPanelOpen(true);
    setDraftReplyToEnabled(Boolean(campaign?.replyToEnabled));
    setDraftReplyToEmail(campaign?.replyToEmail ?? "");
    setDraftAttachmentEnabled(Boolean(campaign?.attachmentEnabled));
    setDraftAttachmentName(campaign?.attachmentName ?? "");
    setDraftTimezoneEnabled(Boolean(campaign?.timezoneEnabled));
    setDraftTimezone(campaign?.timezone || "Asia/Kolkata");
    setDraftUtmEnabled(Boolean(campaign?.utmEnabled));
    setDraftUtmSource(campaign?.utmSource?.trim() || DEFAULT_UTM_SOURCE);
    setDraftUtmMedium(campaign?.utmMedium?.trim() || DEFAULT_UTM_MEDIUM);
    setDraftUtmCampaign(campaign?.utmCampaign?.trim() || DEFAULT_UTM_CAMPAIGN);
  }

  function closeSettingsPanel() {
    setSettingsPanelOpen(false);
  }

  function loadSequenceDrafts(source: DripCampaign) {
    setDraftSequences(campaignSequences(source));
    setDraftWindowStart(source.windowStart || "09:00");
    setDraftWindowEnd(source.windowEnd || "18:00");
    setDraftEmailGapMinutes(Math.max(0, Number(source.emailGapMinutes) || 0));
  }

  function openSequencesPanel() {
    if (!campaign) {
      return;
    }
    closeAllPanels();
    loadSequenceDrafts(campaign);
    setSequencesPanelOpen(true);
  }

  function closeSequencesPanel() {
    setSequencesPanelOpen(false);
  }

  function handleSequencesDraftChange(patch: {
    sequences: CampaignSequence[];
    windowStart: string;
    windowEnd: string;
    emailGapMinutes: number;
  }) {
    setDraftSequences(patch.sequences);
    setDraftWindowStart(patch.windowStart);
    setDraftWindowEnd(patch.windowEnd);
    setDraftEmailGapMinutes(patch.emailGapMinutes);
  }

  async function persistSequences(options?: { closePanel?: boolean }) {
    await persistCampaign(
      sequenceCampaignPatch(
        draftSequences,
        draftWindowStart,
        draftWindowEnd,
        draftEmailGapMinutes,
      ),
    );
    if (options?.closePanel) {
      setSequencesPanelOpen(false);
    }
  }

  async function handleSaveSequences() {
    try {
      await persistSequences({ closePanel: true });
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  async function handleSaveSettings() {
    try {
      await persistCampaign({
        replyToEnabled: draftReplyToEnabled,
        replyToEmail: draftReplyToEnabled ? draftReplyToEmail.trim() : "",
        attachmentEnabled: draftAttachmentEnabled,
        attachmentName: draftAttachmentEnabled ? draftAttachmentName : "",
        timezoneEnabled: draftTimezoneEnabled,
        timezone: draftTimezoneEnabled ? draftTimezone : "Asia/Kolkata",
        utmEnabled: draftUtmEnabled,
        utmSourceEnabled: true,
        utmSource: draftUtmSource.trim() || DEFAULT_UTM_SOURCE,
        utmMediumEnabled: true,
        utmMedium: draftUtmMedium.trim() || DEFAULT_UTM_MEDIUM,
        utmCampaignEnabled: true,
        utmCampaign: draftUtmCampaign.trim() || DEFAULT_UTM_CAMPAIGN,
      });
      setSettingsPanelOpen(false);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  function closeDesignModal() {
    setDesignModalOpen(false);
    setDesignSequenceId(null);
  }

  function openDesignModal(sequenceId?: string) {
    closeAllPanels();
    setDesignSequenceId(sequenceId ?? null);
    setDesignModalOpen(true);
  }

  async function openSequenceDesign(sequenceId: string) {
    try {
      await persistSequences();
      setDesignSequenceId(sequenceId);
      setDesignModalOpen(true);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  function handlePreviewSequence(sequenceId: string) {
    setPreviewSequenceId(sequenceId);
    setCampaignPreviewOpen(true);
  }

  async function handleResetSequenceDesign(sequenceId: string) {
    const sequences = draftSequences.map((sequence) =>
      sequence.id === sequenceId
        ? {
            ...sequence,
            hasDesign: false,
            designHtml: "",
            designSourceCampaignId: undefined,
          }
        : sequence,
    );
    setDraftSequences(sequences);
    try {
      await persistCampaign(
        sequenceCampaignPatch(
          sequences,
          draftWindowStart,
          draftWindowEnd,
          draftEmailGapMinutes,
        ),
      );
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  async function handleSaveDesign(
    patch: Pick<DripCampaign, "hasDesign" | "designHtml" | "designSourceCampaignId">,
  ) {
    try {
      if (designSequenceId) {
        const sequences = (draftSequences.length > 0
          ? draftSequences
          : campaign
            ? campaignSequences(campaign)
            : []
        ).map((sequence) =>
          sequence.id === designSequenceId ? { ...sequence, ...patch } : sequence,
        );
        await persistCampaign(
          sequenceCampaignPatch(
            sequences,
            draftWindowStart || campaign?.windowStart || "09:00",
            draftWindowEnd || campaign?.windowEnd || "18:00",
            Number.isFinite(draftEmailGapMinutes)
              ? draftEmailGapMinutes
              : Math.max(0, Number(campaign?.emailGapMinutes) || 0),
          ),
        );
        setDraftSequences(sequences);
        setDesignModalOpen(false);
        setDesignSequenceId(null);
        setSequencesPanelOpen(true);
        return;
      }

      await persistCampaign(patch);
      setDesignModalOpen(false);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  async function handleSaveSubject() {
    const subject = draftSubject.trim();
    if (!subject) {
      return;
    }

    try {
      await persistCampaign({
        subject,
        previewText: draftPreviewText.trim(),
      });
      setSubjectPanelOpen(false);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  function getStepWrapperClass(stepId: string) {
    if (sequencesPanelOpen) {
      if (stepId === "sequences") {
        return "drip-setup-step-expanded drip-setup-step-sequences-expanded";
      }
      if (stepId === "recipients") {
        return "drip-setup-step-behind";
      }
    }

    if (subjectPanelOpen) {
      if (stepId === "subject") {
        return "drip-setup-step-expanded drip-setup-step-subject-expanded";
      }
      if (stepId === "recipients") {
        return "drip-setup-step-behind";
      }
    }

    if (settingsPanelOpen) {
      if (stepId === "settings") {
        return "drip-setup-step-expanded drip-setup-step-settings-expanded";
      }
      if (stepId === "design" || stepId === "sequences") {
        return "drip-setup-step-behind";
      }
    }

    if (recipientsPanelOpen) {
      if (stepId === "recipients") {
        return "drip-setup-step-expanded drip-setup-step-recipients-expanded";
      }
      if (stepId === "sender") {
        return "drip-setup-step-behind";
      }
    }

    if (senderPanelOpen && stepId === "sender") {
      return "drip-setup-step-expanded drip-setup-step-sender-expanded";
    }

    return undefined;
  }

  async function handleSaveRecipients() {
    try {
      if (draftIndividualContacts.length > 0) {
        await persistCampaign({
          recipientMode: "individual",
          individualContacts: draftIndividualContacts,
          recipients: draftIndividualContacts.length,
          listId: "",
          listName: "",
        });
        setRecipientsPanelOpen(false);
        return;
      }

      const selected = lists.find((list) => list.id === draftListId);
      if (!selected) {
        return;
      }

      await persistCampaign({
        recipientMode: "list",
        individualContacts: [],
        listId: selected.id,
        listName: selected.name,
        recipients: selected.contactCount,
      });
      setRecipientsPanelOpen(false);
    } catch (error) {
      setPersistError(
        error instanceof Error ? error.message : "Failed to save campaign",
      );
    }
  }

  function handleStepAction(stepId: string) {
    if (automationFollowUp && (stepId === "sender" || stepId === "recipients")) {
      return;
    }
    if (stepId === "sender") {
      if (senderPanelOpen) {
        closeSenderPanel();
      } else {
        openSenderPanel();
      }
      return;
    }

    if (stepId === "recipients") {
      if (recipientsPanelOpen) {
        closeRecipientsPanel();
      } else {
        openRecipientsPanel();
      }
      return;
    }

    if (stepId === "subject") {
      if (subjectPanelOpen) {
        closeSubjectPanel();
      } else {
        openSubjectPanel();
      }
      return;
    }

    if (stepId === "design") {
      openDesignModal();
      return;
    }

    if (stepId === "sequences") {
      if (sequencesPanelOpen) {
        closeSequencesPanel();
      } else {
        openSequencesPanel();
      }
      return;
    }

    if (stepId === "settings") {
      if (settingsPanelOpen) {
        closeSettingsPanel();
      } else {
        openSettingsPanel();
      }
    }
  }

  if (loading) {
    return <div className="crm-empty">Loading campaign...</div>;
  }

  if (!campaign) {
    return (
      <div className="crm-empty">
        Campaign not found.{" "}
        <Link
          href={kind === "oneone" ? PORTAL_ROUTES.oneone : PORTAL_ROUTES.drip}
          className="link-blue"
        >
          Back to campaigns
        </Link>
      </div>
    );
  }

  const statusLabel =
    campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1);
  const listHref =
    campaign.kind === "oneone" || kind === "oneone"
      ? PORTAL_ROUTES.oneone
      : PORTAL_ROUTES.drip;
  const listLabel = isOneOneCampaign(campaign) ? "1-1 campaigns" : "Email campaigns";
  const sequenceSource =
    draftSequences.length > 0 ? draftSequences : campaignSequences(campaign);
  const previewSequence = previewSequenceId
    ? sequenceSource.find((sequence) => sequence.id === previewSequenceId)
    : sequenceSource[0];
  const previewCampaign = isOneOneCampaign(campaign)
    ? overlaySequenceOnCampaign(campaign, previewSequence)
    : campaign;
  const designCampaign = designSequenceId
    ? overlaySequenceOnCampaign(
        campaign,
        (draftSequences.length > 0 ? draftSequences : campaignSequences(campaign)).find(
          (sequence) => sequence.id === designSequenceId,
        ),
      )
    : campaign;

  if (campaign.status === "sent" || campaign.status === "scheduled" || campaign.status === "sending" || campaign.status === "paused") {
    return (
      <PortalCampaignReport
        campaign={campaign}
        onCampaignChange={(next) => {
          setCampaign(next);
        }}
      />
    );
  }

  return (
    <div className="drip-detail-page">
      <div className="drip-detail-breadcrumb">
        <Link href={listHref} onClick={(event) => void goBackToList(event)}>
          {listLabel}
        </Link>
        <span>/</span>
        <span>Create an email campaign</span>
      </div>

      <div className="drip-detail-head">
        <div className="drip-detail-title-wrap">
          <Link
            href={listHref}
            className="drip-back"
            aria-label="Back to campaigns"
            onClick={(event) => void goBackToList(event)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          {nameEditing ? (
            <input
              ref={nameInputRef}
              className="drip-edit-name-input"
              value={draftName}
              aria-label="Campaign name"
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => void saveRename()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <>
              <h2>{campaign.name}</h2>
              <button
                type="button"
                className="drip-edit-name"
                aria-label="Edit campaign name"
                onClick={startRename}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </>
          )}
          <div className="drip-detail-badges">
            <span className="drip-status-pill">{statusLabel}</span>
            {isAutomationCampaign(campaign) ? (
              <span className="drip-automation-badge" title="Created from Automation">
                Automation
              </span>
            ) : null}
          </div>
        </div>
        <div className="drip-detail-actions">
          <button
            type="button"
            className="btn-soft"
            onClick={() => {
              if (!requiredStepsComplete) {
                setSetupErrorToast((value) => value + 1);
                return;
              }
              setCampaignPreviewOpen(true);
            }}
          >
            Preview &amp; Test
          </button>
          {fromAutomation ? (
            <button
              type="button"
              className="btn-dark"
              onClick={() => {
                if (campaign) {
                  try {
                    sessionStorage.setItem(
                      "unified_automation_linked_campaign",
                      JSON.stringify({
                        campaignId: campaign.id,
                        kind: campaign.kind === "oneone" ? "oneone" : "drip",
                        stepId: automationStepId || undefined,
                        automationId: automationRecordId || undefined,
                        followUp: automationFollowUp || undefined,
                      }),
                    );
                  } catch {
                    /* ignore */
                  }
                }
                const stepQuery = automationStepId
                  ? `&stepId=${encodeURIComponent(automationStepId)}`
                  : "";
                const followUpQuery = automationFollowUp
                  ? "&automationFollowUp=1"
                  : "";
                const base = automationRecordId
                  ? `/portal/marketing/automation/${encodeURIComponent(automationRecordId)}`
                  : PORTAL_ROUTES.automation;
                router.push(
                  `${base}?campaignId=${encodeURIComponent(campaignId)}&kind=${encodeURIComponent(kind)}${stepQuery}${followUpQuery}`,
                );
              }}
            >
              {requiredStepsComplete
                ? "Return to Automation ✓"
                : "Return to Automation"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-dark"
              onClick={() => {
                if (!requiredStepsComplete) {
                  setSetupErrorToast((value) => value + 1);
                  return;
                }
                setScheduleOpen(true);
              }}
            >
              Schedule
            </button>
          )}
        </div>
      </div>

      <div
        className={`drip-setup-card${senderPanelOpen || recipientsPanelOpen || subjectPanelOpen || settingsPanelOpen || sequencesPanelOpen ? " drip-setup-card-active" : ""}`}
      >
        <button type="button" className="drip-lang-link">
          <CrownIcon />
          Add languages
        </button>

        <div className="drip-setup-list">
          {steps.map((step) => (
            <div key={step.id} className={getStepWrapperClass(step.id)}>
              {step.id === "sender" && senderPanelOpen ? (
                <SenderPanel
                  campaign={campaign}
                  senders={senders}
                  optionsLoading={optionsLoading}
                  draftSenderId={draftSenderId}
                  draftSenderName={draftSenderName}
                  onClose={closeSenderPanel}
                  onSave={handleSaveSender}
                  onEmailChange={handleSenderEmailChange}
                  onNameChange={setDraftSenderName}
                />
              ) : step.id === "recipients" && recipientsPanelOpen ? (
                <RecipientsPanel
                  lists={lists}
                  contacts={contacts}
                  optionsLoading={optionsLoading}
                  draftListId={draftListId}
                  draftIndividualContacts={draftIndividualContacts}
                  savedListId={campaign.listId ?? ""}
                  savedIndividualContacts={campaign.individualContacts ?? []}
                  remainingEmails={remainingEmails}
                  onClose={closeRecipientsPanel}
                  onSave={handleSaveRecipients}
                  onListChange={setDraftListId}
                  onClearList={() => setDraftListId("")}
                  onIndividualContactsChange={setDraftIndividualContacts}
                />
              ) : step.id === "subject" && subjectPanelOpen ? (
                <SubjectPanel
                  campaign={campaign}
                  draftSubject={draftSubject}
                  draftPreviewText={draftPreviewText}
                  onClose={closeSubjectPanel}
                  onSave={handleSaveSubject}
                  onSubjectChange={setDraftSubject}
                  onPreviewTextChange={setDraftPreviewText}
                />
              ) : step.id === "design" && campaign.hasDesign && !designModalOpen ? (
                <DesignSavedCard
                  html={campaign.designHtml ?? ""}
                  fileName={campaign.name}
                  onEdit={openDesignModal}
                  onPreview={() => {
                    if (!requiredStepsComplete) {
                      setSetupErrorToast((value) => value + 1);
                      return;
                    }
                    setCampaignPreviewOpen(true);
                  }}
                  onReset={() => {
                    void persistCampaign({
                      hasDesign: false,
                      designHtml: "",
                    });
                  }}
                />
              ) : step.id === "sequences" && sequencesPanelOpen ? (
                <SequencesPanel
                  campaign={campaign}
                  sequences={draftSequences}
                  windowStart={draftWindowStart}
                  windowEnd={draftWindowEnd}
                  emailGapMinutes={draftEmailGapMinutes}
                  onClose={closeSequencesPanel}
                  onSave={() => void handleSaveSequences()}
                  onChange={handleSequencesDraftChange}
                  onDesign={(sequenceId) => void openSequenceDesign(sequenceId)}
                  onPreview={handlePreviewSequence}
                  onResetDesign={(sequenceId) => void handleResetSequenceDesign(sequenceId)}
                />
              ) : step.id === "settings" && settingsPanelOpen ? (
                <SettingsPanel
                  campaign={campaign}
                  draftReplyToEnabled={draftReplyToEnabled}
                  draftReplyToEmail={draftReplyToEmail}
                  draftAttachmentEnabled={draftAttachmentEnabled}
                  draftAttachmentName={draftAttachmentName}
                  draftTimezoneEnabled={draftTimezoneEnabled}
                  draftTimezone={draftTimezone}
                  draftUtmEnabled={draftUtmEnabled}
                  draftUtmSource={draftUtmSource}
                  draftUtmMedium={draftUtmMedium}
                  draftUtmCampaign={draftUtmCampaign}
                  onClose={closeSettingsPanel}
                  onSave={handleSaveSettings}
                  onReplyToEnabledChange={setDraftReplyToEnabled}
                  onReplyToEmailChange={setDraftReplyToEmail}
                  onAttachmentEnabledChange={setDraftAttachmentEnabled}
                  onAttachmentNameChange={setDraftAttachmentName}
                  onTimezoneEnabledChange={setDraftTimezoneEnabled}
                  onTimezoneChange={setDraftTimezone}
                  onUtmEnabledChange={setDraftUtmEnabled}
                  onUtmSourceChange={setDraftUtmSource}
                  onUtmMediumChange={setDraftUtmMedium}
                  onUtmCampaignChange={setDraftUtmCampaign}
                />
              ) : step.id === "settings" &&
                (campaign.replyToEnabled ||
                  campaign.attachmentEnabled ||
                  campaign.timezoneEnabled ||
                  campaign.utmEnabled) ? (
                <SettingsSavedCard
                  replyToEnabled={Boolean(campaign.replyToEnabled)}
                  attachmentEnabled={Boolean(campaign.attachmentEnabled)}
                  attachmentName={campaign.attachmentName}
                  timezoneEnabled={Boolean(campaign.timezoneEnabled)}
                  timezone={campaign.timezone}
                  utmEnabled={Boolean(campaign.utmEnabled)}
                  onEdit={openSettingsPanel}
                />
              ) : (
                <div className="drip-setup-row">
                  {!step.noIcon ? (
                    <span className={`drip-step-icon ${step.done ? "done" : ""}`}>
                      {step.done ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="dot" />
                      )}
                    </span>
                  ) : (
                    <span className="drip-step-spacer" />
                  )}
                  <div className="drip-step-copy">
                    <div className="title">{step.title}</div>
                    {step.subtitle ? <div className="subtitle">{step.subtitle}</div> : null}
                  </div>
                  <button
                    type="button"
                    className={`drip-step-action${step.locked ? " drip-step-action-locked" : ""}`}
                    disabled={step.locked}
                    onClick={() => handleStepAction(step.id)}
                  >
                    {step.action}
                  </button>
                </div>
              )}

            </div>
          ))}
        </div>
      </div>

      {persistError ? (
        <SetupErrorToast
          message={persistError}
          onDone={() => setPersistError("")}
        />
      ) : null}

      {setupErrorToast > 0 ? (
        <SetupErrorToast
          key={setupErrorToast}
          message="Please complete all required steps to see the preview & send test email."
          onDone={() => setSetupErrorToast(0)}
        />
      ) : null}

      {designModalOpen ? (
        <DesignEmailModal
          campaign={designCampaign}
          contacts={contacts}
          startInEditor={false}
          onClose={closeDesignModal}
          onSaveDesign={handleSaveDesign}
        />
      ) : null}

      {campaignPreviewOpen &&
      (requiredStepsComplete || Boolean(previewSequenceId && previewCampaign.designHtml)) ? (
        <PreviewTestModal
          campaign={previewCampaign}
          html={previewCampaign.designHtml ?? ""}
          contacts={contacts}
          onClose={() => {
            setCampaignPreviewOpen(false);
            setPreviewSequenceId(null);
          }}
        />
      ) : null}

      {scheduleOpen && requiredStepsComplete ? (
        <ScheduleModal
          campaign={campaign}
          onClose={() => setScheduleOpen(false)}
          onConfirm={async ({ mode, scheduledFor }) => {
            const response = await fetch("/api/campaigns/launch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ campaign, mode, scheduledFor }),
            });
            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error || "Failed to launch campaign");
            }

            const updated = mergeBlastReport(campaign, data);
            setCampaign(updated);
            setScheduleOpen(false);
            router.push(`${listHref}?notice=scheduled`);
          }}
        />
      ) : null}

      {scheduleSuccessMessage ? (
        <SetupErrorToast
          variant="success"
          message={scheduleSuccessMessage}
          onDone={() => setScheduleSuccessMessage("")}
        />
      ) : null}
    </div>
  );
}
