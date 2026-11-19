"use client";

import type { ReactNode } from "react";
import {
  DEFAULT_ONE_TO_ONE_HORIZON_DAYS,
  DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES,
  DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS,
  isWeeklyRangeValid,
  type WeeklyDayHours,
  type WeeklyTimeRange,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
} from "@/lib/one-to-one-weekly-hours";

type OneToOneAvailabilityEditorProps = {
  weeklyHours: WeeklyDayHours[];
  horizonDays: number;
  minNoticeDays: number;
  meetingDurationMinutes: number;
  onWeeklyHoursChange: (value: WeeklyDayHours[]) => void;
  onHorizonDaysChange: (value: number) => void;
  onMinNoticeDaysChange: (value: number) => void;
  onMeetingDurationMinutesChange: (value: number) => void;
  inputClass: string;
};

const timeInputClass =
  "h-10 min-w-[9.75rem] w-[9.75rem] shrink-0 rounded-lg border border-black/15 bg-white px-2.5 text-sm tabular-nums text-black outline-none transition focus:border-black/35 [&::-webkit-calendar-picker-indicator]:ml-0.5";

const inlineNumberClass =
  "inline-block h-8 w-14 rounded-md border border-black/15 bg-white px-2 text-center text-sm font-medium text-black outline-none transition focus:border-black/35";

