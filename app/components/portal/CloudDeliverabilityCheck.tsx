"use client";

import { useState } from "react";
import { runCloudCampaignAction } from "@/lib/cloud-campaigns";

type CheckStatus = "success" | "warning" | "failure" | "neutral";
type CheckItem = { title: string; status: CheckStatus; mark: number; description: string; detail?: string };
type Report = {
  score: number;
  rating: string;
  comment: string;
  inboxEmail: string;
  messageInfo: { subject: string; from: string; receivedAt: string };
  spamAssassin: {
    rawScore: number;
    displayScore: number;
    rules: { name: string; score: number; description: string }[];
    error?: string;
  };
  authentication: { spf: CheckItem; dkim: CheckItem; dmarc: CheckItem };
  blacklists: { ip: string | null; listedCount: number; checks: { label: string; zone: string; listed: boolean; detail?: string }[] };
  content: CheckItem[];
  checkedAt: string;
};

function tone(score: number) {
  if (score >= 7) return "low";
  if (score >= 5) return "moderate";
  return "high";
}

function statusLabel(status: CheckStatus) {
  if (status === "success") return "Pass";
  if (status === "warning") return "Warn";
  if (status === "failure") return "Fail";
  return "Info";
}

function mark(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? "0" : `${rounded > 0 ? "+" : ""}${rounded}`;
}

function Checks({ items }: { items: CheckItem[] }) {
  return (
    <ul className="drip-deliverability-checks">
      {items.map((item) => (
        <li key={item.title} className={`is-${item.status}`}>
          <span>{statusLabel(item.status)}</span>
          <div>
            <strong>{item.title}</strong>
            <em>{item.detail || item.description}</em>
          </div>
        </li>
      ))}
    </ul>
  );
}

type Props = {
  campaignId: string;
  /** Sender signed in and people added (row 1 is what gets tested). */
  canTest: boolean;
  /** Something else is running on the page or the campaign is sending. */
  busy: boolean;
  onDesktopUrl?: (url: string) => void;
};

/**
 * Deliverability check, as for SMTP campaigns: row 1's email goes from the cloud sender's own
 * Gmail/Outlook to a test inbox (AgentMail) and is scored for spam filters, SPF/DKIM/DMARC,
 * blacklists and content.
 */
