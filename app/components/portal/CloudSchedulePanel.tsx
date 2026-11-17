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
  nextSendAt?: string;
  status: string;
  busy: boolean;
  onSave: (schedule: CloudSchedule) => Promise<void>;
};

/** When to send: start time, recipients' timezone, days to skip, and an optional daily window. */
export default function CloudSchedulePanel({ schedule, nextSendAt, status, busy, onSave }: Props) {
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
  const [useStart, setUseStart] = useState(Boolean(schedule?.startAt));
  const [startLocal, setStartLocal] = useState(
    schedule?.startAt ? utcToZonedLocal(schedule.startAt, initialZone) : "",
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  const locked = status === "sending" || status === "scheduled";
  const touch = () => {
    setDirty(true);
    setError("");
  };

  const draft: CloudSchedule = {
    timezone,
    excludedDays: excluded,
    windowStart: useWindow ? windowStart : undefined,
    windowEnd: useWindow ? windowEnd : undefined,
    startAt: useStart && startLocal ? zonedLocalToUtc(startLocal, timezone)?.toISOString() : undefined,
  };

  async function save() {
    if (useWindow && windowEnd <= windowStart) {
      setError("The end time must be after the start time.");
      return;
    }
    if (excluded.length === 7) {
      setError("Allow at least one day.");
      return;
    }
    if (useStart && !isFuture(draft.startAt)) {
      setError("Pick a start time in the future.");
      return;
    }
    await onSave(draft);
    setDirty(false);
  }

  return (
    <div className="cloud-schedule">
      <div className="cloud-schedule-row">
        <label className="cloud-run-control">
          <span className="cloud-schedule-label">Timezone</span>
          <select
            value={timezone}
            disabled={busy || locked}
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
        </label>
        <div className="cloud-run-control">
          <span className="cloud-schedule-label">Send on</span>
          <div className="cloud-schedule-days" role="group" aria-label="Days to send on">
            {WEEKDAYS.map((day, index) => {
              const on = !excluded.includes(index);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  className={on ? "is-on" : ""}
                  disabled={busy || locked}
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
        </div>
      </div>

      <div className="cloud-schedule-row">
        <div className="cloud-run-control">
          <label className="cloud-schedule-check">
            <input
              type="checkbox"
              checked={useWindow}
              disabled={busy || locked}
              onChange={(e) => {
                setUseWindow(e.target.checked);
                touch();
              }}
            />
            Only send between
          </label>
          <div className="cloud-run-inline">
            <input
              type="time"
              value={windowStart}
              disabled={busy || locked || !useWindow}
              onChange={(e) => {
                setWindowStart(e.target.value);
                touch();
              }}
            />
            <span>and</span>
            <input
              type="time"
              value={windowEnd}
              disabled={busy || locked || !useWindow}
              onChange={(e) => {
                setWindowEnd(e.target.value);
                touch();
              }}
            />
          </div>
        </div>
        <div className="cloud-run-control">
          <label className="cloud-schedule-check">
            <input
              type="checkbox"
              checked={useStart}
              disabled={busy || locked}
              onChange={(e) => {
                setUseStart(e.target.checked);
                touch();
              }}
            />
            Start at a set time
          </label>
          <div className="cloud-run-inline">
            <input
              type="datetime-local"
              value={startLocal}
              disabled={busy || locked || !useStart}
              onChange={(e) => {
                setStartLocal(e.target.value);
                touch();
              }}
            />
          </div>
        </div>
      </div>

      <div className="cloud-schedule-foot">
        <small>
          {describeSchedule(draft)}
          {nextSendAt && (status === "sending" || status === "scheduled")
            ? ` · next email ${new Date(nextSendAt).toLocaleString([], { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}`
            : ""}
          {locked ? " · stop or cancel to change" : ""}
        </small>
        {error ? <small className="cloud-schedule-error">{error}</small> : null}
        <button type="button" className="btn-soft btn-sm" disabled={busy || locked || !dirty} onClick={() => void save()}>
          Save schedule
        </button>
      </div>
    </div>
  );
}
