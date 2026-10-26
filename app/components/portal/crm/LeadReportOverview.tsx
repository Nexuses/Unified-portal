"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  CONTACT_ATTRIBUTE_LABELS,
  formatCompanyDate,
  formatListDate,
  resolveContactPhotoUrl,
  type ContactCampaignStats,
  type ContactDetail,
  type ContactHistoryEvent,
  type ContactProfile,
  type ContactProfileNote,
  type ContactProfileTimelineItem,
} from "@/lib/crm";
import {
  formatEngagementDevice,
  isEngagementDevice,
} from "@/lib/engagement-client-meta";
import {
  LEAD_STATUS_ORDER,
  LEAD_STATUS_UI,
  getLeadStatusLabel,
  normalizeLeadStatus,
  scoreForLeadStatus,
  starsForLeadStatus,
} from "@/lib/lead-status";

function applyLeadStage(
  profile: ContactProfile,
  stageValue: string,
): ContactProfile {
  const label = stageValue.trim()
    ? getLeadStatusLabel(stageValue)
    : "";
  if (!label) {
    return { ...profile, leadStage: "" };
  }
  const score = scoreForLeadStatus(label);
  const stars = starsForLeadStatus(label);
  return {
    ...profile,
    leadStage: label,
    score,
    qualification: {
      ...(profile.qualification || {}),
      overallScore: stars,
    },
  };
}
import {
  portalCampaignRoute,
  portalCompanyRoute,
  portalListRoute,
} from "@/lib/portal-nav";

function timelineKindLabel(type: ContactHistoryEvent["type"] | "note") {
  switch (type) {
    case "campaign_sent":
      return "Sent";
    case "campaign_delivered":
      return "Delivered";
    case "campaign_opened":
      return "Opened";
    case "campaign_clicked":
      return "Clicked";
    case "campaign_unsubscribed":
      return "Unsubscribed";
    case "company_associated":
      return "Company";
    case "list_added":
      return "List";
    case "import":
      return "Import";
    case "note":
      return "Note";
    default:
      return "Activity";
  }
}

function timelineKindClass(type: ContactHistoryEvent["type"] | "note") {
  switch (type) {
    case "campaign_sent":
    case "campaign_delivered":
      return "is-sent";
    case "campaign_opened":
      return "is-opened";
    case "campaign_clicked":
      return "is-clicked";
    case "campaign_unsubscribed":
      return "is-unsubscribed";
    case "company_associated":
      return "is-company";
    case "list_added":
      return "is-list";
    case "import":
      return "is-import";
    default:
      return "";
  }
}

export type LeadSectionKey =
  | "identity"
  | "contactDetails"
  | "crmIntel"
  | "companyContext"
  | "qualification"
  | "meeting"
  | "pipeline"
  | "about"
  | "brief"
  | "news"
  | "timeline"
  | "notes"
  | "information";

type DraftCore = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  attributes: Record<string, string>;
};

function display(value?: string | number | null) {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
}

function digitsOnly(phone?: string) {
  return (phone || "").replace(/\D/g, "");
}

function whatsappHref(phone?: string) {
  const digits = digitsOnly(phone);
  return digits ? `https://wa.me/${digits}` : "";
}

