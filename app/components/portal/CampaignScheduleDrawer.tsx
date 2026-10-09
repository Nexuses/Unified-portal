"use client";

import { useState } from "react";
import { formatTimezoneLabel } from "@/lib/campaign-timezones";
import { zonedDateTimeToIso } from "@/lib/drip-campaigns";

export type CampaignScheduleInput = { mode: "now" | "later"; scheduledFor?: string };

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function CampaignScheduleDrawer({
  timezone,
  onClose,
  onConfirm,
}: {
  timezone: string;
  onClose: () => void;
  onConfirm: (input: CampaignScheduleInput) => Promise<void>;
}) {
  const now = new Date();
  const [mode, setMode] = useState<"now" | "later">("now");
  const [date, setDate] = useState(
    `${now.getFullYear()}-${padTime(now.getMonth() + 1)}-${padTime(now.getDate())}`,
  );
  const [hour, setHour] = useState(padTime(now.getHours()));
  const [minute, setMinute] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hours = Array.from({ length: 24 }, (_, index) => padTime(index));
  const minutes = ["00", "15", "30", "45"];

  async function handleConfirm() {
    setSaving(true);
    setError("");
    try {
      await onConfirm({
        mode,
        scheduledFor:
          mode === "later"
            ? zonedDateTimeToIso(date, hour, minute, timezone)
            : undefined,
      });
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Failed to launch campaign");
    }
  }

  return (
    <div className="drip-schedule-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="drip-schedule-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drip-schedule-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drip-schedule-head">
          <h3 id="drip-schedule-title">Schedule</h3>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drip-schedule-body">
          <div className="drip-schedule-question">When would you like to send the campaign?</div>

          <label className="drip-schedule-option">
            <input
              type="radio"
              name="drip-schedule-mode"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            <span>Send now</span>
          </label>

          <label className="drip-schedule-option">
            <input
              type="radio"
              name="drip-schedule-mode"
              checked={mode === "later"}
              onChange={() => setMode("later")}
            />
            <span>Schedule for later</span>
          </label>

          {mode === "later" ? (
            <div className="drip-schedule-later">
              <label className="drip-schedule-field">
                <span>Date</span>
                <div className="drip-schedule-select-wrap">
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  <ChevronDownIcon />
                </div>
              </label>

              <div className="drip-schedule-field">
                <span>Time</span>
                <div className="drip-schedule-time-row">
                  <div className="drip-schedule-select-wrap drip-schedule-time">
                    <select value={hour} onChange={(event) => setHour(event.target.value)}>
                      {hours.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                  <div className="drip-schedule-select-wrap drip-schedule-time">
                    <select value={minute} onChange={(event) => setMinute(event.target.value)}>
                      {minutes.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                </div>
                <div className="drip-schedule-tz">{formatTimezoneLabel(timezone)}</div>
              </div>
            </div>
          ) : null}
          {error ? <div className="drip-schedule-error">{error}</div> : null}
        </div>

        <div className="drip-schedule-foot">
          <button type="button" className="btn-dark" onClick={handleConfirm} disabled={saving}>
            {saving ? (
              <>
                <span className="drip-btn-spinner" aria-hidden="true" />
                {mode === "now" ? "Sending..." : "Scheduling..."}
              </>
            ) : mode === "now" ? (
              "Send now"
            ) : (
              "Schedule"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
