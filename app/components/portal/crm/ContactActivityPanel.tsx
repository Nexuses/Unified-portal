"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatCompanyDate,
  formatListDate,
  formatRelativeTime,
  type ContactDetail,
  type ContactHistoryEvent,
  type ContactProfile,
  type ContactProfileTimelineItem,
} from "@/lib/crm";
import {
  formatEngagementDevice,
  isEngagementDevice,
  type EngagementDevice,
} from "@/lib/engagement-client-meta";
import {
  portalCampaignRoute,
  portalCompanyRoute,
  portalListRoute,
} from "@/lib/portal-nav";

export type ActivityFilter = "all" | "email" | "call" | "message";

type BuiltinKind = "call" | "whatsapp" | "message";

type CampaignEmailPreview = {
  sendId: string;
  subject: string;
  previewText: string;
  html: string;
  campaignName: string;
  fromName: string;
  fromEmail: string;
  sentAt: string;
};

type UnifiedActivity =
  | {
      source: "history";
      id: string;
      at: string;
      channel: "email" | "other";
      event: ContactHistoryEvent;
    }
  | {
      source: "manual";
      id: string;
      at: string;
      channel: "call" | "message";
      item: ContactProfileTimelineItem;
      kind: string;
    };

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "email", label: "Email" },
  { id: "call", label: "Call" },
  { id: "message", label: "Message" },
];

const BUILTIN_KINDS: { id: BuiltinKind; label: string }[] = [
  { id: "call", label: "Call" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "message", label: "Message" },
];

const DEFAULT_CALL_OUTCOMES = [
  "Connected",
  "No answer",
  "Voicemail",
  "Busy",
  "Callback later",
];

const CUSTOM_KINDS_KEY = "crm-activity-custom-kinds";
const CUSTOM_OUTCOMES_KEY = "crm-activity-custom-outcomes";

function newActivityId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadStoredList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .map((item) => String(item ?? "").trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

function saveStoredList(key: string, values: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(values));
}

