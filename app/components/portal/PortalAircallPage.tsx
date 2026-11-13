"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AircallAudioPlayer from "@/app/components/portal/AircallAudioPlayer";
import {
  aircallLogStatus,
  aircallLogStatusLabel,
  formatCallDuration,
  formatCallWhen,
  toE164Phone,
  type AircallCallRow,
} from "@/lib/aircall";
import { portalContactRoute } from "@/lib/portal-nav";

const AircallWorkspaceDialer = dynamic(
  () => import("@/app/components/portal/AircallWorkspaceDialer"),
  {
    ssr: false,
    loading: () => (
      <div className="aircall-dialer-loading">Loading dialer…</div>
    ),
  },
);

type CallGroup = {
  key: string;
  calls: AircallCallRow[];
};

function callGroupKey(call: AircallCallRow) {
  if (call.contactId) {
    return `contact:${call.contactId}`;
  }
  const digits = String(call.phoneDigits || "").trim();
  if (digits) {
    return `phone:${digits}`;
  }
  return `call:${call.id}`;
}

function groupCalls(calls: AircallCallRow[]): CallGroup[] {
  const map = new Map<string, AircallCallRow[]>();
  for (const call of calls) {
    const key = callGroupKey(call);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(call);
    } else {
      map.set(key, [call]);
    }
  }
  return [...map.entries()].map(([key, groupCalls]) => ({
    key,
    calls: groupCalls,
  }));
}

function CallCells({
  call,
  showContact,
  nested,
  onOpenNotes,
}: {
  call: AircallCallRow;
  showContact: boolean;
  nested?: boolean;
  onOpenNotes: (call: AircallCallRow) => void;
}) {
  const contactLabelRow =
    call.contactName || call.contactEmail || "CRM contact";

  return (
    <>
      <td>
        {showContact ? (
          call.contactId ? (
            <div className="aircall-contact-cell">
              <Link
                className="aircall-contact-link"
                href={portalContactRoute(call.contactId, "/portal/aircall")}
                title={`Open ${contactLabelRow} in CRM`}
                onClick={(event) => event.stopPropagation()}
              >
                {contactLabelRow}
              </Link>
              {call.contactEmail &&
              call.contactName &&
              call.contactEmail !== call.contactName ? (
                <div className="aircall-muted">{call.contactEmail}</div>
              ) : null}
            </div>
          ) : (
            <span className="aircall-muted">No CRM contact for this number</span>
          )
        ) : (
          <span className="aircall-nested-label">
            {nested ? "Earlier call" : ""}
          </span>
        )}
      </td>
      <td>
        <div className="aircall-when">
          {formatCallWhen(call.startedAt || call.endedAt)}
        </div>
      </td>
      <td>
        <code className="aircall-phone">{call.phone || "—"}</code>
      </td>
      <td>{formatCallDuration(call.durationSec)}</td>
      <td>
        <CallStatus call={call} />
      </td>
      <td onClick={(event) => event.stopPropagation()}>
        {call.recordingProxyUrl ? (
          <AircallAudioPlayer src={call.recordingProxyUrl} />
        ) : (
          <span className="aircall-muted">—</span>
        )}
      </td>
      <td onClick={(event) => event.stopPropagation()}>
        <CallNotes call={call} onOpen={onOpenNotes} />
      </td>
    </>
  );
}

const STATUS_HELP = [
  ["Connected", "They picked up."],
  ["Not answered", "It rang and nobody picked up."],
  ["Not connected", "The call never went through."],
  ["Interested", "They want to continue."],
  ["Not interested", "They declined."],
] as const;

function StatusHelp() {
  return (
    <span className="aircall-status-help" tabIndex={0} aria-label="What each status means">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.4-1.1.8-1.1 1.6" />
        <circle cx="12" cy="16.6" r="0.85" fill="currentColor" stroke="none" />
      </svg>
      <span className="aircall-status-tip" role="tooltip">
        {STATUS_HELP.map(([label, detail]) => (
          <span key={label}>
            <strong>{label}</strong>
            {detail}
          </span>
        ))}
      </span>
    </span>
  );
}

function CallStatus({ call }: { call: AircallCallRow }) {
  const status = aircallLogStatus(call);
  return (
    <span className={`aircall-pill is-${status.replaceAll("_", "-")}`}>
      {aircallLogStatusLabel(status)}
    </span>
  );
}

function CallNotes({
  call,
  onOpen,
}: {
  call: AircallCallRow;
  onOpen: (call: AircallCallRow) => void;
}) {
  if (!call.recordingSummary) {
    if (call.summaryPending) {
      return <span className="aircall-muted">…</span>;
    }
    return <span className="aircall-muted">—</span>;
  }

  const who = call.contactName || call.contactEmail || "this call";
  return (
    <button
      type="button"
      className="aircall-note-btn"
      aria-label={`View notes for ${who}`}
      title="View notes"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(call);
      }}
    >
      <FileText size={16} strokeWidth={2} />
    </button>
  );
}