export default function CloudDeliverabilityCheck({ campaignId, canTest, busy, onDesktopUrl }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function run() {
    setRunning(true);
    setError("");
    try {
      const data = await runCloudCampaignAction(campaignId, "deliverability_test");
      if (typeof data.desktopUrl === "string" && data.desktopUrl) onDesktopUrl?.(data.desktopUrl);
      setReport(data.report as Report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The deliverability check failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="cloud-deliverability">
      <div className="cloud-deliverability-head">
        <div>
          <strong>Deliverability check</strong>
          <small>
            Sends row 1&apos;s email from this sender to a test inbox and checks spam score,
            SPF/DKIM/DMARC, blacklists and content. Takes 1–3 minutes.
          </small>
        </div>
        <button type="button" className="btn-soft btn-sm" disabled={!canTest || busy || running} onClick={() => void run()}>
          {running ? (
            <>
              <span className="drip-btn-spinner" aria-hidden="true" />
              Checking…
            </>
          ) : report ? (
            "Check again"
          ) : (
            "Check deliverability"
          )}
        </button>
      </div>
      {error ? <p className="drip-preview-status error">{error}</p> : null}

      {report ? (
        <div className="cloud-deliverability-body">
          <div className="drip-spam-score-row">
            <span className={`drip-spam-score drip-spam-score-${tone(report.score)}`}>
              {report.score}
              <small>/10</small>
            </span>
            <div className="drip-spam-score-meta">
              <strong>{report.rating}</strong>
              <span>{report.comment}</span>
            </div>
            <button
              type="button"
              className={`drip-deliverability-score-help${helpOpen ? " is-open" : ""}`}
              aria-label="How is this score calculated?"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((open) => !open)}
            >
              ?
            </button>
          </div>

          {helpOpen ? (
            <div className="drip-deliverability-score-explainer">
              <strong>How the /10 score is calculated</strong>
              <ul className="drip-deliverability-score-breakdown">
                <li>
                  <span>SpamAssassin base (10 − raw score)</span>
                  <strong>{report.spamAssassin.displayScore}</strong>
                </li>
                <li>
                  <span>SPF</span>
                  <strong>{mark(report.authentication.spf.mark)}</strong>
                </li>
                <li>
                  <span>DKIM</span>
                  <strong>{mark(report.authentication.dkim.mark)}</strong>
                </li>
                <li>
                  <span>DMARC</span>
                  <strong>{mark(report.authentication.dmarc.mark)}</strong>
                </li>
                <li>
                  <span>Blacklists{report.blacklists.listedCount ? ` (${report.blacklists.listedCount})` : ""}</span>
                  <strong>{mark(Math.max(-3, report.blacklists.listedCount * -1.5))}</strong>
                </li>
                <li>
                  <span>Content</span>
                  <strong>{mark(report.content.reduce((sum, item) => sum + item.mark, 0))}</strong>
                </li>
                <li className="is-total">
                  <span>Final</span>
                  <strong>{report.score}/10</strong>
                </li>
              </ul>
              <p>Ratings: 9+ Excellent · 7+ Good · 5+ Fair · 3+ Poor · below 3 Spam risk.</p>
            </div>
          ) : null}

          <div className="drip-deliverability-section">
            <h4>Message</h4>
            <ul className="drip-deliverability-list">
              <li>
                <span>Subject</span>
                <strong>{report.messageInfo.subject}</strong>
              </li>
              <li>
                <span>From</span>
                <strong>{report.messageInfo.from}</strong>
              </li>
              <li>
                <span>Received</span>
                <strong>{new Date(report.messageInfo.receivedAt).toLocaleString()}</strong>
              </li>
            </ul>
          </div>

          <div className="drip-deliverability-section">
            <h4>
              SpamAssassin{" "}
              <small>
                raw {report.spamAssassin.rawScore} → {report.spamAssassin.displayScore}/10
              </small>
            </h4>
            {report.spamAssassin.error ? (
              <p className="drip-preview-status error">SpamAssassin unavailable: {report.spamAssassin.error}</p>
            ) : report.spamAssassin.rules.length ? (
              <ul className="drip-deliverability-rules">
                {report.spamAssassin.rules.map((rule, index) => (
                  <li key={`${rule.name}-${index}`}>
                    <span className={rule.score > 0 ? "is-bad" : rule.score < 0 ? "is-good" : ""}>
                      {rule.score > 0 ? "+" : ""}
                      {rule.score}
                    </span>
                    <strong>{rule.name}</strong>
                    <em>{rule.description}</em>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drip-spam-test-copy">No notable SpamAssassin rules matched.</p>
            )}
          </div>

          <div className="drip-deliverability-section">
            <h4>Authentication</h4>
            <Checks items={[report.authentication.spf, report.authentication.dkim, report.authentication.dmarc]} />
            <p className="drip-spam-test-copy">
              SPF/DKIM/DMARC come from the sender&apos;s own mail provider (Google or Microsoft) and the
              domain&apos;s DNS, not from the portal.
            </p>
          </div>

          <div className="drip-deliverability-section">
            <h4>Blacklists{report.blacklists.ip ? ` · ${report.blacklists.ip}` : ""}</h4>
            {report.blacklists.checks.length === 0 ? (
              <p className="drip-spam-test-copy">Could not detect a public sending IP from the Received headers.</p>
            ) : (
              <ul className="drip-deliverability-checks">
                {report.blacklists.checks.map((check) => (
                  <li key={check.zone} className={check.listed ? "is-failure" : "is-success"}>
                    <span>{check.listed ? "Listed" : "Clean"}</span>
                    <div>
                      <strong>{check.label}</strong>
                      <em>{check.detail || check.zone}</em>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="drip-deliverability-section">
            <h4>Content</h4>
            <Checks items={report.content} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