function slugifyKind(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function normalizeManualKind(kind?: string): string {
  const value = String(kind ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "note";
  if (value === "wa") return "whatsapp";
  if (value === "sms" || value === "text") return "message";
  return value;
}

function isCallKind(kind: string) {
  return normalizeManualKind(kind) === "call";
}

function isCampaignEvent(type: ContactHistoryEvent["type"]) {
  return type.startsWith("campaign_");
}

function resolveHistorySendId(event: ContactHistoryEvent) {
  if (event.sendId && /^[a-f0-9]{24}$/i.test(event.sendId)) {
    return event.sendId;
  }
  const match = event.id.match(
    /^campaign-(?:opened|sent|unsubscribed|clicked)-([a-f0-9]{24})/i,
  );
  return match?.[1] ?? "";
}

function historyKindLabel(type: ContactHistoryEvent["type"]) {
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
    default:
      return "Activity";
  }
}

function historyKindClass(type: ContactHistoryEvent["type"]) {
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

function manualKindLabel(kind: string) {
  const value = normalizeManualKind(kind);
  switch (value) {
    case "call":
      return "Call";
    case "whatsapp":
      return "WhatsApp";
    case "message":
      return "Message";
    case "note":
      return "Note";
    default:
      return value
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function DeviceIcon({ device }: { device: EngagementDevice }) {
  if (device === "mobile") {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
        <rect
          x="7"
          y="2.5"
          width="10"
          height="19"
          rx="2.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M10 18.5h4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (device === "tablet") {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
        <rect
          x="4"
          y="3"
          width="16"
          height="18"
          rx="2.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M11 17.5h2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M8 20h8M12 16v4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HistoryBody({ event }: { event: ContactHistoryEvent }) {
  if (event.type === "company_associated" && event.companyId) {
    return (
      <>
        Associated with{" "}
        <Link
          href={portalCompanyRoute(event.companyId)}
          className="af-campaign-link"
        >
          {event.companyName || "Company"}
        </Link>
      </>
    );
  }
  if (event.type === "list_added" && event.listId) {
    return (
      <>
        Added to list{" "}
        <Link href={portalListRoute(event.listId)} className="af-campaign-link">
          {event.listDisplayId ? `(#${event.listDisplayId}) ` : ""}
          {event.listName}
        </Link>
        {event.actor ? ` by ${event.actor}` : ""}.
      </>
    );
  }
  if (event.type === "import") {
    return (
      <>
        Added via a contacts import
        {event.actor ? ` by ${event.actor}` : ""}
        {event.importFileName ? (
          <>
            {" "}
            via <strong>{event.importFileName}</strong>
          </>
        ) : null}
        .
      </>
    );
  }
  if (event.type === "campaign_sent" || event.type === "campaign_delivered") {
    return (
      <>
        {event.type === "campaign_sent" ? "Sent" : "Delivered"} on{" "}
        <strong>{formatListDate(event.at)}</strong>
        {event.campaignName ? <> in {event.campaignName}</> : null}.
      </>
    );
  }
  if (event.type === "campaign_opened") {
    return (
      <>
        Opened on <strong>{formatListDate(event.at)}</strong>
        {event.campaignName ? <> — {event.campaignName}</> : null}.
      </>
    );
  }
  if (event.type === "campaign_clicked") {
    return (
      <>
        Clicked on <strong>{formatListDate(event.at)}</strong>
        {": "}
        {event.clickedUrl ? (
          <a
            href={event.clickedUrl}
            target="_blank"
            rel="noreferrer"
            className="af-campaign-link"
          >
            {event.clickedUrl}
          </a>
        ) : (
          "a link"
        )}
        {event.campaignName ? <> in {event.campaignName}</> : null}.
      </>
    );
  }
  if (event.type === "campaign_unsubscribed") {
    return (
      <>
        Unsubscribed
        {event.campaignName ? ` from ${event.campaignName}` : ""}.
      </>
    );
  }
  return <>{event.description || "Activity recorded."}</>;
}

function buildActivities(contact: ContactDetail): UnifiedActivity[] {
  const historyItems: UnifiedActivity[] = contact.history
    .filter((event) => event.type !== "campaign_delivered")
    .map((event) => ({
      source: "history" as const,
      id: event.id,
      at: event.at || "",
      channel: isCampaignEvent(event.type) ? ("email" as const) : ("other" as const),
      event,
    }));

  const manualItems: UnifiedActivity[] = (contact.profile.timeline || []).map(
    (item) => {
      const kind = normalizeManualKind(item.kind);
      return {
        source: "manual" as const,
        id: item.id,
        at: item.at || "",
        channel: isCallKind(kind) ? ("call" as const) : ("message" as const),
        item,
        kind,
      };
    },
  );

  return [...historyItems, ...manualItems].sort((a, b) => {
    const aTime = a.at ? new Date(a.at).getTime() : 0;
    const bTime = b.at ? new Date(b.at).getTime() : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    const aRank =
      a.source === "history" && a.event.type === "company_associated"
        ? 0
        : a.source === "history" &&
            (a.event.type === "import" || a.event.type === "list_added")
          ? 2
          : 1;
    const bRank =
      b.source === "history" && b.event.type === "company_associated"
        ? 0
        : b.source === "history" &&
            (b.event.type === "import" || b.event.type === "list_added")
          ? 2
          : 1;
    return bRank - aRank;
  });
}

function filterActivities(
  items: UnifiedActivity[],
  filter: ActivityFilter,
): UnifiedActivity[] {
  if (filter === "all") return items;
  if (filter === "email") {
    return items.filter(
      (item) => item.source === "history" && item.channel === "email",
    );
  }
  if (filter === "call") {
    return items.filter(
      (item) => item.source === "manual" && isCallKind(item.kind),
    );
  }
  return items.filter(
    (item) => item.source === "manual" && !isCallKind(item.kind),
  );
}

type ContactActivityPanelProps = {
  contact: ContactDetail;
  onContactChange: (contact: ContactDetail) => void;
  compact?: boolean;
};

export default function ContactActivityPanel({
  contact,
  onContactChange,
  compact = false,
}: ContactActivityPanelProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [logging, setLogging] = useState(false);
  const [logKind, setLogKind] = useState<string>("call");
  const [logBody, setLogBody] = useState("");
  const [callOutcome, setCallOutcome] = useState<string>(
    DEFAULT_CALL_OUTCOMES[0],
  );
  const [customKinds, setCustomKinds] = useState<string[]>([]);
  const [customOutcomes, setCustomOutcomes] = useState<string[]>([]);
  const [addingKind, setAddingKind] = useState(false);
  const [addingOutcome, setAddingOutcome] = useState(false);
  const [kindDraft, setKindDraft] = useState("");
  const [outcomeDraft, setOutcomeDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [emailPreview, setEmailPreview] = useState<CampaignEmailPreview | null>(
    null,
  );
  const [emailLoadingId, setEmailLoadingId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    setCustomKinds(loadStoredList(CUSTOM_KINDS_KEY));
    setCustomOutcomes(loadStoredList(CUSTOM_OUTCOMES_KEY));
  }, []);

  const kindOptions = useMemo(() => {
    const builtins = BUILTIN_KINDS.map((item) => ({
      id: item.id,
      label: item.label,
    }));
    const customs = customKinds.map((label) => ({
      id: slugifyKind(label) || label.toLowerCase(),
      label,
    }));
    const seen = new Set(builtins.map((item) => item.id));
    return [
      ...builtins,
      ...customs.filter((item) => item.id && !seen.has(item.id as BuiltinKind)),
    ];
  }, [customKinds]);

  const outcomeOptions = useMemo(
    () => [
      ...DEFAULT_CALL_OUTCOMES,
      ...customOutcomes.filter(
        (item) =>
          !DEFAULT_CALL_OUTCOMES.some(
            (base) => base.toLowerCase() === item.toLowerCase(),
          ),
      ),
    ],
    [customOutcomes],
  );

  function commitCustomKind() {
    const label = kindDraft.trim();
    if (!label) {
      setAddingKind(false);
      setKindDraft("");
      return;
    }
    const id = slugifyKind(label);
    if (!id) {
      setSaveError("Enter a valid activity type.");
      return;
    }
    if (BUILTIN_KINDS.some((item) => item.id === id)) {
      setLogKind(id);
      setAddingKind(false);
      setKindDraft("");
      return;
    }
    const next = [
      ...customKinds.filter(
        (item) => slugifyKind(item) !== id && item.toLowerCase() !== label.toLowerCase(),
      ),
      label,
    ];
    setCustomKinds(next);
    saveStoredList(CUSTOM_KINDS_KEY, next);
    setLogKind(id);
    setAddingKind(false);
    setKindDraft("");
  }

  function commitCustomOutcome() {
    const label = outcomeDraft.trim();
    if (!label) {
      setAddingOutcome(false);
      setOutcomeDraft("");
      return;
    }
    const next = [
      ...customOutcomes.filter(
        (item) => item.toLowerCase() !== label.toLowerCase(),
      ),
      label,
    ];
    setCustomOutcomes(next);
    saveStoredList(CUSTOM_OUTCOMES_KEY, next);
    setCallOutcome(label);
    setAddingOutcome(false);
    setOutcomeDraft("");
  }

  const allActivities = useMemo(() => buildActivities(contact), [contact]);
  const filtered = useMemo(
    () => filterActivities(allActivities, filter),
    [allActivities, filter],
  );
  const visible = compact ? filtered.slice(0, 8) : filtered;

  const counts = useMemo(() => {
    const base = buildActivities(contact);
    return {
      all: base.length,
      email: filterActivities(base, "email").length,
      call: filterActivities(base, "call").length,
      message: filterActivities(base, "message").length,
    };
  }, [contact]);

  async function persistTimeline(timeline: ContactProfileTimelineItem[]) {
    setSaving(true);
    setSaveError("");
    try {
      const nextProfile: ContactProfile = {
        ...contact.profile,
        timeline,
      };
      const response = await fetch(
        `/api/crm/contacts/${encodeURIComponent(contact.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: nextProfile }),
        },
      );
      const data = (await response.json()) as ContactDetail & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to save activity");
      }
      onContactChange(data);
      setLogging(false);
      setLogBody("");
      setCallOutcome(DEFAULT_CALL_OUTCOMES[0]);
      setLogKind("call");
      setAddingKind(false);
      setAddingOutcome(false);
      setKindDraft("");
      setOutcomeDraft("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function submitLog() {
    const note = logBody.trim();
    const callLike = isCallKind(logKind);
    if (!note && !callLike) {
      setSaveError("Add a short note for this activity.");
      return;
    }
    const body = callLike
      ? [callOutcome, note].filter(Boolean).join(" — ")
      : note;
    if (!body.trim()) {
      setSaveError("Add a short note for this activity.");
      return;
    }
    const entry: ContactProfileTimelineItem = {
      id: newActivityId(),
      at: new Date().toISOString(),
      body: body.trim(),
      kind: normalizeManualKind(logKind),
    };
    await persistTimeline([entry, ...(contact.profile.timeline || [])]);
  }

  async function removeManual(id: string) {
    const timeline = (contact.profile.timeline || []).filter(
      (item) => item.id !== id,
    );
    await persistTimeline(timeline);
  }

  async function openEmailPreview(sendId: string) {
    if (!sendId) return;
    setEmailError("");
    setEmailLoadingId(sendId);
    try {
      const response = await fetch(
        `/api/crm/contacts/${encodeURIComponent(contact.id)}/sends/${encodeURIComponent(sendId)}/email`,
      );
      const data = (await response.json()) as CampaignEmailPreview & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Failed to load email");
      }
      setEmailPreview(data);
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : "Failed to load email",
      );
    } finally {
      setEmailLoadingId(null);
    }
  }

  return (
    <div className={`cd-activity${compact ? " is-compact" : ""}`}>
      <div className="cd-activity-head">
        <div>
          <h3>Activity</h3>
          <p>Email engagement plus calls and messages you log.</p>
        </div>
        <button
          type="button"
          className="cd-activity-add"
          onClick={() => {
            setLogging((open) => !open);
            setSaveError("");
          }}
        >
          {logging ? "Cancel" : "Log activity"}
        </button>
      </div>

      <div className="cd-activity-filters" role="tablist" aria-label="Activity filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={`cd-activity-chip${filter === item.id ? " is-active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span>{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {logging ? (
        <div className="cd-activity-composer">
          <div className="cd-activity-kind-row">
            {kindOptions.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className={`cd-activity-kind${logKind === kind.id ? " is-active" : ""}`}
                onClick={() => {
                  setLogKind(kind.id);
                  setAddingKind(false);
                }}
              >
                {kind.label}
              </button>
            ))}
            {addingKind ? (
              <form
                className="cd-activity-add-inline"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitCustomKind();
                }}
              >
                <input
                  className="cd-activity-add-input"
                  autoFocus
                  placeholder="Custom type…"
                  value={kindDraft}
                  onChange={(event) => setKindDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setAddingKind(false);
                      setKindDraft("");
                    }
                  }}
                />
                <button type="submit" className="cd-activity-add-confirm">
                  Add
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="cd-activity-plus"
                aria-label="Add activity type"
                title="Add your own activity type"
                onClick={() => {
                  setAddingKind(true);
                  setAddingOutcome(false);
                }}
              >
                +
              </button>
            )}
          </div>
          {isCallKind(logKind) ? (
            <div className="cd-activity-outcomes">
              {outcomeOptions.map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  className={`cd-activity-outcome${callOutcome === outcome ? " is-active" : ""}`}
                  onClick={() => {
                    setCallOutcome(outcome);
                    setAddingOutcome(false);
                  }}
                >
                  {outcome}
                </button>
              ))}
              {addingOutcome ? (
                <form
                  className="cd-activity-add-inline"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitCustomOutcome();
                  }}
                >
                  <input
                    className="cd-activity-add-input"
                    autoFocus
                    placeholder="Custom outcome…"
                    value={outcomeDraft}
                    onChange={(event) => setOutcomeDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setAddingOutcome(false);
                        setOutcomeDraft("");
                      }
                    }}
                  />
                  <button type="submit" className="cd-activity-add-confirm">
                    Add
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="cd-activity-plus"
                  aria-label="Add call outcome"
                  title="Add your own call outcome"
                  onClick={() => {
                    setAddingOutcome(true);
                    setAddingKind(false);
                  }}
                >
                  +
                </button>
              )}
            </div>
          ) : null}
          <textarea
            className="cd-activity-note"
            rows={3}
            placeholder={
              isCallKind(logKind)
                ? "Optional notes from the call…"
                : logKind === "whatsapp"
                  ? "What did you send or receive on WhatsApp?"
                  : "Add a short note…"
            }
            value={logBody}
            onChange={(event) => setLogBody(event.target.value)}
          />
          {saveError ? <p className="cd-activity-error">{saveError}</p> : null}
          <div className="cd-activity-composer-foot">
            <button
              type="button"
              className="btn-dark"
              disabled={saving}
              onClick={() => void submitLog()}
            >
              {saving ? "Saving…" : "Save activity"}
            </button>
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="cd-activity-empty">
          <p>
            {filter === "all"
              ? "No activity yet. Log a call or message, or wait for email engagement."
              : filter === "email"
                ? "No email activity for this contact yet."
                : filter === "call"
                  ? "No calls logged yet."
                  : "No messages logged yet."}
          </p>
          {!logging ? (
            <button
              type="button"
              className="btn-soft"
              onClick={() => setLogging(true)}
            >
              Log activity
            </button>
          ) : null}
        </div>
      ) : (
        <div className="cd-activity-rail lr-timeline-rail">
          {visible.map((entry, index) => {
            if (entry.source === "manual") {
              return (
                <div className="lr-tl-item cd-activity-item" key={entry.id}>
                  <span
                    className={`lr-tl-dot${index === 0 ? " is-first" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="lr-tl-meta">
                    <span
                      className={`lr-tl-type cd-activity-type is-${
                        entry.kind === "call" ||
                        entry.kind === "whatsapp" ||
                        entry.kind === "message" ||
                        entry.kind === "note"
                          ? entry.kind
                          : "custom"
                      }`}
                    >
                      {manualKindLabel(entry.kind)}
                    </span>
                    <span className="lr-tl-date">
                      {entry.at ? formatListDate(entry.at) : "—"}
                      {entry.at ? (
                        <span className="cd-event-time-rel">
                          {" "}
                          · {formatRelativeTime(entry.at)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="lr-tl-body">{entry.item.body || "—"}</p>
                  <div className="lr-tl-actions">
                    <button
                      type="button"
                      className="cd-activity-remove"
                      disabled={saving}
                      onClick={() => void removeManual(entry.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            }

            const event = entry.event;
            const sendId = resolveHistorySendId(event);
            const showEmailPreview =
              Boolean(sendId) && isCampaignEvent(event.type);

            return (
              <div className="lr-tl-item cd-activity-item" key={entry.id}>
                <span
                  className={`lr-tl-dot${index === 0 ? " is-first" : ""}`}
                  aria-hidden="true"
                />
                <div className="lr-tl-meta">
                  <span className={`lr-tl-type ${historyKindClass(event.type)}`}>
                    {historyKindLabel(event.type)}
                  </span>
                  <span className="lr-tl-date">
                    {event.at ? formatListDate(event.at) : formatCompanyDate(event.at)}
                    {event.at ? (
                      <span className="cd-event-time-rel">
                        {" "}
                        · {formatRelativeTime(event.at)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <p className="lr-tl-body">
                  <HistoryBody event={event} />
                </p>
                {event.openTag ||
                event.clickTag ||
                event.device ||
                event.ip ? (
                  <div className="lr-tl-extra">
                    <div className="lr-tl-extra-row">
                      {event.openTag ? (
                        <span className="lr-tl-chip is-bot">{event.openTag}</span>
                      ) : null}
                      {event.clickTag ? (
                        <span className="lr-tl-chip is-bot">
                          {event.clickTag}
                        </span>
                      ) : null}
                      {event.device &&
                      isEngagementDevice(event.device) &&
                      event.device !== "unknown" ? (
                        <span
                          className={`lr-tl-chip is-device is-${event.device}`}
                        >
                          <DeviceIcon device={event.device} />
                          {formatEngagementDevice(event.device)}
                        </span>
                      ) : null}
                      {event.ip ? (
                        <span className="lr-tl-chip is-ip" title={event.ip}>
                          <span className="lr-tl-ip-label">IP</span>
                          <code className="lr-tl-ip-value">{event.ip}</code>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {showEmailPreview || event.campaignId ? (
                  <div className="lr-tl-actions">
                    {showEmailPreview ? (
                      <button
                        type="button"
                        className="lr-tl-email-btn"
                        disabled={emailLoadingId === sendId}
                        onClick={() => void openEmailPreview(sendId)}
                      >
                        {emailLoadingId === sendId
                          ? "Loading email…"
                          : "Email preview"}
                      </button>
                    ) : null}
                    {event.campaignId ? (
                      <Link
                        className="lr-tl-email-btn lr-tl-campaign-link"
                        href={portalCampaignRoute(
                          event.campaignId,
                          event.campaignKind,
                        )}
                      >
                        View campaign
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {emailError ? <p className="lr-tl-email-error">{emailError}</p> : null}

      <div className="cd-foot-note">
        Added on {formatCompanyDate(contact.createdAt)}
      </div>

      {emailPreview && typeof document !== "undefined"
        ? createPortal(
            <div
              className="crm-modal-backdrop lr-email-preview-backdrop"
              onClick={() => setEmailPreview(null)}
              role="presentation"
            >
              <div
                className="crm-modal lr-email-preview-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cd-email-preview-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="crm-modal-head">
                  <div>
                    <h3 id="cd-email-preview-title">Email preview</h3>
                    <p>
                      {emailPreview.campaignName}
                      {emailPreview.sentAt
                        ? ` · sent ${formatListDate(emailPreview.sentAt)}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="crm-modal-close"
                    aria-label="Close"
                    onClick={() => setEmailPreview(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="lr-email-preview-meta">
                  <div>
                    <span>Subject</span>
                    <strong>{emailPreview.subject || "(no subject)"}</strong>
                  </div>
                  {emailPreview.fromName || emailPreview.fromEmail ? (
                    <div>
                      <span>From</span>
                      <strong>
                        {emailPreview.fromName || emailPreview.fromEmail}
                        {emailPreview.fromName && emailPreview.fromEmail
                          ? ` <${emailPreview.fromEmail}>`
                          : ""}
                      </strong>
                    </div>
                  ) : null}
                  {emailPreview.previewText ? (
                    <div>
                      <span>Preview</span>
                      <strong>{emailPreview.previewText}</strong>
                    </div>
                  ) : null}
                </div>
                <div className="lr-email-preview-frame-wrap">
                  {emailPreview.html.trim() ? (
                    <iframe
                      title="Sent email"
                      className="lr-email-preview-frame"
                      sandbox=""
                      srcDoc={emailPreview.html}
                    />
                  ) : (
                    <p className="lr-email-preview-empty">
                      No email HTML was stored for this send.
                    </p>
                  )}
                </div>
                <div className="crm-modal-foot">
                  <button
                    type="button"
                    className="btn-dark"
                    onClick={() => setEmailPreview(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
