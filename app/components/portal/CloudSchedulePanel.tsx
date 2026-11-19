"use client";

import { useMemo, useState } from "react";
import {
  WEEKDAYS,
  describeSchedule,
  hasWindow,
  utcToZonedLocal,
  zonedLocalToUtc,
  type CloudSchedule,
} from "@/lib/cloud-schedule";

const COMMON_ZONES = [
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function allZones() {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.("timeZone") ?? [];
    return zones.length ? zones : COMMON_ZONES;
  } catch {
    return COMMON_ZONES;
  }
}

function isFuture(iso?: string) {
  return Boolean(iso) && new Date(iso as string).getTime() > Date.now();
}

function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type Props = {
  schedule?: CloudSchedule;
  gapMinutes: number;
  nextSendAt?: string;
  status: string;
  busy: boolean;
  /** The step was saved before: the button says "Save changes" instead of "Save and continue". */
  saved: boolean;
  onSave: (schedule: CloudSchedule, gapMinutes: number) => Promise<void>;
};

/**
 * Step 7, "When to send": when to start, which days and hours, the recipients' timezone and the
 * gap between emails. One save for all of it; unsaved edits are flagged so they can't be missed.
 */
export default function CloudSchedulePanel({ schedule, gapMinutes, nextSendAt, status, busy, saved, onSave }: Props) {
  const initialZone = schedule?.timezone || browserZone();
  // Browsers list some zones under old names (Asia/Calcutta for Asia/Kolkata). Always include the
  // saved and local zones so the select never silently shows (and saves) a different one.
  const zones = useMemo(
    () => Array.from(new Set([...allZones(), ...COMMON_ZONES, initialZone, browserZone()])).sort(),
    [initialZone],
  );
  const [timezone, setTimezone] = useState(initialZone);
  const [excluded, setExcluded] = useState<number[]>(schedule?.excludedDays ?? []);
  const [useWindow, setUseWindow] = useState(Boolean(schedule && hasWindow(schedule)));
  const [windowStart, setWindowStart] = useState(schedule?.windowStart || "09:00");
  const [windowEnd, setWindowEnd] = useState(schedule?.windowEnd || "18:00");
  const [useStart, setUseStart] = useState(Boolean(schedule?.startAt && isFuture(schedule.startAt)));
  const [startLocal, setStartLocal] = useState(
    schedule?.startAt ? utcToZonedLocal(schedule.startAt, initialZone) : "",
  );
  const [gap, setGap] = useState(String(gapMinutes));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  const locked = status === "sending" || status === "scheduled";
  const touch = () => {
    setDirty(true);
    setError("");
  };
  const disabled = busy || locked;

  const draft: CloudSchedule = {
    timezone,
    excludedDays: excluded,
    windowStart: useWindow ? windowStart : undefined,
    windowEnd: useWindow ? windowEnd : undefined,
    startAt: useStart && startLocal ? zonedLocalToUtc(startLocal, timezone)?.toISOString() : undefined,
  };
  const gapValue = Math.max(0, Math.min(120, Math.round(Number(gap)) || 0));

  async function save() {
    if (useWindow && windowEnd <= windowStart) {
      setError("The end time must be after the start time.");
      return;
    }
    if (excluded.length === 7) {
      setError("Allow at least one day.");
      return;
    }
    if (useStart && !startLocal) {
      setError("Pick the date and time to start, or choose \"When I click Start\".");
      return;
    }
    if (useStart && !isFuture(draft.startAt)) {
      setError("Pick a start time in the future.");
      return;
    }
    await onSave(draft, gapValue);
    setDirty(false);
  }

  return (
    <div className="cloud-when">
      <fieldset className="cloud-when-block" disabled={disabled}>
        <legend>1. When should it start?</legend>
        <div className="cloud-when-choices" role="radiogroup">
          <label className={`cloud-when-choice${!useStart ? " is-on" : ""}`}>
            <input
              type="radio"
              name="cloud-start"
              checked={!useStart}
              onChange={() => {
                setUseStart(false);
                touch();
              }}
            />
            <span>
              <strong>When I click Start</strong>
              <small>Sending begins right away (within the days and hours below).</small>
            </span>
          </label>
          <label className={`cloud-when-choice${useStart ? " is-on" : ""}`}>
            <input
              type="radio"
              name="cloud-start"
              checked={useStart}
              onChange={() => {
                setUseStart(true);
                touch();
              }}
            />
            <span>
              <strong>At a set date and time</strong>
              <small>Click Schedule after saving; it starts on its own.</small>
            </span>
          </label>
        </div>
        {useStart ? (
          <div className="cloud-when-inline">
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => {
                setStartLocal(e.target.value);
                touch();
              }}
            />
            <small>in {timezone.replace(/_/g, " ")}</small>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="cloud-when-block" disabled={disabled}>
        <legend>2. Recipients&apos; timezone</legend>
        <select
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value);
            touch();
          }}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <small className="cloud-when-help">Days, hours and the start time below are in this timezone.</small>
      </fieldset>

      <fieldset className="cloud-when-block" disabled={disabled}>
        <legend>3. Days to send on</legend>
        <div className="cloud-schedule-days" role="group" aria-label="Days to send on">
          {WEEKDAYS.map((day, index) => {
            const on = !excluded.includes(index);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                className={on ? "is-on" : ""}
                onClick={() => {
                  setExcluded((current) =>
                    current.includes(index) ? current.filter((d) => d !== index) : [...current, index],
                  );
                  touch();
                }}
              >
                {day}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="cloud-when-block" disabled={disabled}>
        <legend>4. Hours to send in</legend>
        <div className="cloud-when-choices" role="radiogroup">
          <label className={`cloud-when-choice${!useWindow ? " is-on" : ""}`}>
            <input
              type="radio"
              name="cloud-window"
              checked={!useWindow}
              onChange={() => {
                setUseWindow(false);
                touch();
              }}
            />
            <span>
              <strong>Any time of day</strong>
            </span>
          </label>
          <label className={`cloud-when-choice${useWindow ? " is-on" : ""}`}>
            <input
              type="radio"
              name="cloud-window"
              checked={useWindow}
              onChange={() => {
                setUseWindow(true);
                touch();
              }}
            />
            <span>
              <strong>Only during set hours</strong>
              <small>Outside them it waits, then carries on.</small>
            </span>
          </label>
        </div>
        {useWindow ? (
          <div className="cloud-when-inline">
            <input
              type="time"
              value={windowStart}
              onChange={(e) => {
                setWindowStart(e.target.value);
                touch();
              }}
            />
            <span>to</span>
            <input
              type="time"
              value={windowEnd}
              onChange={(e) => {
                setWindowEnd(e.target.value);
                touch();
              }}
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="cloud-when-block" disabled={disabled}>
        <legend>5. Gap between emails</legend>
        <div className="cloud-when-inline">
          <input
            type="number"
            min={0}
            max={120}
            value={gap}
            onChange={(e) => {
              setGap(e.target.value);
              touch();
            }}
          />
          <span>minutes</span>
        </div>
        <small className="cloud-when-help">A few minutes apart looks like a person sending one by one.</small>
      </fieldset>

      <div className={`cloud-when-foot${dirty ? " is-dirty" : ""}`}>
        <div>
          <strong>{dirty ? "Unsaved changes" : saved ? "Saved" : "Not saved yet"}</strong>
          <small>
            {describeSchedule(draft)} · {gapValue === 0 ? "no gap between emails" : `${gapValue} min between emails`}
            {nextSendAt && locked
              ? ` · next email ${new Date(nextSendAt).toLocaleString([], { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}`
              : ""}
            {locked ? " · stop or cancel the schedule to change this" : ""}
          </small>
          {error ? <small className="cloud-schedule-error">{error}</small> : null}
        </div>
        <button
          type="button"
          className="btn-dark"
          disabled={disabled || (saved && !dirty)}
          onClick={() => void save()}
        >
          {saved ? "Save changes" : "Save and continue"}
        </button>
      </div>
    </div>
  );
}
