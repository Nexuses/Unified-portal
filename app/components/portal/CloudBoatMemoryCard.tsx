"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatCloudSenderProvider,
  type CloudSenderProvider,
} from "@/lib/cloud-campaigns";
import {
  BOAT_MEMORY_INSTRUCTIONS_MAX,
  type ProjectBoatMemory,
} from "@/lib/boat-memory-types";

export default function CloudBoatMemoryCard() {
  const [memory, setMemory] = useState<ProjectBoatMemory | null>(null);
  const [instructions, setInstructions] = useState("");
  const [provider, setProvider] = useState<CloudSenderProvider | "">("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/boat/memory", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as {
        memory?: ProjectBoatMemory;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Could not load memory");
      }
      const next = data?.memory ?? null;
      setMemory(next);
      setInstructions(next?.instructions || "");
      setProvider(next?.defaults.preferredProvider || "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load memory");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save() {
    setBusy(true);
    setSavedNotice("");
    setError("");
    try {
      const response = await fetch("/api/boat/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructions,
          defaults: {
            preferredProvider: provider || undefined,
            defaultProfileId: memory?.defaults.defaultProfileId,
            notes: memory?.defaults.notes,
          },
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        memory?: ProjectBoatMemory;
        error?: string;
      } | null;
      if (!response.ok || !data?.memory) {
        throw new Error(data?.error || "Could not save memory");
      }
      setMemory(data.memory);
      setInstructions(data.memory.instructions || "");
      setProvider(data.memory.defaults.preferredProvider || "");
      setSavedNotice("Saved for this project.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save memory");
    } finally {
      setBusy(false);
    }
  }

  const summary = memory?.instructions?.trim()
    ? memory.instructions.trim().slice(0, 48) +
      (memory.instructions.trim().length > 48 ? "…" : "")
    : memory?.defaults.preferredProvider
      ? `Prefer ${formatCloudSenderProvider(memory.defaults.preferredProvider)}`
      : "Empty — add prefs";

  return (
    <div className="cloud-usage-card cloud-memory-card">
      <button
        type="button"
        className="cloud-usage-summary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="cloud-usage-label">
          <strong>Computer memory</strong>
          <small>Remembered for this project</small>
        </span>
        <span className="cloud-usage-total cloud-memory-summary">{summary}</span>
      </button>
      {open ? (
        <div className="cloud-usage-detail">
          <p className="cloud-muted">
            Durable prefs for Boat (e.g. “send email via Outlook”). Injected into every computer
            task so you do not re-prompt. Campaign extra prompt still applies on top.
          </p>
          <label className="crm-field">
            <span>Instructions</span>
            <textarea
              value={instructions}
              maxLength={BOAT_MEMORY_INSTRUCTIONS_MAX}
              rows={4}
              disabled={busy}
              placeholder="Send email via Outlook as fatima@…"
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <div className="cloud-provider-toggle" role="group" aria-label="Preferred mail client">
            <button
              type="button"
              className={provider === "gmail" ? "is-active" : ""}
              disabled={busy}
              onClick={() => setProvider("gmail")}
            >
              Prefer Gmail
            </button>
            <button
              type="button"
              className={provider === "outlook" ? "is-active" : ""}
              disabled={busy}
              onClick={() => setProvider("outlook")}
            >
              Prefer Outlook
            </button>
            <button
              type="button"
              className={provider === "" ? "is-active" : ""}
              disabled={busy}
              onClick={() => setProvider("")}
            >
              No preference
            </button>
          </div>
          {memory?.defaults.defaultProfileId ? (
            <p className="cloud-muted">
              Default sender profile remembered after inbox confirm.
            </p>
          ) : null}
          {error ? <p className="crm-error">{error}</p> : null}
          {savedNotice ? <p className="cloud-muted">{savedNotice}</p> : null}
          <div className="cloud-step-actions">
            <button type="button" className="btn-dark" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save memory"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
