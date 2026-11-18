"use client";

import { EVENT_WALL_TIME_ZONE } from "@/lib/public-event-time";

export type InviteDeliveryMode = "now" | "schedule";

export function getDefaultInviteScheduleFields(): { date: string; time: string } {
  const offsetNow = new Date(Date.now() + 60 * 60 * 1000);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_WALL_TIME_ZONE,
  }).format(offsetNow);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_WALL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(offsetNow);
  const hour = timeParts.find((part) => part.type === "hour")?.value ?? "10";
  const minute = timeParts.find((part) => part.type === "minute")?.value ?? "00";
  return { date, time: `${hour}:${minute}` };
}

type InviteScheduleFieldsProps = {
  mode: InviteDeliveryMode;
  onModeChange: (mode: InviteDeliveryMode) => void;
  scheduledDate: string;
  scheduledTime: string;
  onScheduledDateChange: (value: string) => void;
  onScheduledTimeChange: (value: string) => void;
};

export function InviteScheduleFields({
  mode,
  onModeChange,
  scheduledDate,
  scheduledTime,
  onScheduledDateChange,
  onScheduledTimeChange,
}: InviteScheduleFieldsProps) {
  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-white p-3">
      <p className="text-xs font-medium text-black">Delivery</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onModeChange("now")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
            mode === "now"
              ? "bg-black text-white"
              : "border border-black/15 text-black/70 hover:bg-black/5"
          }`}
        >
          Send now
        </button>
        <button
          type="button"
          onClick={() => onModeChange("schedule")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
            mode === "schedule"
              ? "bg-black text-white"
              : "border border-black/15 text-black/70 hover:bg-black/5"
          }`}
        >
          Schedule
        </button>
      </div>

      {mode === "schedule" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-black/55">
              Date
            </span>
            <input
              type="date"
              value={scheduledDate}
              onChange={(event) => onScheduledDateChange(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm text-black outline-none focus:border-black/30"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-black/55">
              Time (IST)
            </span>
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => onScheduledTimeChange(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm text-black outline-none focus:border-black/30"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
