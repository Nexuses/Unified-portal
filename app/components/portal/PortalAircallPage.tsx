"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  const contactLabel = useMemo(() => {
    const name = String(nameParam || "").trim();
    if (name) return name;
    const dial = toE164Phone(dialParam || pendingDial || "");
    return dial || undefined;
  }, [nameParam, dialParam, pendingDial]);

  useEffect(() => {
    const to = toE164Phone(dialParam);
    if (!to) {
      return;
    }
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
            {projectName ? ` · ${projectName}` : ""}. Matched CRM calls land in
            the log below and on the contact timeline with recordings.
          </p>
        </div>
        <div className="aircall-head-actions">
          <button
            type="button"
            className="btn-dark"
            disabled={syncing || !configured}
            onClick={() => void syncNow()}
          >
            {syncing ? "Syncing…" : "Sync from Aircall"}
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

      <AircallWorkspaceDialer
        pendingDial={pendingDial}
        contactLabel={contactLabel}
        onPendingDialConsumed={() => {
          setPendingDial(null);
          clearDialQuery();
          setNotice("");
        }}
      />

      <div className="aircall-log-head">
        <h3>Project call log</h3>
        <p>Only numbers that match a CRM contact in this project are listed.</p>
      </div>

      {loading ? (
        <p className="aircall-empty">Loading calls…</p>
      ) : calls.length === 0 ? (
        <div className="aircall-empty-card">
          <h3>No calls in this project yet</h3>
          <p>
            Place a call from the dialer above, then click{" "}
            <strong>Sync from Aircall</strong> to pull it into this log.
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
                <th>Timeline</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const contactLabelRow =
                  call.contactName || call.contactEmail || "CRM contact";
                return (
                  <tr key={call.id}>
                    <td>
                      {call.contactId ? (
                        <div className="aircall-contact-cell">
                          <Link
                            className="aircall-contact-link"
                            href={portalContactRoute(
                              call.contactId,
                              "/portal/aircall",
                            )}
                            title={`Open ${contactLabelRow} in CRM`}
                          >
                            {contactLabelRow}
                          </Link>
                          {call.contactEmail &&
                          call.contactName &&
                          call.contactEmail !== call.contactName ? (
                            <div className="aircall-muted">
                              {call.contactEmail}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="aircall-muted">
                          No CRM contact for this number
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="aircall-when">
                        {formatCallWhen(call.startedAt || call.endedAt)}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`aircall-pill is-${call.direction || "unknown"}`}
                      >
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
                    <td>
                      {call.recordingProxyUrl ? (
                        <AircallAudioPlayer src={call.recordingProxyUrl} />
                      ) : (
                        <span className="aircall-muted">—</span>
                      )}
                    </td>
                    <td>
                      {call.timelineLogged ? (
                        <span className="aircall-pill is-ok">Logged</span>
                      ) : (
                        <span className="aircall-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
