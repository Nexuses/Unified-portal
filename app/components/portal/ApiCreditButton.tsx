"use client";

import { useEffect, useState } from "react";
import { formatApiCreditUsd, type ApiCreditStatus } from "@/lib/api-credits";

type ApiCreditButtonProps = {
  onOpen?: () => void;
};

function providerLabel(provider: string) {
  const names: Record<string, string> = {
    claude: "Claude",
    openai: "OpenAI",
    deepseek: "DeepSeek",
    grok: "Grok",
    gemini: "Gemini",
    higgsfield: "Higgsfield",
    mxtoolbox: "MX Toolbox",
    sendgrid: "SendGrid",
    resend: "Resend",
  };
  return names[provider] || provider;
}

function formatCreditWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ApiCreditButton({ onOpen }: ApiCreditButtonProps) {
  const [credits, setCredits] = useState<ApiCreditStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void loadCredits(() => cancelled);
    refresh();
    const timer = window.setInterval(refresh, 12000);
    window.addEventListener("focus", refresh);
    window.addEventListener("nexuses-api-credit", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("nexuses-api-credit", refresh);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  async function loadCredits(isCancelled: () => boolean = () => false) {
    try {
      const response = await fetch("/api/api-credits");
      const data = (await response.json()) as ApiCreditStatus;
      if (!isCancelled() && response.ok) setCredits(data);
    } catch {
      // The pill stays on the last known amount.
    }
  }

  if (!credits) return null;

  const usedShare =
    credits.limitUsd > 0 ? Math.min(100, (credits.usedUsd / credits.limitUsd) * 100) : 0;

  return (
    <>
      <button
        type="button"
        className={`api-credit-pill${open ? " open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          void loadCredits();
          onOpen?.();
          setOpen(true);
        }}
      >
        API {formatApiCreditUsd(credits.usedUsd)}
        <span>/ {formatApiCreditUsd(credits.limitUsd)}</span>
      </button>
      {open ? (
        <div className="api-credit-backdrop" onClick={() => setOpen(false)}>
          <div
            className="api-credit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-credit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="api-credit-modal-head">
              <div>
                <h2 id="api-credit-title">API credit</h2>
                <p>
                  {formatApiCreditUsd(credits.usedUsd)} of {formatApiCreditUsd(credits.limitUsd)} used
                </p>
              </div>
              <button
                type="button"
                className="api-credit-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="api-credit-stats">
              <div>
                <span>Used</span>
                <strong>{formatApiCreditUsd(credits.usedUsd)}</strong>
              </div>
              <div>
                <span>Limit</span>
                <strong>{formatApiCreditUsd(credits.limitUsd)}</strong>
              </div>
              <div>
                <span>Left</span>
                <strong>{formatApiCreditUsd(credits.remainingUsd)}</strong>
              </div>
            </div>
            <div className="api-credit-bar" aria-hidden="true">
              <span style={{ width: `${usedShare}%` }} />
            </div>
            {credits.items.length === 0 ? (
              <p className="api-credit-empty">No API use yet.</p>
            ) : (
              <>
                <h3>Where it was used</h3>
                <div className="api-credit-block">
                  <table className="api-credit-table">
                    <thead>
                      <tr>
                        <th>Feature</th>
                        <th>Calls</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {credits.items.map((item) => (
                        <tr key={item.feature}>
                          <td>{item.label}</td>
                          <td>{item.calls}</td>
                          <td>{formatApiCreditUsd(item.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>Recent calls</h3>
                <div className="api-credit-recent">
                  <table className="api-credit-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Feature</th>
                        <th>Model</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(credits.recent ?? []).map((entry, index) => (
                        <tr key={`${entry.createdAt}-${entry.feature}-${index}`}>
                          <td>{formatCreditWhen(entry.createdAt)}</td>
                          <td>{entry.label}</td>
                          <td>
                            {providerLabel(entry.provider)}
                            {entry.model && entry.model !== entry.provider ? ` · ${entry.model}` : ""}
                          </td>
                          <td>{formatApiCreditUsd(entry.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
