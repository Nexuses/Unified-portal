"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AircallAudioPlayer from "@/app/components/portal/AircallAudioPlayer";
import {
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
}: {
  call: AircallCallRow;
  showContact: boolean;
  nested?: boolean;
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
        <span className={`aircall-pill is-${call.direction || "unknown"}`}>
          {call.direction || "—"}
        </span>
      </td>
      <td>
        <code className="aircall-phone">{call.phone || "—"}</code>
      </td>
      <td>
        <div>{call.userName || "—"}</div>
        {call.numberName ? (
          <div className="aircall-muted">{call.numberName}</div>
        ) : null}
      </td>
      <td>{formatCallDuration(call.durationSec)}</td>
      <td onClick={(event) => event.stopPropagation()}>
        {call.recordingProxyUrl ? (
          <AircallAudioPlayer src={call.recordingProxyUrl} />
        ) : (
          <span className="aircall-muted">—</span>
        )}
      </td>
    </>
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
        <div>
          <h2>Calling</h2>
          <p className="desc">
            Dial from here with the embedded phone workspace
            {projectName ? ` · ${projectName}` : ""}. Calls sync from Aircall
            automatically every 10 minutes (or use Sync now).
            <br />
            Matched CRM calls land in the log below and on the contact timeline
            with recordings.
          </p>
        </div>
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
                <th>Direction</th>
                <th>Phone</th>
                <th>Agent</th>
                <th>Duration</th>
                <th>Recording</th>
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
                        <span
                          className={`aircall-pill is-${latest.direction || "unknown"}`}
                        >
                          {latest.direction || "—"}
                        </span>
                      </td>
                      <td>
                        <code className="aircall-phone">
                          {latest.phone || "—"}
                        </code>
                      </td>
                      <td>
                        <div>{latest.userName || "—"}</div>
                        {latest.numberName ? (
                          <div className="aircall-muted">
                            {latest.numberName}
                          </div>
                        ) : null}
                      </td>
                      <td>{formatCallDuration(latest.durationSec)}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {latest.recordingProxyUrl ? (
                          <AircallAudioPlayer
                            src={latest.recordingProxyUrl}
                          />
                        ) : (
                          <span className="aircall-muted">—</span>
                        )}
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
    </div>
  );
}