function ensureHttp(url?: string) {
  const value = (url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function toDatetimeLocalValue(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function newNoteId() {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function initialOf(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconLinkedIn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}
function IconZap() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      <path d="M2 12h20" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function RemoveIconButton({
  onClick,
  label = "Remove",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="lr-icon-remove"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <IconTrash />
    </button>
  );
}

function IconStar({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

/** Map stored score (0–5 stars, or legacy 0–100) to a 0–5 star count. */
function scoreToStars(raw?: number | null) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 5) return Math.max(0, Math.min(5, Math.round(n)));
  return Math.max(0, Math.min(5, Math.round(n / 20)));
}

/** Pipeline ring uses 0–100; overall score is stored as 0–5 stars. */
function starsToPoints(stars: number) {
  return Math.max(0, Math.min(5, Math.round(stars))) * 20;
}

function ScoreStars({ count }: { count: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(count)));
  return (
    <div className="lr-stars" aria-label={`${filled} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < filled ? "is-on" : ""}>
          <IconStar filled={i < filled} />
        </span>
      ))}
    </div>
  );
}

function ReadMoreText({
  children,
  className = "lr-desc",
  lines = 4,
}: {
  children: ReactNode;
  className?: string;
  lines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (expanded) {
      setOverflows(true);
      return;
    }
    const check = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(check)
        : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [children, expanded, lines]);

  const clampStyle = expanded
    ? undefined
    : ({
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      } as CSSProperties);

  return (
    <div className="lr-readmore">
      <div ref={textRef} className={className} style={clampStyle}>
        {children}
      </div>
      {overflows || expanded ? (
        <button
          type="button"
          className="lr-readmore-btn"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

const TIMELINE_PREVIEW_COUNT = 4;

function ProfileAvatar({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl && failedUrl !== photoUrl);
  return (
    <div className="lr-avatar-wrap">
      <div className={`lr-avatar${showPhoto ? " has-photo" : ""}`}>
        {showPhoto ? (
          <img
            src={photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            onError={() => setFailedUrl(photoUrl || null)}
          />
        ) : (
          initialOf(name)
        )}
      </div>
      <span className="lr-avatar-badge" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 8.2 6.4 11l6.1-6.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score || 0)));
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="lr-score" aria-label={`Score ${clamped}`}>
      <svg className="lr-score-svg" viewBox="0 0 64 64">
        <circle className="lr-score-track" cx="32" cy="32" r={radius} />
        <circle
          className="lr-score-value"
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="lr-score-label">
        <strong>{clamped}</strong>
        <span>Score</span>
      </div>
    </div>
  );
}

const SECTION_EDIT_TITLE: Record<LeadSectionKey, string> = {
  identity: "Profile",
  contactDetails: "Contact Details",
  crmIntel: "CRM Intelligence",
  companyContext: "Company Context",
  qualification: "Lead Qualification",
  meeting: "Meeting",
  pipeline: "Pipeline Stage",
  about: "About",
  brief: "Strategic Meeting Brief",
  news: "Company News & Updates",
  timeline: "Engagement Timeline",
  notes: "Internal Notes",
  information: "Information",
};

function Card({
  title,
  section,
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  edit,
  hideHead = false,
  readOnly = false,
  children,
  className = "",
  bodyClassName = "",
  titleClassName = "",
}: {
  title?: string;
  section?: LeadSectionKey;
  editing: LeadSectionKey | null;
  saving: boolean;
  onEdit: (section: LeadSectionKey) => void;
  onCancel: () => void;
  onSave: () => void;
  /** Form shown in the edit modal for this section. */
  edit?: ReactNode;
  /** Skip the title/Edit header row (caller places Edit inline). */
  hideHead?: boolean;
  readOnly?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  titleClassName?: string;
}) {
  const canEdit = Boolean(section && edit && !readOnly);
  const isEditing = Boolean(canEdit && editing === section);
  const modalTitle = title || (section ? SECTION_EDIT_TITLE[section] : "Edit");
  const showHead = !hideHead && Boolean(title || (!readOnly && section));

  useEffect(() => {
    if (!isEditing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onCancel();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isEditing, saving, onCancel]);

  return (
    <>
      <div className={`apple-card lr-card ${className}`.trim()}>
        {showHead ? (
          <div className="lr-card-head">
            {title ? (
              <h3 className={`lr-card-title ${titleClassName}`.trim()}>
                {title}
              </h3>
            ) : (
              <span />
            )}
            {canEdit ? (
              <button
                type="button"
                className="btn-soft lr-edit-btn"
                disabled={Boolean(editing) || saving}
                onClick={() => onEdit(section!)}
              >
                Edit
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={`lr-card-body ${bodyClassName}`.trim()}>{children}</div>
      </div>
      {isEditing ? (
        <div
          className="crm-modal-backdrop lr-edit-modal-backdrop"
          onClick={() => {
            if (!saving) onCancel();
          }}
        >
          <div
            className="crm-modal lr-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`lr-edit-${section}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id={`lr-edit-${section}`}>Edit {modalTitle}</h3>
                <p>Update this section, then save your changes.</p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                disabled={saving}
                onClick={onCancel}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body lr-edit-modal-body">{edit}</div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                disabled={saving}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={saving}
                onClick={onSave}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function IconRow({
  tone,
  icon,
  label,
  value,
  href,
}: {
  tone: string;
  icon: ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="lr-icon-row">
      <div className={`lr-icon-box ${tone}`}>{icon}</div>
      <div className="lr-icon-copy">
        <p className="lr-mini-label">{label}</p>
        {href ? (
          <a className="lr-mini-value" href={href} target="_blank" rel="noreferrer">
            {display(value)}
          </a>
        ) : (
          <p className="lr-mini-value">{display(value)}</p>
        )}
      </div>
    </div>
  );
}

function YesNoBadge({ yes }: { yes: boolean }) {
  return (
    <span className={`lr-yn ${yes ? "is-yes" : "is-no"}`}>{yes ? "Yes" : "No"}</span>
  );
}

function YesNoToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="lr-seg-toggle" role="group" aria-label="Yes or no">
      <button
        type="button"
        className={!value ? "is-on" : ""}
        aria-pressed={!value}
        onClick={() => onChange(false)}
      >
        No
      </button>
      <button
        type="button"
        className={value ? "is-on is-yes" : ""}
        aria-pressed={value}
        onClick={() => onChange(true)}
      >
        Yes
      </button>
    </div>
  );
}

type Props = {
  contact: ContactDetail;
  editing: LeadSectionKey | null;
  saving: boolean;
  draftProfile: ContactProfile;
  draftCore: DraftCore;
  setDraftCore: Dispatch<SetStateAction<DraftCore>>;
  patchProfile: (updater: (current: ContactProfile) => ContactProfile) => void;
  beginEdit: (section: LeadSectionKey) => void;
  cancelEdit: () => void;
  saveSection: () => void;
  historyEvents: ContactHistoryEvent[];
  campaignStats: ContactCampaignStats;
  readOnly?: boolean;
};

export default function LeadReportOverview({
  contact,
  editing,
  saving,
  draftProfile,
  draftCore,
  setDraftCore,
  patchProfile,
  beginEdit,
  cancelEdit,
  saveSection,
  historyEvents,
  campaignStats,
  readOnly = false,
}: Props) {
  const viewProfile = editing ? draftProfile : contact.profile || {};
  const viewCore = editing
    ? draftCore
    : {
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        email: contact.email || "",
        companyName: contact.companyName || "",
        attributes: contact.attributes || {},
      };

  const fullName =
    `${viewCore.firstName} ${viewCore.lastName}`.trim() || contact.fullName;
  const meetingDate = viewProfile.meeting?.at
    ? new Date(viewProfile.meeting.at)
    : null;
  const wa = whatsappHref(viewProfile.phone);
  const linkedin = ensureHttp(viewProfile.linkedinUrl);
  const companyWebsite = ensureHttp(viewProfile.company?.website);
  const companyLinkedin = ensureHttp(viewProfile.company?.linkedinUrl);
  const score = (() => {
    if (viewProfile.score != null && viewProfile.score !== undefined) {
      const n = Number(viewProfile.score);
      return Number.isFinite(n) ? n : 0;
    }
    const overall = viewProfile.qualification?.overallScore;
    if (overall == null) return 0;
    const n = Number(overall);
    if (!Number.isFinite(n)) return 0;
    return n <= 5 ? starsToPoints(n) : n;
  })();
  const stageStatus = normalizeLeadStatus(viewProfile.leadStage);

  const engagementEntries = (() => {
    const notes = (viewProfile.timeline || []).map((item, noteIndex) => ({
      source: "note" as const,
      id: item.id,
      at: item.at || "",
      type: "note" as const,
      title: "",
      body: item.body || "",
      event: null as ContactHistoryEvent | null,
      noteIndex,
    }));
    const history = historyEvents.map((event) => ({
      source: "history" as const,
      id: event.id,
      at: event.at || "",
      type: event.type,
      title: event.title || "",
      body: event.description || "",
      event,
      noteIndex: -1,
    }));
    return [...notes, ...history].sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });
  })();
  const stageLabel = getLeadStatusLabel(stageStatus);
  const stageUi = LEAD_STATUS_UI[stageStatus];
  const stageIndex = LEAD_STATUS_ORDER.indexOf(stageStatus);
  const starCount = scoreToStars(
    viewProfile.qualification?.overallScore ?? score,
  );
  const photoUrl = resolveContactPhotoUrl(viewProfile);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const visibleEngagement = timelineExpanded
    ? engagementEntries
    : engagementEntries.slice(0, TIMELINE_PREVIEW_COUNT);
  const hiddenEngagementCount = Math.max(
    0,
    engagementEntries.length - TIMELINE_PREVIEW_COUNT,
  );

  return (
    <div className="lr-shell">
      <div className="grid grid-cols-12 gap-5 max-w-[1600px] mx-auto w-full">
        {/* Left column */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-5">
          <Card
            section="identity"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            bodyClassName="lr-hero-body"
            edit={
              <div className="lr-edit-stack">
                <label>
                  First name
                  <input
                    className="lr-input"
                    value={viewCore.firstName}
                    onChange={(e) =>
                      setDraftCore((c) => ({ ...c, firstName: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Last name
                  <input
                    className="lr-input"
                    value={viewCore.lastName}
                    onChange={(e) =>
                      setDraftCore((c) => ({ ...c, lastName: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Title
                  <input
                    className="lr-input"
                    value={viewProfile.title || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, title: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Company
                  <input
                    className="lr-input"
                    value={viewCore.companyName}
                    onChange={(e) =>
                      setDraftCore((c) => ({ ...c, companyName: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Location
                  <input
                    className="lr-input"
                    value={viewProfile.location || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, location: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Profile photo URL
                  <input
                    className="lr-input"
                    type="url"
                    placeholder="https://…"
                    value={viewProfile.photoUrl || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, photoUrl: e.target.value }))
                    }
                  />
                </label>
              </div>
            }
          >
            <div className="lr-hero">
              <ProfileAvatar name={fullName} photoUrl={photoUrl} />
              <h2 className="lr-hero-name">{fullName}</h2>
              <p className="lr-hero-title">{display(viewProfile.title)}</p>
              <p className="lr-hero-company">
                {display(viewCore.companyName).toUpperCase()}
              </p>
              {viewProfile.location ? (
                <div className="lr-hero-loc">
                  <IconMapPin />
                  <span>{viewProfile.location}</span>
                </div>
              ) : null}
            </div>
            <div className="lr-hero-actions">
              {wa ? (
                <a className="lr-btn-wa" href={wa} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              ) : (
                <span className="lr-btn-wa is-disabled">WhatsApp</span>
              )}
              <a className="lr-btn-email" href={`mailto:${viewCore.email}`}>
                Email
              </a>
            </div>
            {linkedin ? (
              <a
                className="lr-btn-li"
                href={linkedin}
                target="_blank"
                rel="noreferrer"
              >
                <IconLinkedIn />
                LinkedIn Profile
              </a>
            ) : (
              <span className="lr-btn-li is-disabled">
                <IconLinkedIn />
                LinkedIn Profile
              </span>
            )}
          </Card>

          <Card
            title="Contact Details"
            section="contactDetails"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              <div className="lr-edit-stack">
                <label>
                  Email
                  <input
                    className="lr-input"
                    value={viewCore.email}
                    onChange={(e) =>
                      setDraftCore((c) => ({ ...c, email: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Phone
                  <input
                    className="lr-input"
                    value={viewProfile.phone || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, phone: e.target.value }))
                    }
                  />
                </label>
                <label>
                  LinkedIn
                  <input
                    className="lr-input"
                    value={viewProfile.linkedinUrl || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, linkedinUrl: e.target.value }))
                    }
                  />
                </label>
              </div>
            }
          >
            <div className="section-tint space-y-1">
              <IconRow
                tone="tone-blue"
                icon={<IconMail />}
                label="Email"
                value={viewCore.email}
                href={`mailto:${viewCore.email}`}
              />
              <IconRow
                tone="tone-green"
                icon={<IconPhone />}
                label="Phone"
                value={viewProfile.phone || ""}
              />
              <IconRow
                tone="tone-sky"
                icon={<IconLinkedIn />}
                label="LinkedIn"
                value={viewProfile.linkedinUrl || ""}
                href={linkedin || undefined}
              />
            </div>
          </Card>

          <Card
            title="CRM Intelligence"
            section="crmIntel"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              <div className="lr-edit-stack">
                <label>
                  Lead stage
                  <select
                    className="lr-input"
                    value={viewProfile.leadStage || ""}
                    onChange={(e) =>
                      patchProfile((p) => applyLeadStage(p, e.target.value))
                    }
                  >
                    <option value="">Select</option>
                    {LEAD_STATUS_ORDER.map((s) => (
                      <option key={s} value={getLeadStatusLabel(s)}>
                        {getLeadStatusLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Source
                  <input
                    className="lr-input"
                    value={viewProfile.source || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, source: e.target.value }))
                    }
                  />
                </label>
              </div>
            }
          >
            <div className="section-tint space-y-1">
              <IconRow
                tone="tone-red"
                icon={<IconZap />}
                label="Lead Stage"
                value={stageLabel}
              />
              <IconRow
                tone="tone-blue"
                icon={<IconSend />}
                label="Source"
                value={viewProfile.source || ""}
              />
              <IconRow
                tone="tone-slate"
                icon={<IconClock />}
                label="Created"
                value={formatCompanyDate(contact.createdAt)}
              />
            </div>
          </Card>

          <Card
            title="Company Context"
            section="companyContext"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              <div className="lr-edit-stack">
                {(
                  [
                    ["industry", "Industry"],
                    ["employees", "Employees"],
                    ["location", "Location"],
                    ["website", "Website"],
                    ["linkedinUrl", "LinkedIn"],
                    ["description", "Description"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    {key === "description" ? (
                      <textarea
                        className="lr-input"
                        rows={4}
                        value={viewProfile.company?.[key] || ""}
                        onChange={(e) =>
                          patchProfile((p) => ({
                            ...p,
                            company: { ...p.company, [key]: e.target.value },
                          }))
                        }
                      />
                    ) : (
                      <input
                        className="lr-input"
                        value={viewProfile.company?.[key] || ""}
                        onChange={(e) =>
                          patchProfile((p) => ({
                            ...p,
                            company: { ...p.company, [key]: e.target.value },
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
            }
          >
            <div className="space-y-4">
              <div className="section-tint space-y-1">
                <IconRow
                  tone="tone-blue"
                  icon={<IconBuilding />}
                  label="Industry"
                  value={viewProfile.company?.industry || ""}
                />
                <IconRow
                  tone="tone-indigo"
                  icon={<IconUser />}
                  label="Employees"
                  value={viewProfile.company?.employees || ""}
                />
                <IconRow
                  tone="tone-green"
                  icon={<IconMapPin />}
                  label="Location"
                  value={viewProfile.company?.location || ""}
                />
                <IconRow
                  tone="tone-indigo"
                  icon={<IconGlobe />}
                  label="Website"
                  value={
                    (viewProfile.company?.website || "").replace(
                      /^https?:\/\//i,
                      "",
                    ) || ""
                  }
                  href={companyWebsite || undefined}
                />
                <IconRow
                  tone="tone-sky"
                  icon={<IconLinkedIn />}
                  label="LinkedIn"
                  value={viewProfile.company?.linkedinUrl || ""}
                  href={companyLinkedin || undefined}
                />
              </div>
              {viewProfile.company?.description ? (
                <div className="section-tint mt-1">
                  <p className="lr-mini-label" style={{ marginBottom: 8 }}>
                    Company Description
                  </p>
                  <ReadMoreText lines={4}>
                    {viewProfile.company.description}
                  </ReadMoreText>
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            title="Lead Qualification"
            section="qualification"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              <>
                <div className="lr-edit-panel">
                  {(
                    [
                      ["decisionMaker", "Decision maker"],
                      ["viewedDeck", "Viewed solution deck"],
                      ["haveBudget", "Have budget"],
                      ["need", "Need"],
                    ] as const
                  ).map(([key, label]) => {
                    const yes = Boolean(viewProfile.qualification?.[key]);
                    return (
                      <div key={key} className="lr-qual-row">
                        <span className="lr-qual-label">{label}</span>
                        <YesNoToggle
                          value={yes}
                          onChange={(next) =>
                            patchProfile((p) => ({
                              ...p,
                              qualification: {
                                ...p.qualification,
                                [key]: next,
                              },
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="lr-edit-panel lr-score-edit">
                  <div className="lr-score-view">
                    <div className="lr-score-view-top">
                      <div className="lr-score-view-label">
                        <div className="lr-icon-box tone-blue" aria-hidden="true">
                          <IconStar />
                        </div>
                        <p className="lr-qual-label">Overall score</p>
                      </div>
                      <label className="lr-score-field-control">
                        <input
                          className="lr-input lr-score-input"
                          type="number"
                          min={0}
                          max={5}
                          step={1}
                          inputMode="numeric"
                          aria-label="Overall score"
                          value={
                            viewProfile.qualification?.overallScore == null
                              ? ""
                              : scoreToStars(
                                  viewProfile.qualification.overallScore,
                                )
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            const next =
                              raw === ""
                                ? undefined
                                : Math.max(
                                    0,
                                    Math.min(5, Math.round(Number(raw))),
                                  );
                            patchProfile((p) => ({
                              ...p,
                              qualification: {
                                ...p.qualification,
                                overallScore: next,
                              },
                              score:
                                next === undefined
                                  ? p.score
                                  : starsToPoints(next),
                            }));
                          }}
                        />
                        <span className="lr-score-hint">0–5</span>
                      </label>
                    </div>
                    <ScoreStars count={starCount} />
                  </div>
                </div>
              </>
            }
          >
            <div className="section-tint">
              {(
                [
                  ["decisionMaker", "Decision maker"],
                  ["viewedDeck", "Viewed solution deck"],
                  ["haveBudget", "Have budget"],
                  ["need", "Need"],
                ] as const
              ).map(([key, label]) => {
                const yes = Boolean(viewProfile.qualification?.[key]);
                return (
                  <div key={key} className="lr-qual-row">
                    <span className="lr-qual-label">{label}</span>
                    <YesNoBadge yes={yes} />
                  </div>
                );
              })}
            </div>
            <div className="section-tint mt-4">
              <div className="lr-score-view">
                <div className="lr-score-view-top">
                  <div className="lr-score-view-label">
                    <div className="lr-icon-box tone-blue" aria-hidden="true">
                      <IconStar />
                    </div>
                    <p className="lr-qual-label">Overall score</p>
                  </div>
                </div>
                <ScoreStars count={starCount} />
              </div>
            </div>
          </Card>
        </div>

        {/* Center column */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-5">
          <Card
            section="meeting"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            hideHead
            className="lr-meeting-card"
            bodyClassName="lr-meeting-body-wrap"
            edit={
              <div className="lr-edit-stack">
                <label>
                  Date & time
                  <input
                    className="lr-input"
                    type="datetime-local"
                    value={toDatetimeLocalValue(viewProfile.meeting?.at)}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        meeting: {
                          ...p.meeting,
                          at: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : "",
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Timezone
                  <input
                    className="lr-input"
                    value={viewProfile.meeting?.timezone || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        meeting: { ...p.meeting, timezone: e.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  Channel
                  <input
                    className="lr-input"
                    value={viewProfile.meeting?.channel || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        meeting: { ...p.meeting, channel: e.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  Title
                  <input
                    className="lr-input"
                    value={viewProfile.meeting?.title || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        meeting: { ...p.meeting, title: e.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  Join URL
                  <input
                    className="lr-input"
                    value={viewProfile.meeting?.joinUrl || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        meeting: { ...p.meeting, joinUrl: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            }
          >
            {meetingDate && !Number.isNaN(meetingDate.getTime()) ? (
              <div className="lr-meeting">
                <div className="lr-meeting-date">
                  <span className="d">{meetingDate.getDate()}</span>
                  <span className="m">
                    {meetingDate
                      .toLocaleString(undefined, { month: "short" })
                      .toUpperCase()}
                  </span>
                  <span className="y">{meetingDate.getFullYear()}</span>
                </div>
                <div className="lr-meeting-main">
                  <div className="lr-meeting-meta">
                    <span className="lr-dot" />
                    <span>
                      {meetingDate.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                      {viewProfile.meeting?.timezone
                        ? ` ${viewProfile.meeting.timezone}`
                        : ""}
                      {viewProfile.meeting?.channel ? (
                        <>
                          {" · "}
                          <IconVideo /> {viewProfile.meeting.channel}
                        </>
                      ) : null}
                    </span>
                  </div>
                  <h3>{display(viewProfile.meeting?.title)}</h3>
                  <p>{display(viewProfile.meeting?.channel)}</p>
                </div>
                <div className="lr-meeting-side">
                  {!readOnly ? (
                    <button
                      type="button"
                      className="btn-soft lr-edit-btn"
                      disabled={Boolean(editing) || saving}
                      onClick={() => beginEdit("meeting")}
                    >
                      Edit
                    </button>
                  ) : null}
                  {viewProfile.meeting?.joinUrl ? (
                    <a
                      className="lr-join"
                      href={ensureHttp(viewProfile.meeting.joinUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconVideo />
                      Join
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="lr-meeting-empty">
                <p className="lr-empty">No meeting scheduled.</p>
                {!readOnly ? (
                  <button
                    type="button"
                    className="btn-soft lr-edit-btn"
                    disabled={Boolean(editing) || saving}
                    onClick={() => beginEdit("meeting")}
                  >
                    Edit
                  </button>
                ) : null}
              </div>
            )}
          </Card>

          <Card
            title="Pipeline Stage"
            section="pipeline"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            bodyClassName="lr-pipeline-body"
            edit={
              <div className="lr-edit-stack">
                <label>
                  Score
                  <input
                    className="lr-input"
                    type="number"
                    min={0}
                    max={100}
                    value={viewProfile.score ?? ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        score:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <div>
                  <p className="lr-mini-label" style={{ marginBottom: 10 }}>
                    Lead stage
                  </p>
                  <div className="lr-pipeline-edit-stages">
                    {LEAD_STATUS_ORDER.map((s) => {
                      const ui = LEAD_STATUS_UI[s];
                      const label = getLeadStatusLabel(s);
                      const isCurrent = label === stageLabel;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`lr-pipeline-stage-btn ${
                            isCurrent ? `is-on ${ui.textClass}` : ""
                          }`}
                          onClick={() =>
                            patchProfile((p) => applyLeadStage(p, label))
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            }
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-black ${stageUi.textClass}`}>
                    {stageLabel}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-sm font-bold rounded-md ${stageUi.badgeClass}`}
                  >
                    Active
                  </span>
                </div>
              </div>
              <ScoreRing score={score} />
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="min-w-max">
                <div
                  className="grid gap-2 h-2 mb-3"
                  style={{
                    gridTemplateColumns: `repeat(${LEAD_STATUS_ORDER.length}, minmax(100px, 1fr))`,
                  }}
                >
                  {LEAD_STATUS_ORDER.map((s, index) => {
                    const ui = LEAD_STATUS_UI[s];
                    const isCurrent = index === stageIndex;
                    return (
                      <div
                        key={s}
                        className={`rounded-full transition-all ${
                          isCurrent
                            ? ui.activeSegmentClass
                            : ui.inactiveSegmentClass
                        }`}
                      />
                    );
                  })}
                </div>
                <div
                  className="grid gap-2 px-0.5"
                  style={{
                    gridTemplateColumns: `repeat(${LEAD_STATUS_ORDER.length}, minmax(100px, 1fr))`,
                  }}
                >
                  {LEAD_STATUS_ORDER.map((s, index) => {
                    const ui = LEAD_STATUS_UI[s];
                    const isCurrent = index === stageIndex;
                    const label = getLeadStatusLabel(s);
                    return (
                      <span
                        key={s}
                        className={`text-[11px] leading-tight text-center whitespace-normal break-words ${
                          isCurrent
                            ? `font-black underline underline-offset-2 ${ui.textClass}`
                            : "font-bold text-gray-400"
                        }`}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card
            section="about"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            className="lr-about-card"
            bodyClassName="lr-about-grid"
            edit={
              <div className="lr-edit-stack">
                <label>
                  About {viewCore.firstName || "contact"}
                  <textarea
                    className="lr-input"
                    rows={5}
                    value={viewProfile.about || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({ ...p, about: e.target.value }))
                    }
                  />
                </label>
                <label>
                  About {(viewCore.companyName || "company").toUpperCase()}
                  <textarea
                    className="lr-input"
                    rows={5}
                    value={viewProfile.company?.description || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        company: { ...p.company, description: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            }
          >
            <div className="lr-about-person">
              <div className="lr-about-head">
                <div className="lr-icon-box tone-blue">
                  <IconUser />
                </div>
                <h3>About {viewCore.firstName || "contact"}</h3>
              </div>
              <ReadMoreText lines={4}>{display(viewProfile.about)}</ReadMoreText>
              <div className="lr-tags">
                {viewProfile.company?.industry ? (
                  <span className="lr-tag blue">
                    {viewProfile.company.industry}
                  </span>
                ) : null}
                {viewProfile.title ? (
                  <span className="lr-tag purple">{viewProfile.title}</span>
                ) : null}
              </div>
            </div>
            <div className="lr-about-company">
              <div className="lr-about-head">
                <div className="lr-icon-box tone-indigo">
                  <IconBuilding />
                </div>
                <h3>
                  About{" "}
                  {(viewCore.companyName || "company").toUpperCase()}
                </h3>
              </div>
              <ReadMoreText lines={4}>
                {display(viewProfile.company?.description)}
              </ReadMoreText>
              <div className="lr-about-links">
                {companyWebsite ? (
                  <a
                    href={companyWebsite}
                    target="_blank"
                    rel="noreferrer"
                    className="lr-site-btn"
                  >
                    <span className="lr-site-btn-icon" aria-hidden="true">
                      <IconGlobe />
                    </span>
                    <span>Official Website</span>
                  </a>
                ) : null}
                {companyLinkedin ? (
                  <a
                    href={companyLinkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="lr-btn-li compact"
                  >
                    <IconLinkedIn /> LinkedIn
                  </a>
                ) : null}
              </div>
            </div>
          </Card>

          <Card
            title="Strategic Meeting Brief"
            section="brief"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            titleClassName="lr-title-normal"
            edit={
              <div className="lr-edit-stack">
                <label>
                  Stakes
                  <input
                    className="lr-input"
                    value={viewProfile.brief?.stakes || "High Stakes"}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        brief: { ...p.brief, stakes: e.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  Problem / Pitch
                  <textarea
                    className="lr-input"
                    rows={3}
                    value={viewProfile.brief?.problem || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        brief: { ...p.brief, problem: e.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  Primary objective
                  <textarea
                    className="lr-input"
                    rows={3}
                    value={viewProfile.brief?.objective || ""}
                    onChange={(e) =>
                      patchProfile((p) => ({
                        ...p,
                        brief: { ...p.brief, objective: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            }
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-2">
                <span />
                <span className="lr-high-stakes">
                  {viewProfile.brief?.stakes || "High Stakes"}
                </span>
              </div>
              {viewProfile.brief?.problem ? (
                <section className="lr-brief-orange">
                  <h4 className="lr-brief-h orange">Problem/Pitch</h4>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium">
                    {viewProfile.brief.problem}
                  </p>
                </section>
              ) : null}
              <section>
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                  AI-Generated Primary Objective
                </h4>
                <p className="text-sm text-gray-500 italic">
                  {viewProfile.brief?.objective?.trim() ||
                    "Strategic brief not available for this contact yet"}
                </p>
              </section>
            </div>
          </Card>

          <Card
            section="news"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              <label className="lr-edit-stack">
                News & updates
                <textarea
                  className="lr-input"
                  rows={6}
                  value={viewProfile.news || ""}
                  onChange={(e) =>
                    patchProfile((p) => ({ ...p, news: e.target.value }))
                  }
                />
              </label>
            }
          >
            <div className="lr-news-head">
              <h3 className="lr-news-title">
                <span className="lr-news-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                    <path d="M18 14h-8" />
                    <path d="M15 18h-5" />
                    <path d="M10 6h8v4h-8V6Z" />
                  </svg>
                </span>
                Company News & Updates
              </h3>
            </div>
            {viewProfile.news?.trim() ? (
              <p className="lr-desc">{viewProfile.news}</p>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-1">
                  No recent news available for this company.
                </p>
              </div>
            )}
          </Card>

          <Card
            title="Engagement Timeline"
            section="timeline"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            titleClassName="lr-title-normal"
            edit={
              <div className="lr-edit-stack">
                {(viewProfile.timeline || []).length === 0 ? (
                  <p className="lr-empty">No timeline notes yet.</p>
                ) : (
                  (viewProfile.timeline || []).map((item, index) => (
                    <div key={item.id} className="lr-edit-panel lr-edit-panel-row">
                      <div className="lr-edit-panel-head">
                        <span className="lr-edit-panel-label">Entry</span>
                        <RemoveIconButton
                          label="Remove timeline entry"
                          onClick={() =>
                            patchProfile((p) => ({
                              ...p,
                              timeline: (p.timeline || []).filter(
                                (entry) => entry.id !== item.id,
                              ),
                            }))
                          }
                        />
                      </div>
                      <label>
                        When
                        <input
                          className="lr-input"
                          type="datetime-local"
                          value={toDatetimeLocalValue(item.at)}
                          onChange={(e) =>
                            patchProfile((p) => {
                              const timeline = [...(p.timeline || [])];
                              timeline[index] = {
                                ...timeline[index],
                                at: e.target.value
                                  ? new Date(e.target.value).toISOString()
                                  : "",
                              };
                              return { ...p, timeline };
                            })
                          }
                        />
                      </label>
                      <label>
                        Note
                        <textarea
                          className="lr-input"
                          rows={3}
                          value={item.body}
                          onChange={(e) =>
                            patchProfile((p) => {
                              const timeline = [...(p.timeline || [])];
                              timeline[index] = {
                                ...timeline[index],
                                body: e.target.value,
                              };
                              return { ...p, timeline };
                            })
                          }
                        />
                      </label>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  className="btn-soft"
                  onClick={() =>
                    patchProfile((p) => ({
                      ...p,
                      timeline: [
                        ...(p.timeline || []),
                        {
                          id: newNoteId(),
                          at: new Date().toISOString(),
                          body: "",
                          kind: "NOTE",
                        } satisfies ContactProfileTimelineItem,
                      ],
                    }))
                  }
                >
                  Add timeline entry
                </button>
              </div>
            }
          >
            {engagementEntries.length === 0 ? (
              <p className="lr-empty">No engagement activity yet.</p>
            ) : (
              <>
                <div className="lr-timeline-rail">
                  {visibleEngagement.map((entry, index) => (
                    <div
                      className="lr-tl-item"
                      key={`${entry.source}-${entry.id}`}
                    >
                      <span
                        className={`lr-tl-dot${index === 0 ? " is-first" : ""}`}
                        aria-hidden="true"
                      />
                      <div className="lr-tl-meta">
                        <span
                          className={`lr-tl-type ${timelineKindClass(entry.type)}`}
                        >
                          {timelineKindLabel(entry.type)}
                        </span>
                        <span className="lr-tl-date">
                          {entry.at
                            ? formatListDate(entry.at)
                            : formatCompanyDate(entry.at)}
                        </span>
                      </div>
                      {entry.title ? (
                        <p className="lr-tl-title">{entry.title}</p>
                      ) : null}
                      {entry.body ? (
                        <ReadMoreText className="lr-tl-body" lines={3}>
                          {entry.event?.type === "company_associated" &&
                          entry.event.companyId ? (
                            <>
                              This contact has been associated to the company:{" "}
                              <Link
                                href={portalCompanyRoute(
                                  entry.event.companyId,
                                )}
                                className="af-campaign-link"
                              >
                                {entry.event.companyName || "Company"}
                              </Link>
                            </>
                          ) : entry.event?.type === "list_added" &&
                            entry.event.listId ? (
                            <>
                              Added to list{" "}
                              <Link
                                href={portalListRoute(entry.event.listId)}
                                className="af-campaign-link"
                              >
                                {entry.event.listDisplayId
                                  ? `(#${entry.event.listDisplayId}) `
                                  : ""}
                                {entry.event.listName}
                              </Link>
                            </>
                          ) : (
                            entry.body
                          )}
                        </ReadMoreText>
                      ) : null}
                      {entry.event?.openTag ||
                      entry.event?.device ||
                      entry.event?.ip ? (
                        <div className="lr-tl-extra">
                          {entry.event.openTag ? (
                            <span className="lr-tl-chip">
                              {entry.event.openTag}
                            </span>
                          ) : null}
                          {entry.event.device &&
                          isEngagementDevice(entry.event.device) &&
                          entry.event.device !== "unknown" ? (
                            <span className="lr-tl-chip">
                              {formatEngagementDevice(entry.event.device)}
                            </span>
                          ) : null}
                          {entry.event.ip ? (
                            <span className="lr-tl-chip">
                              IP {entry.event.ip}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {entry.event?.campaignId ? (
                        <p className="lr-tl-link">
                          <Link
                            href={portalCampaignRoute(
                              entry.event.campaignId,
                              entry.event.campaignKind,
                            )}
                          >
                            View campaign
                            {entry.event.campaignName
                              ? ` · ${entry.event.campaignName}`
                              : ""}
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                {hiddenEngagementCount > 0 ? (
                  <button
                    type="button"
                    className="lr-readmore-btn lr-timeline-more"
                    onClick={() => setTimelineExpanded((v) => !v)}
                  >
                    {timelineExpanded
                      ? "Show less"
                      : `Read more (${hiddenEngagementCount} more)`}
                  </button>
                ) : null}
              </>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-5">
          <div className="apple-card lr-card">
            <div className="lr-card-head">
              <h3 className="lr-card-title">Report Owner</h3>
            </div>
            <div className="lr-card-body">
              <div className="lr-owner">
                <div className="lr-owner-avatar">
                  {initialOf(contact.owner || "P")}
                  <span className="lr-online" />
                </div>
                <div>
                  <p className="lr-mini-value">{contact.owner || "—"}</p>
                  <p className="lr-owner-date">
                    {formatCompanyDate(contact.updatedAt)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="apple-card lr-card">
            <div className="lr-card-head">
              <h3 className="lr-card-title">Strategic Timeline</h3>
            </div>
            <div className="lr-card-body">
              <div className="lr-strat-card">
                <div>
                  <p className="k">Last Updated</p>
                  <p className="v">{formatCompanyDate(contact.updatedAt)}</p>
                </div>
                <div className="lr-strat-ico" aria-hidden="true">
                  ✓
                </div>
              </div>
            </div>
          </div>

          <Card
            title="Internal Notes"
            section="notes"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              <div className="lr-edit-stack">
                {(viewProfile.notes || []).length === 0 ? (
                  <p className="lr-empty">No internal notes yet.</p>
                ) : (
                  (viewProfile.notes || []).map((item, index) => (
                    <div key={item.id} className="lr-edit-panel lr-edit-panel-row">
                      <div className="lr-edit-panel-head">
                        <span className="lr-edit-panel-label">Note</span>
                        <RemoveIconButton
                          label="Remove note"
                          onClick={() =>
                            patchProfile((p) => ({
                              ...p,
                              notes: (p.notes || []).filter(
                                (entry) => entry.id !== item.id,
                              ),
                            }))
                          }
                        />
                      </div>
                      <textarea
                        className="lr-input"
                        rows={4}
                        aria-label="Note"
                        value={item.body}
                        onChange={(e) =>
                          patchProfile((p) => {
                            const notes = [...(p.notes || [])];
                            notes[index] = {
                              ...notes[index],
                              body: e.target.value,
                            };
                            return { ...p, notes };
                          })
                        }
                      />
                    </div>
                  ))
                )}
                <button
                  type="button"
                  className="btn-soft"
                  onClick={() =>
                    patchProfile((p) => ({
                      ...p,
                      notes: [
                        ...(p.notes || []),
                        {
                          id: newNoteId(),
                          at: new Date().toISOString(),
                          body: "",
                        } satisfies ContactProfileNote,
                      ],
                    }))
                  }
                >
                  Add note
                </button>
              </div>
            }
          >
            {(viewProfile.notes || []).length === 0 ? (
              <p className="lr-empty">No internal notes yet.</p>
            ) : (
              <div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto pr-1">
                {(viewProfile.notes || []).map((item) => (
                  <div key={item.id} className="lr-note">
                    <p className="lr-note-meta">
                      {formatCompanyDate(item.at)} · Note
                    </p>
                    <p className="lr-desc">{item.body}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Information"
            section="information"
            editing={editing}
            readOnly={readOnly}
            saving={saving}
            onEdit={beginEdit}
            onCancel={cancelEdit}
            onSave={saveSection}
            edit={
              Object.keys(viewCore.attributes).length === 0 ? (
                <p className="lr-empty">No custom attributes yet.</p>
              ) : (
                <div className="lr-edit-stack">
                  {Object.entries(viewCore.attributes).map(([key, value]) => (
                    <label key={key}>
                      {CONTACT_ATTRIBUTE_LABELS[key] ?? key}
                      <input
                        className="lr-input"
                        value={value}
                        onChange={(e) =>
                          setDraftCore((c) => ({
                            ...c,
                            attributes: {
                              ...c.attributes,
                              [key]: e.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )
            }
          >
            {Object.keys(viewCore.attributes).length === 0 ? (
              <p className="lr-empty">No custom attributes yet.</p>
            ) : (
              Object.entries(viewCore.attributes).map(([key, value]) => (
                <div
                  key={key}
                  className="lr-company-fields"
                  style={{ marginBottom: 10 }}
                >
                  <p className="lr-mini-label">
                    {CONTACT_ATTRIBUTE_LABELS[key] ?? key}
                  </p>
                  <p className="lr-mini-value">{display(value)}</p>
                </div>
              ))
            )}
          </Card>

          <div className="apple-card lr-card">
            <div className="lr-card-head">
              <h3 className="lr-card-title">Email campaigns</h3>
            </div>
            <div className="lr-card-body">
              <div className="cd-stats">
                {[
                  ["Sent", campaignStats.sent],
                  ["Delivered", campaignStats.delivered],
                  ["Opens", campaignStats.opens],
                  ["Clicks", campaignStats.clicks],
                ].map(([label, value]) => (
                  <div className="cd-stat" key={String(label)}>
                    <div className="k">{label}</div>
                    <div className="v">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
