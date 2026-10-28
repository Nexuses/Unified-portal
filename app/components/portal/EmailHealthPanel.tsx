"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SmtpProviderBadge } from "@/app/components/portal/SmtpProviderBadge";
import type {
  ProjectEmailHealth,
  SenderEmailHealth,
} from "@/lib/email-health-server";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function healthStatusLabel(status: SenderEmailHealth["status"]) {
  if (status === "good") return "Good";
  if (status === "fair") return "Fair";
  return "Watch";
}

function HealthHelpTip() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="email-health-help" ref={wrapRef}>
      <button
        type="button"
        className="email-health-help-btn"
        aria-label="How sender health is calculated"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <div className="email-health-help-panel" role="dialog">
          <strong>How status is calculated</strong>
          <p>
            Status uses bounce rate from campaign sends for that sender
            (bounces ÷ sent).
          </p>
          <ul>
            <li>
              <span className="email-health-status is-good">Good</span>
              bounce rate under 2%
            </li>
            <li>
              <span className="email-health-status is-fair">Fair</span>
              bounce rate 2–4.9%, or no sends yet
            </li>
            <li>
              <span className="email-health-status is-watch">Watch</span>
              bounce rate 5% or higher
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SenderHealthCard({ row }: { row: SenderEmailHealth }) {
  return (
    <div className="vs-card email-health-sender-card">
      <div className="email-health-sender-row">
        <div className="vs-email-row email-health-sender-id">
          {row.providerId ? (
            <SmtpProviderBadge providerId={row.providerId} />
          ) : (
            <span className="email-health-provider-fallback">
              {row.provider}
            </span>
          )}
          <div className="vs-email">{row.fromEmail}</div>
        </div>
        <div className="email-health-sender-metrics">
          <div>
            <div className="k">Sent</div>
            <div className="v">{formatCount(row.sent)}</div>
          </div>
          <div>
            <div className="k">Opens</div>
            <div className="v">{formatCount(row.opens)}</div>
          </div>
          <div>
            <div className="k">Replies</div>
            <div className="v">
              {formatCount(row.replies)}
              {row.sent > 0 ? (
                <span className="email-health-rate">{row.replyRate}%</span>
              ) : null}
            </div>
          </div>
          <div>
            <div className="k">Bounces</div>
            <div className="v">
              {formatCount(row.bounces)}
              {row.sent > 0 ? (
                <span className="email-health-rate">{row.bounceRate}%</span>
              ) : null}
            </div>
          </div>
        </div>
        <span
          className={`email-health-status is-${row.status}`}
          title={
            row.sent > 0
              ? `Bounce rate ${row.bounceRate}% · Reply rate ${row.replyRate}%`
              : "No sends yet"
          }
        >
          {healthStatusLabel(row.status)}
        </span>
      </div>
    </div>
  );
}

type EmailHealthPanelProps = {
  compact?: boolean;
};

export default function EmailHealthPanel({
  compact = false,
}: EmailHealthPanelProps) {
  const [emailHealth, setEmailHealth] = useState<ProjectEmailHealth | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/dashboard/email-health", {
          cache: "no-store",
        });
        const data = (await response.json()) as ProjectEmailHealth & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Failed to load email health");
        }
        if (cancelled || !Array.isArray(data.senders)) {
          return;
        }
        setEmailHealth({
          senders: data.senders,
          totals: data.totals,
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load email health",
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (compact) {
    const watchCount =
      emailHealth?.senders.filter((row) => row.status === "watch").length ?? 0;
    const topSenders = (emailHealth?.senders ?? []).slice(0, 3);

    return (
      <div className="home-card email-health-card is-compact">
        <div className="home-card-head">
          <h3>Email health</h3>
          <Link href={PORTAL_ROUTES["smtp-health"]} className="link-blue">
            View all
          </Link>
        </div>

        {!emailHealth && !error ? (
          <div className="planned-empty">Loading…</div>
        ) : error ? (
          <div className="planned-empty">{error}</div>
        ) : !emailHealth || emailHealth.senders.length === 0 ? (
          <div className="planned-empty">No senders yet</div>
        ) : (
          <>
            <div className="email-health-totals is-compact">
              <div>
                <div className="k">Sent</div>
                <div className="v">{formatCount(emailHealth.totals.sent)}</div>
              </div>
              <div>
                <div className="k">Replies</div>
                <div className="v">
                  {formatCount(emailHealth.totals.replies)}
                </div>
              </div>
              <div>
                <div className="k">Bounces</div>
                <div className="v">
                  {formatCount(emailHealth.totals.bounces)}
                </div>
              </div>
            </div>
            {watchCount > 0 ? (
              <p className="email-health-watch-note">
                {watchCount} sender{watchCount === 1 ? "" : "s"} need attention
              </p>
            ) : (
              <p className="email-health-ok-note">
                All shown senders look healthy
              </p>
            )}
            <div className="email-health-compact-list">
              {topSenders.map((row) => (
                <div className="email-health-compact-row" key={row.id}>
                  <div className="email-health-compact-sender">
                    {row.providerId ? (
                      <SmtpProviderBadge
                        iconOnly
                        providerId={row.providerId}
                      />
                    ) : null}
                    <div className="email-health-compact-email">
                      {row.fromEmail}
                    </div>
                  </div>
                  <span className={`email-health-status is-${row.status}`}>
                    {healthStatusLabel(row.status)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="home-card-foot">
          <Link href={PORTAL_ROUTES["smtp-health"]} className="link-blue">
            Sender health
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="email-health-page">
      <div className="crm-page-head">
        <div>
          <h2>Sender health</h2>
          <p className="desc">
            Delivery performance across every SMTP sender.
          </p>
        </div>
        <div className="crm-actions">
          <Link href={PORTAL_ROUTES.smtp} className="btn-soft">
            Manage senders
          </Link>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      {!emailHealth && !error ? (
        <div className="crm-empty">Loading sender health…</div>
      ) : emailHealth && emailHealth.senders.length === 0 ? (
        <div className="crm-empty">
          No SMTP senders yet. Add a sender to track email health.
        </div>
      ) : emailHealth ? (
        <>
          <div className="email-health-summary">
            <div className="email-health-summary-item">
              <span className="k">Sent</span>
              <span className="v">{formatCount(emailHealth.totals.sent)}</span>
            </div>
            <div className="email-health-summary-item">
              <span className="k">Opens</span>
              <span className="v">{formatCount(emailHealth.totals.opens)}</span>
            </div>
            <div className="email-health-summary-item">
              <span className="k">Replies</span>
              <span className="v">
                {formatCount(emailHealth.totals.replies)}
              </span>
            </div>
            <div className="email-health-summary-item">
              <span className="k">Bounces</span>
              <span className="v">
                {formatCount(emailHealth.totals.bounces)}
              </span>
            </div>
          </div>

          <div className="vs-section email-health-section">
            <div className="email-health-section-head">
              <h3>Senders ({emailHealth.senders.length})</h3>
              <div className="email-health-section-help">
                <span>Status</span>
                <HealthHelpTip />
              </div>
            </div>
            <div className="vs-list">
              {emailHealth.senders.map((row) => (
                <SenderHealthCard key={row.id} row={row} />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
