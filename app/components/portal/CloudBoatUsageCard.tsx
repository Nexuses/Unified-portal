"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatTokenCount,
  formatUsd,
  type BoatUsageSummary,
} from "@/lib/boat-usage";

export default function CloudBoatUsageCard({ days = 30 }: { days?: number }) {
  const [usage, setUsage] = useState<BoatUsageSummary | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/boat/usage?days=${days}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as {
        usage?: BoatUsageSummary | null;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Could not load usage");
      }
      setUsage(data?.usage ?? null);
      setMessage(typeof data?.message === "string" ? data.message : "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load usage");
    }
  }, [days]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (error) {
    return (
      <div className="cloud-usage-card cloud-usage-card-muted">
        <strong>Cloud campaign cost</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="cloud-usage-card cloud-usage-card-muted">
        <strong>Cloud campaign cost</strong>
        <span>{message || "Loading…"}</span>
      </div>
    );
  }

  const running = usage.machineRunning === true;
  const stateLabel = running
    ? "Running"
    : usage.machineState === "none"
      ? "Not linked"
      : "Stopped";

  return (
    <div className="cloud-usage-card">
      <button
        type="button"
        className="cloud-usage-summary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="cloud-usage-label">
          <strong>Cloud campaign cost</strong>
          <small>
            <span className={`cloud-machine-pill${running ? " is-on" : ""}`}>{stateLabel}</span>
            {" · "}
            Last {usage.days} days · estimated
          </small>
        </span>
        <span className="cloud-usage-total">{formatUsd(usage.totalEstimatedUsd)}</span>
      </button>
      {open ? (
        <div className="cloud-usage-detail">
          <ul>
            <li>
              <span>Computer time</span>
              <strong>{formatUsd(usage.boatMachineUsd)}</strong>
            </li>
            <li>
              <span>Saved backup</span>
              <strong>{usage.backupIncluded !== false ? "Included" : formatUsd(usage.backupUsd ?? 0)}</strong>
            </li>
            <li>
              <span>AI</span>
              <strong>{formatUsd(usage.claudeEstimatedUsd + usage.boatProxyUsd)}</strong>
            </li>
          </ul>
          <p className="cloud-muted">
            This project&apos;s cloud campaigns only — their own computer
            {usage.computers && usage.computers > 1 ? ` (${usage.computers} over time)` : ""}, separate
            from the assistant and LinkedIn. Sending uses no AI.
            {usage.requests
              ? ` ${usage.requests} AI requests (${formatTokenCount(usage.inputTokens)} in · ${formatTokenCount(usage.outputTokens)} out) came from the optional agent fallback.`
              : ""}
          </p>
          <p className="cloud-muted">
            {running
              ? "Machine billing is active while the computer is running."
              : "Machine billing pauses when the computer is stopped. Start the computer (or send/verify) to resume the same disk."}
            {" "}
            Idle computers stop after about 30 minutes with no work (unless a campaign holds the lock).
          </p>

        </div>
      ) : null}
    </div>
  );
}
