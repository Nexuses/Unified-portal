"use client";

import { useState } from "react";
import { formatCloudCampaignStatus, type CloudCampaign } from "@/lib/cloud-campaigns";
import { countSentToday, normalizeDailyLimit } from "@/lib/cloud-schedule";

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
  /** One line: start, days, hours, timezone and gap (set in the When to send step). */
  whenSummary: string;
  whenSaved: boolean;
  onEditWhen: () => void;
  /** The computer is on: offer to watch it (opens or reconnects the live view). */
  liveAvailable?: boolean;
  onWatchLive?: () => void;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  onRestart: () => void;
  onClearLog: () => void;
  /** Undefined target = the sender's own address. */
  onSendTest: (to?: string) => void;
  canTest: boolean;
  /** A future start time is saved: offer Schedule instead of starting now. */
  canSchedule?: boolean;
  onSchedule?: () => void;
  onCancelSchedule?: () => void;
  /** Sender's Chrome is signed in and checked (needed before Resume after a sign-out). */
  senderSignedIn?: boolean;
  senderEmail?: string;
  onOpenSender?: () => void;
  onCheckSender?: () => void;
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
  whenSummary,
  whenSaved,
  onEditWhen,
  liveAvailable,
  onWatchLive,
  onStart,
  onStop,
  onResume,
  onRestart,
  onClearLog,
  onSendTest,
  canTest,
  canSchedule,
  onSchedule,
  onCancelSchedule,
  senderSignedIn,
  senderEmail,
  onOpenSender,
  onCheckSender,
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
  const dailyLimit = normalizeDailyLimit(campaign.schedule?.dailyLimit);
  const sentToday = dailyLimit ? countSentToday(campaign.sendLog || [], campaign.schedule?.timezone || "UTC") : 0;

  const logNewestFirst = [...campaign.sendLog].reverse();
  const pageCount = Math.max(1, Math.ceil(logNewestFirst.length / LOG_PAGE_SIZE));
  const safePage = Math.min(logPage, pageCount);
  const pageItems = logNewestFirst.slice((safePage - 1) * LOG_PAGE_SIZE, safePage * LOG_PAGE_SIZE);

  const live = campaign.lastError || campaign.lastReport || "";
  const resumeRow = processed + 1;
  const stopKind = status === "paused" ? campaign.stopKind : undefined;
  const testDisabled = busy || sending || !canTest;

  return (
    <section className="cloud-run" aria-label="Sending">
      <div className="cloud-run-top">
        <div className="cloud-run-state">
          <span className={`cloud-run-dot is-${status}`} aria-hidden="true" />
          <div>
            <strong>{formatCloudCampaignStatus(campaign).label}</strong>
            <small>
              {senderLabel} · {peopleLabel}
            </small>
          </div>
        </div>
        <div className="cloud-run-actions">
          {liveAvailable && onWatchLive ? (
            <button type="button" className="btn-soft" disabled={busy} onClick={onWatchLive}>
              Watch live
            </button>
          ) : null}
          {sending ? (
            <button type="button" className="btn-soft" disabled={busy} onClick={onStop}>
              Stop
            </button>
          ) : null}
          {status === "paused" ? (
            <button
              type="button"
              className="btn-dark"
              disabled={busy || !ready}
              title={!ready ? blockedReason : undefined}
              onClick={onResume}
            >
              {total && resumeRow <= total ? `Resume from row ${resumeRow}` : "Resume"}
            </button>
          ) : null}
          {status === "scheduled" ? (
            <button type="button" className="btn-soft" disabled={busy} onClick={onCancelSchedule}>
              Cancel schedule
            </button>
          ) : null}
          {(status === "ready" || status === "draft") && canSchedule ? (
            <button
              type="button"
              className="btn-dark"
              disabled={busy || !ready}
              title={!ready ? blockedReason : undefined}
              onClick={onSchedule}
            >
              Schedule
            </button>
          ) : null}
          {status === "ready" || status === "draft" ? (
            <button
              type="button"
              className={canSchedule ? "btn-soft" : "btn-dark"}
              disabled={busy || !ready}
              title={!ready ? blockedReason : undefined}
              onClick={onStart}
            >
              {canSchedule ? "Start now" : "Start sending"}
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
          {dailyLimit ? (
            <li
              className={sentToday >= dailyLimit ? "is-done" : ""}
              title="Daily target. Anyone not reached today goes first on the next sending day."
            >
              Today <strong>{sentToday}</strong> / {dailyLimit}
            </li>
          ) : null}
          <li className="cloud-run-stats-total">
            {processed} / {total} rows
          </li>
        </ul>
      </div>

      {stopKind ? (
        <div className={`cloud-recover is-${stopKind}`} role="alert">
          <div className="cloud-recover-head">
            <strong>
              {stopKind === "signed_out"
                ? `Sender signed out — stopped at row ${resumeRow}${total ? ` of ${total}` : ""}`
                : stopKind === "schedule"
                  ? "Waiting — the schedule allows no sending days"
                  : `Stopped at row ${resumeRow}${total ? ` of ${total}` : ""}`}
            </strong>
            {campaign.stoppedAt ? <small>{new Date(campaign.stoppedAt).toLocaleString()}</small> : null}
          </div>
          {stopKind === "signed_out" ? (
            <ol>
              <li className={senderSignedIn ? "is-done" : ""}>
                <span>
                  Sign in again{senderEmail ? ` as ${senderEmail}` : ""} in the sender&apos;s Chrome.
                </span>
                <button type="button" className="btn-soft btn-sm" disabled={busy} onClick={onOpenSender}>
                  Open sender Chrome
                </button>
              </li>
              <li className={senderSignedIn ? "is-done" : ""}>
                <span>{senderSignedIn ? "Sign-in checked." : "Check the sign-in."}</span>
                <button type="button" className="btn-soft btn-sm" disabled={busy} onClick={onCheckSender}>
                  Check sign-in
                </button>
              </li>
              <li>
                <span>
                  Resume — it continues from row {resumeRow}. Nothing already sent goes out again.
                </span>
                <button type="button" className="btn-dark btn-sm" disabled={busy || !ready} onClick={onResume}>
                  Resume from row {resumeRow}
                </button>
              </li>
            </ol>
          ) : (
            <p>
              {campaign.lastError || "Sending stopped."}{" "}
              {stopKind === "schedule"
                ? "Allow at least one day in When to send, save it, then Resume."
                : `Fix it if needed, then Resume — it continues from row ${resumeRow}.`}
            </p>
          )}
        </div>
      ) : !ready && blockedReason && (status === "ready" || status === "draft") ? (
        <p className="cloud-run-live">
          <strong>Before you start:</strong> {blockedReason}
        </p>
      ) : live ? (
        <p className={`cloud-run-live${campaign.lastError ? " is-error" : ""}`} role="status">
          <strong>{campaign.lastError ? "Needs attention:" : sending ? "Now:" : "Last:"}</strong> {live}
        </p>
      ) : null}

      <div className={`cloud-run-when-summary${whenSaved ? "" : " is-missing"}`}>
        <div>
          <strong>When to send</strong>
          <span>{whenSummary}</span>
        </div>
        <button type="button" className="btn-soft btn-sm" disabled={busy} onClick={onEditWhen}>
          {whenSaved ? "Edit" : "Set it now"}
        </button>
      </div>

      <div className="cloud-run-controls">
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
