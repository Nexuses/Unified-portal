"use client";

import { useState } from "react";
import { formatCloudStatus, type CloudCampaign } from "@/lib/cloud-campaigns";

const LOG_PAGE_SIZE = 8;

type Props = {
  campaign: CloudCampaign;
  busy: boolean;
  /** Every setup step is complete. */
  ready: boolean;
  /** Short reason shown when the campaign can't start yet. */
  blockedReason?: string;
  senderLabel: string;
  peopleLabel: string;
  gapMinutes: number;
  onGapChange: (value: number) => void;
  onSaveGap: () => void;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  onRestart: () => void;
  onClearLog: () => void;
  /** Undefined target = the sender's own address. */
  onSendTest: (to?: string) => void;
  canTest: boolean;
};

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function CloudCampaignRunPanel({
  campaign,
  busy,
  ready,
  blockedReason,
  senderLabel,
  peopleLabel,
  gapMinutes,
  onGapChange,
  onSaveGap,
  onStart,
  onStop,
  onResume,
  onRestart,
  onClearLog,
  onSendTest,
  canTest,
}: Props) {
  const [testTo, setTestTo] = useState("");
  const [logPage, setLogPage] = useState(1);

  const total = Math.max(0, campaign.sheetRowCount ?? 0);
  const processed = Math.min(total || Infinity, Math.max(0, campaign.nextRow || 0));
  const skipped = campaign.sendLog.filter((entry) => entry.status === "skipped").length;
  const remaining = Math.max(0, total - processed);
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const status = campaign.status;
  const sending = status === "sending";

  const logNewestFirst = [...campaign.sendLog].reverse();
  const pageCount = Math.max(1, Math.ceil(logNewestFirst.length / LOG_PAGE_SIZE));
  const safePage = Math.min(logPage, pageCount);
  const pageItems = logNewestFirst.slice((safePage - 1) * LOG_PAGE_SIZE, safePage * LOG_PAGE_SIZE);

  const live = campaign.lastError || campaign.lastReport || "";
  const testDisabled = busy || sending || !canTest;

  return (
    <section className="cloud-run" aria-label="Sending">
      <div className="cloud-run-top">
        <div className="cloud-run-state">
          <span className={`cloud-run-dot is-${status}`} aria-hidden="true" />
          <div>
            <strong>{formatCloudStatus(status)}</strong>
            <small>
              {senderLabel} · {peopleLabel}
            </small>
          </div>
        </div>
        <div className="cloud-run-actions">
          {sending ? (
            <button type="button" className="btn-soft" disabled={busy} onClick={onStop}>
              Stop
            </button>
          ) : null}
          {status === "paused" ? (
            <button type="button" className="btn-dark" disabled={busy || !ready} onClick={onResume}>
              Resume
            </button>
          ) : null}
          {status === "ready" || status === "draft" ? (
            <button
              type="button"
              className="btn-dark"
              disabled={busy || !ready}
              title={!ready ? blockedReason : undefined}
              onClick={onStart}
            >
              Start sending
            </button>
          ) : null}
          {status === "paused" || status === "sent" || sending ? (
            <button type="button" className="btn-soft" disabled={busy || !ready} onClick={onRestart}>
              Restart from row 1
            </button>
          ) : null}
        </div>
      </div>

      <div className="cloud-run-progress">
        <div
          className="cloud-run-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Rows processed"
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <ul className="cloud-run-stats">
          <li>
            <strong>{campaign.sentCount}</strong> sent
          </li>
          <li>
            <strong>{skipped}</strong> skipped
          </li>
          <li className={campaign.failedCount ? "is-bad" : ""}>
            <strong>{campaign.failedCount}</strong> failed
          </li>
          <li>
            <strong>{remaining}</strong> to go
          </li>
          <li className="cloud-run-stats-total">
            {processed} / {total} rows
          </li>
        </ul>
      </div>

      {!ready && blockedReason && (status === "ready" || status === "draft") ? (
        <p className="cloud-run-live">
          <strong>Before you start:</strong> {blockedReason}
        </p>
      ) : live ? (
        <p className={`cloud-run-live${campaign.lastError ? " is-error" : ""}`} role="status">
          <strong>{campaign.lastError ? "Needs attention:" : sending ? "Now:" : "Last:"}</strong> {live}
        </p>
      ) : null}

      <div className="cloud-run-controls">
        <div className="cloud-run-control">
          <label htmlFor="cloud-gap">Gap between emails</label>
          <div className="cloud-run-inline">
            <input
              id="cloud-gap"
              type="number"
              min={0}
              max={120}
              value={gapMinutes}
              onChange={(event) => onGapChange(Number(event.target.value) || 0)}
            />
            <span>min</span>
            <button type="button" className="btn-soft btn-sm" disabled={busy} onClick={onSaveGap}>
              Save
            </button>
          </div>
        </div>
        <div className="cloud-run-control cloud-run-test">
          <label htmlFor="cloud-test-to">Send a test of row 1</label>
          <div className="cloud-run-inline">
            <button
              type="button"
              className="btn-soft btn-sm"
              disabled={testDisabled}
              onClick={() => onSendTest()}
            >
              To myself
            </button>
            <input
              id="cloud-test-to"
              type="email"
              placeholder="or any email address"
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isEmail(testTo) && !testDisabled) {
                  event.preventDefault();
                  onSendTest(testTo.trim());
                }
              }}
            />
            <button
              type="button"
              className="btn-dark btn-sm"
              disabled={testDisabled || !isEmail(testTo)}
              onClick={() => onSendTest(testTo.trim())}
            >
              Send test
            </button>
          </div>
          {!canTest ? (
            <small className="cloud-run-help">Sign in the sender and add people to send a test.</small>
          ) : null}
        </div>
      </div>

      <div className="cloud-run-log">
        <div className="cloud-run-log-head">
          <strong>Recent sends</strong>
          {campaign.sendLog.length > 0 ? (
            <button type="button" className="cloud-link-btn" disabled={busy} onClick={onClearLog}>
              Clear
            </button>
          ) : null}
        </div>
        {pageItems.length === 0 ? (
          <p className="cloud-muted">Nothing sent yet.</p>
        ) : (
          <ul>
            {pageItems.map((entry, index) => (
              <li key={`${entry.at}-${entry.row}-${index}`}>
                <span className={`cloud-log-status ${entry.status}`}>{entry.status}</span>
                <span className="cloud-run-log-who">
                  <em>Row {entry.row + 1}</em> {entry.email || "—"}
                </span>
                {entry.message ? <small>{entry.message}</small> : null}
                <time dateTime={entry.at}>
                  {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 ? (
          <div className="cloud-log-pager">
            <button
              type="button"
              className="cloud-link-btn"
              disabled={safePage <= 1}
              onClick={() => setLogPage(Math.max(1, safePage - 1))}
            >
              ← Newer
            </button>
            <span>
              Page {safePage} of {pageCount} · {campaign.sendLog.length} total
            </span>
            <button
              type="button"
              className="cloud-link-btn"
              disabled={safePage >= pageCount}
              onClick={() => setLogPage(Math.min(pageCount, safePage + 1))}
            >
              Older →
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
