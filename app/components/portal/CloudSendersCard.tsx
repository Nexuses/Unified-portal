"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCloudProfiles,
  formatCloudSenderProvider,
  type CloudChromeProfile,
} from "@/lib/cloud-campaigns";

type Backup = {
  status: "saving" | "ready" | "failed" | "none";
  createdAt?: string;
  snapshotRequestedAt?: string;
  restoredFromSnapshotAt?: string;
  error?: string;
};

function when(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleDateString([], { day: "numeric", month: "short" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * What the project remembers for sending: each sender's sign-in, and the saved backup that
 * brings those logins back when the computer's disk has expired.
 */
export default function CloudSendersCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<CloudChromeProfile[]>([]);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextProfiles, backupData] = await Promise.all([
        fetchCloudProfiles(),
        fetch("/api/boat/backup", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setProfiles(nextProfiles);
      setBackup((backupData?.backup as Backup) || null);
    } catch {
      /* card is informational; ignore load errors */
    }
  }, []);

  useEffect(() => {
    // Data fetch on mount / when the page asks for a refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  async function backUpNow() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/boat/backup", { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not start the backup");
      setMessage("Backup started — it finishes in a few minutes.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the backup");
    } finally {
      setBusy(false);
    }
  }

  const signedIn = profiles.filter((p) => p.scriptEmail).length;
  const backupLabel =
    backup?.status === "ready"
      ? `Backed up ${when(backup.createdAt)}`
      : backup?.status === "saving"
        ? "Backing up…"
        : backup?.status === "failed"
          ? "Backup failed"
          : "No backup yet";

  return (
    <div className="cloud-usage-card cloud-memory-card">
      <button
        type="button"
        className="cloud-usage-summary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="cloud-usage-label">
          <strong>Senders</strong>
          <small>{backupLabel}</small>
        </span>
        <span className="cloud-usage-total cloud-memory-summary">
          {signedIn}/{profiles.length} signed in
        </span>
      </button>
      {open ? (
        <div className="cloud-usage-detail">
          <p className="cloud-muted">
            Logins live on the computer. A saved backup keeps them when the computer&apos;s disk
            expires after a quiet couple of weeks, so a monthly campaign doesn&apos;t start from a
            blank desktop. Each sender also remembers its signature, gap and column mapping.
          </p>
          <ul className="cloud-senders-list">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <span className={`cloud-run-dot ${profile.scriptEmail ? "is-ready" : ""}`} aria-hidden="true" />
                <span>
                  <strong>{profile.scriptEmail || profile.gmail || profile.label}</strong>
                  <small>
                    {formatCloudSenderProvider(profile.provider)} ·{" "}
                    {profile.scriptEmail
                      ? `signed in · checked ${when(profile.scriptCheckedAt)}`
                      : "not signed in"}
                    {profile.sensitivityLabel ? ` · label ${profile.sensitivityLabel}` : ""}
                    {profile.hasDefaults ? " · defaults saved" : ""}
                  </small>
                </span>
              </li>
            ))}
            {profiles.length === 0 ? <li className="cloud-muted">No senders yet.</li> : null}
          </ul>
          {backup?.restoredFromSnapshotAt ? (
            <p className="cloud-muted">Computer last rebuilt from backup {when(backup.restoredFromSnapshotAt)}.</p>
          ) : null}
          {backup?.error ? <p className="crm-error">{backup.error}</p> : null}
          {message ? <p className="cloud-muted">{message}</p> : null}
          <div className="cloud-step-actions">
            <button type="button" className="btn-soft btn-sm" disabled={busy} onClick={() => void backUpNow()}>
              {busy ? "Starting…" : "Back up now"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