function rangeError(range: WeeklyTimeRange) {
  if (!range.start || !range.end) {
    return "";
  }
  if (!isWeeklyRangeValid(range)) {
    return "Choose an end time later than the start time.";
  }
  return "";
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-black/50 transition hover:bg-black/5 hover:text-black"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M10 4.5V15.5M4.5 10H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function WeeklyHoursIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-black/70" aria-hidden>
      <path
        d="M6.5 4.5L13.5 10.5L6.5 15.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 4.5L10.5 10.5L3.5 15.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OneToOneAvailabilityEditor({
  weeklyHours,
  horizonDays,
  minNoticeDays,
  meetingDurationMinutes,
  onWeeklyHoursChange,
  onHorizonDaysChange,
  onMinNoticeDaysChange,
  onMeetingDurationMinutesChange,
}: OneToOneAvailabilityEditorProps) {
  function updateDay(dayOfWeek: number, patch: Partial<WeeklyDayHours>) {
    onWeeklyHoursChange(
      weeklyHours.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day))
    );
  }

  function updateRange(dayOfWeek: number, rangeIndex: number, patch: Partial<WeeklyTimeRange>) {
    onWeeklyHoursChange(
      weeklyHours.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        return {
          ...day,
          ranges: day.ranges.map((range, index) =>
            index === rangeIndex ? { ...range, ...patch } : range
          ),
        };
      })
    );
  }

  function addRange(dayOfWeek: number) {
    const day = weeklyHours.find((item) => item.dayOfWeek === dayOfWeek);
    const last = day?.ranges[day.ranges.length - 1];
    const nextRange = last ?? { start: "09:00", end: "17:00" };
    onWeeklyHoursChange(
      weeklyHours.map((item) =>
        item.dayOfWeek === dayOfWeek
          ? {
              ...item,
              enabled: true,
              ranges: [...item.ranges, { ...nextRange }],
            }
          : item
      )
    );
  }

  function removeRange(dayOfWeek: number, rangeIndex: number) {
    onWeeklyHoursChange(
      weeklyHours.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        const ranges = day.ranges.filter((_, index) => index !== rangeIndex);
        return {
          ...day,
          enabled: ranges.length > 0,
          ranges,
        };
      })
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-semibold text-black">Date-range</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm leading-relaxed text-black/80">
          <span>Invitees can schedule</span>
          <input
            type="number"
            min={1}
            max={365}
            className={inlineNumberClass}
            value={horizonDays}
            onChange={(event) =>
              onHorizonDaysChange(
                Math.max(1, Math.min(365, Number(event.target.value) || DEFAULT_ONE_TO_ONE_HORIZON_DAYS))
              )
            }
            aria-label="Days into the future"
          />
          <span>days into the future with at least</span>
          <input
            type="number"
            min={0}
            max={horizonDays}
            className={inlineNumberClass}
            value={minNoticeDays}
            onChange={(event) =>
              onMinNoticeDaysChange(
                Math.max(0, Math.min(horizonDays, Number(event.target.value) || 0))
              )
            }
            aria-label="Minimum notice days"
          />
          <span>days notice.</span>
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-black/80">
          <span className="font-medium text-black">Schedule:</span>
          <span className="text-black/70">Working hours</span>
          <span className="text-black/40">(default)</span>
        </p>
        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm text-black/80">
          <span>Meeting duration</span>
          <input
            type="number"
            min={15}
            max={240}
            className={inlineNumberClass}
            value={meetingDurationMinutes}
            onChange={(event) =>
              onMeetingDurationMinutesChange(
                Math.max(
                  15,
                  Math.min(240, Number(event.target.value) || DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES)
                )
              )
            }
            aria-label="Meeting duration in minutes"
          />
          <span>minutes</span>
        </label>
      </section>

      <section>
        <div className="flex items-start gap-2">
          <WeeklyHoursIcon />
          <div>
            <p className="text-sm font-semibold text-black">Weekly hours</p>
            <p className="mt-0.5 text-sm text-black/50">
              Set when you are typically available for meetings
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-1">
          {weeklyHours.map((day) => {
            const unavailable = !day.enabled || day.ranges.length === 0;

            if (unavailable) {
              return (
                <div
                  key={day.dayOfWeek}
                  className="flex items-center gap-2 py-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                    {WEEKDAY_LABELS[day.dayOfWeek]}
                  </span>
                  <span className="text-sm text-black/40">Unavailable</span>
                  <IconButton
                      label={`Enable ${WEEKDAY_NAMES[day.dayOfWeek]}`}
                      onClick={() =>
                        updateDay(day.dayOfWeek, {
                          enabled: true,
                          ranges: [{ start: "09:00", end: "17:00" }],
                        })
                      }
                    >
                      <PlusIcon />
                    </IconButton>
                </div>
              );
            }

            return (
              <div key={day.dayOfWeek} className="space-y-1 py-1">
                {day.ranges.map((range, rangeIndex) => {
                  const error = rangeError(range);
                  const isFirst = rangeIndex === 0;
                  const isLast = rangeIndex === day.ranges.length - 1;

                  return (
                    <div
                      key={`${day.dayOfWeek}-${rangeIndex}`}
                      className="flex flex-wrap items-start gap-2"
                    >
                      {isFirst ? (
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                          {WEEKDAY_LABELS[day.dayOfWeek]}
                        </span>
                      ) : (
                        <span className="w-9 shrink-0" aria-hidden />
                      )}

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <input
                          type="time"
                          className={timeInputClass}
                          value={range.start}
                          onChange={(event) =>
                            updateRange(day.dayOfWeek, rangeIndex, { start: event.target.value })
                          }
                        />
                        <span className="shrink-0 text-sm text-black/35">—</span>
                        <input
                          type="time"
                          className={`${timeInputClass} ${error ? "border-red-400 focus:border-red-500" : ""}`}
                          value={range.end}
                          onChange={(event) =>
                            updateRange(day.dayOfWeek, rangeIndex, { end: event.target.value })
                          }
                        />
                        <div className="flex shrink-0 items-center">
                          <IconButton
                            label={`Remove ${WEEKDAY_NAMES[day.dayOfWeek]} time range`}
                            onClick={() => removeRange(day.dayOfWeek, rangeIndex)}
                          >
                            <CloseIcon />
                          </IconButton>
                          {isLast ? (
                            <IconButton
                              label={`Add ${WEEKDAY_NAMES[day.dayOfWeek]} time range`}
                              onClick={() => addRange(day.dayOfWeek)}
                            >
                              <PlusIcon />
                            </IconButton>
                          ) : null}
                        </div>
                      </div>
                      {error ? (
                        <p className="w-full pl-11 text-xs text-red-600">{error}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
