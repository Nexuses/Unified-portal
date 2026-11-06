"use client";

import { useState } from "react";
import { Monitor } from "lucide-react";
import type { AssistantBoatCard } from "@/lib/assistant";

export default function PortalBoatCard({
  card,
  onOpen,
}: {
  card: AssistantBoatCard;
  onOpen: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openComputer() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/boat/desktop", { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: string; desktopUrl?: string } | null;
      if (!response.ok || !data?.desktopUrl) {
        throw new Error(data?.error || "Could not open the computer");
      }
      onOpen(data.desktopUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the computer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pa-boat">
      <div className="pa-boat-copy">
        <strong>LinkedIn computer</strong>
        <span>{card.state}</span>
        <p>{card.summary}</p>
      </div>
      <button type="button" className="pa-download" onClick={() => void openComputer()} disabled={busy}>
        <Monitor size={15} strokeWidth={2} aria-hidden="true" />
        {busy ? "Opening…" : "Open computer"}
      </button>
      {error ? <p className="pa-boat-error">{error}</p> : null}
    </div>
  );
}
