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
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (error) {
    return (
      <div className="cloud-usage-card cloud-usage-card-muted">
        <strong>Computer cost</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="cloud-usage-card cloud-usage-card-muted">
        <strong>Computer cost</strong>
        <span>{message || "Loading…"}</span>
      </div>
    );
  }

  return (
    <div className="cloud-usage-card">
      <button
        type="button"
        className="cloud-usage-summary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="cloud-usage-label">
          <strong>Computer cost</strong>
          <small>Last {usage.days} days · estimated</small>
        </span>
        <span className="cloud-usage-total">{formatUsd(usage.totalEstimatedUsd)}</span>
      </button>
      {open ? (
        <div className="cloud-usage-detail">
          <ul>
            <li>
              <span>Claude tokens (est.)</span>
              <strong>{formatUsd(usage.claudeEstimatedUsd)}</strong>
            </li>
            <li>
              <span>Boat AI proxy</span>
              <strong>{formatUsd(usage.boatProxyUsd)}</strong>
            </li>
            <li>
              <span>Boat machine time</span>
              <strong>{formatUsd(usage.boatMachineUsd)}</strong>
            </li>
          </ul>
          <p className="cloud-muted">
            {formatTokenCount(usage.inputTokens)} in · {formatTokenCount(usage.outputTokens)} out
            {usage.cacheReadTokens
              ? ` · ${formatTokenCount(usage.cacheReadTokens)} cache read`
              : ""}
            {" · "}
            {usage.requests} requests
            {usage.models.length ? ` · ${usage.models.join(", ")}` : ""}
          </p>
          <p className="cloud-muted">
            Claude $ is estimated from Boat-reported tokens (list prices). Exact Anthropic billing
            stays on your Claude account. Boat proxy/machine amounts come from Boat.
          </p>
        </div>
      ) : null}
    </div>
  );
}