function CallNoteModal({
  call,
  onClose,
}: {
  call: AircallCallRow;
  onClose: () => void;
}) {
  const who = call.contactName || call.contactEmail || "Call notes";
  return (
    <div className="crm-modal-backdrop" onClick={onClose}>
      <div
        className="crm-modal aircall-note-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aircall-note-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="crm-modal-head">
          <div>
            <h3 id="aircall-note-title">{who}</h3>
            <p>{formatCallWhen(call.startedAt || call.endedAt)}</p>
          </div>
          <button
            type="button"
            className="crm-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="crm-modal-body">
          <p className="aircall-note-body">{call.recordingSummary}</p>
        </div>
      </div>
    </div>
  );
}

export default function PortalAircallPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dialParam = searchParams.get("dial");
  const contactIdParam = searchParams.get("contactId");
  const nameParam = searchParams.get("name");

  const [calls, setCalls] = useState<AircallCallRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingDial, setPendingDial] = useState<string | null>(null);
  const [dialerOpen, setDialerOpen] = useState(() =>
    Boolean(toE164Phone(dialParam)),
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [noteCall, setNoteCall] = useState<AircallCallRow | null>(null);

  const contactLabel = useMemo(() => {
    const name = String(nameParam || "").trim();
    if (name) return name;
    const dial = toE164Phone(dialParam || pendingDial || "");
    return dial || undefined;
  }, [nameParam, dialParam, pendingDial]);

  const callGroups = useMemo(() => groupCalls(calls), [calls]);

  useEffect(() => {
    const to = toE164Phone(dialParam);
    if (!to) {
      return;
    }
    setDialerOpen(true);
    setPendingDial(to);
    setNotice(
      nameParam
        ? `Opening dialer for ${nameParam} (${to})…`
        : `Opening dialer for ${to}…`,
    );
  }, [dialParam, nameParam]);

  const clearDialQuery = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("dial");
    next.delete("contactId");
    next.delete("name");
    const qs = next.toString();
    router.replace(qs ? `/portal/aircall?${qs}` : "/portal/aircall");
  }, [router, searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/aircall/calls?limit=200", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to load calls",
        );
      }
      setConfigured(Boolean(data?.configured));
      setProjectName(String(data?.projectName || ""));
      setCalls(Array.isArray(data?.calls) ? data.calls : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    let stop = false;
    void (async () => {
      for (let step = 0; step < 40 && !stop; step += 1) {
        const response = await fetch("/api/aircall/calls/summaries", {
          method: "POST",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || stop) break;
        const updated = data?.call;
        if (updated && typeof updated.id === "string") {
          setCalls((current) =>
            current.map((call) => (call.id === updated.id ? updated : call)),
          );
        }
        if (!data?.remaining) break;
      }
    })();

    return () => {
      stop = true;
    };
  }, [loading]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the call log fresh while the page is open (server also syncs every 10m).
  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function syncNow() {
    if (syncing) {
      return;
    }
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/aircall/sync", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Sync failed",
        );
      }
      setNotice(
        `Synced ${data.fetched ?? 0} Aircall calls · ${data.matchedContacts ?? 0} matched this project’s CRM · ${data.skippedUnmatched ?? 0} hidden (no CRM contact)`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="aircall-page">
      <div className="crm-page-head aircall-head">
        <h2>Calling</h2>
        <div className="aircall-head-actions">
          {configured ? (
            <button
              type="button"
              className={dialerOpen ? "btn-soft" : "btn-dark"}
              onClick={() => setDialerOpen((open) => !open)}
            >
              {dialerOpen ? "Close dialer" : "Open dialer"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-dark"
            disabled={syncing || !configured}
            onClick={() => void syncNow()}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        <p className="desc aircall-desc">
          <span>
            Dial from here with the embedded phone workspace
            {projectName ? ` · ${projectName}` : ""}. Calls sync from Aircall
            automatically every 10 minutes (or use Sync now).
          </span>
          <span>
            Matched CRM calls land in the log below and on the contact timeline
            with recordings.
          </span>
        </p>
      </div>

      {!configured ? (
        <div className="crm-error aircall-banner">
          Add <code>AIRCALL_API_ID</code> and <code>AIRCALL_API_TOKEN</code> to
          the server env, then restart. Optional webhook:{" "}
          <code>/api/webhooks/aircall</code> (events:{" "}
          <code>call.ended</code>, <code>call.comm_assets_generated</code>).
        </div>
      ) : null}

      {error ? <div className="crm-error">{error}</div> : null}
      {notice ? <div className="aircall-notice">{notice}</div> : null}

      {contactIdParam ? (
        <p className="aircall-from-contact">
          Calling from contact{" "}
          <Link
            href={portalContactRoute(contactIdParam, "/portal/aircall")}
            className="aircall-contact-link"
          >
            {contactLabel || "Open contact"}
          </Link>
        </p>
      ) : null}

      {dialerOpen ? (
        <AircallWorkspaceDialer
          pendingDial={pendingDial}
          contactLabel={contactLabel}
          onPendingDialConsumed={() => {
            setPendingDial(null);
            clearDialQuery();
            setNotice("");
          }}
        />
      ) : null}

      <div className="aircall-log-head">
        <h3>Project call log</h3>
        <p>
          Only numbers that match a CRM contact in this project are listed.
          Contacts with multiple calls expand like an accordion.
        </p>
      </div>

      {loading ? (
        <p className="aircall-empty">Loading calls…</p>
      ) : calls.length === 0 ? (
        <div className="aircall-empty-card">
          <h3>No calls in this project yet</h3>
          <p>
            Place a call from the dialer, then wait for the 10-minute sync — or
            click <strong>Sync now</strong> to pull it into this log.
          </p>
        </div>
      ) : (
        <div className="aircall-table-wrap">
          <table className="aircall-table">
            <thead>
              <tr>
                <th>Contact called</th>
                <th>When</th>
                <th>Phone</th>
                <th>Duration</th>
                <th>
                  <span className="aircall-status-head">
                    Status
                    <StatusHelp />
                  </span>
                </th>
                <th>Recording</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {callGroups.map((group) => {
                const latest = group.calls[0];
                const extras = group.calls.slice(1);
                const hasMany = extras.length > 0;
                const expanded = expandedGroups.has(group.key);
                const contactLabelRow =
                  latest.contactName ||
                  latest.contactEmail ||
                  "CRM contact";

                return (
                  <Fragment key={group.key}>
                    <tr
                      className={`aircall-group-row${hasMany ? " is-expandable" : ""}${expanded ? " is-expanded" : ""}`}
                      onClick={
                        hasMany ? () => toggleGroup(group.key) : undefined
                      }
                      aria-expanded={hasMany ? expanded : undefined}
                    >
                      <td>
                        <div className="aircall-group-contact">
                          {hasMany ? (
                            <span
                              className={`aircall-group-chevron${expanded ? " is-open" : ""}`}
                              aria-hidden
                            >
                              ›
                            </span>
                          ) : (
                            <span className="aircall-group-chevron is-spacer" />
                          )}
                          <div className="aircall-contact-cell">
                            {latest.contactId ? (
                              <>
                                <Link
                                  className="aircall-contact-link"
                                  href={portalContactRoute(
                                    latest.contactId,
                                    "/portal/aircall",
                                  )}
                                  title={`Open ${contactLabelRow} in CRM`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {contactLabelRow}
                                </Link>
                                {latest.contactEmail &&
                                latest.contactName &&
                                latest.contactEmail !== latest.contactName ? (
                                  <div className="aircall-muted">
                                    {latest.contactEmail}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <span className="aircall-muted">
                                No CRM contact for this number
                              </span>
                            )}
                            {hasMany ? (
                              <span className="aircall-call-count">
                                {group.calls.length} calls
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="aircall-when">
                          {formatCallWhen(latest.startedAt || latest.endedAt)}
                        </div>
                        {hasMany && !expanded ? (
                          <div className="aircall-muted">
                            Latest · click to show {extras.length} more
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code className="aircall-phone">
                          {latest.phone || "—"}
                        </code>
                      </td>
                      <td>{formatCallDuration(latest.durationSec)}</td>
                      <td>
                        <CallStatus call={latest} />
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {latest.recordingProxyUrl ? (
                          <AircallAudioPlayer
                            src={latest.recordingProxyUrl}
                          />
                        ) : (
                          <span className="aircall-muted">—</span>
                        )}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <CallNotes call={latest} onOpen={setNoteCall} />
                      </td>
                    </tr>
                    {expanded
                      ? extras.map((call) => (
                          <tr
                            key={`${group.key}-${call.id}`}
                            className="aircall-nested-row"
                          >
                            <CallCells
                              call={call}
                              showContact={false}
                              nested
                              onOpenNotes={setNoteCall}
                            />
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {noteCall?.recordingSummary ? (
        <CallNoteModal call={noteCall} onClose={() => setNoteCall(null)} />
      ) : null}
    </div>
  );
}
