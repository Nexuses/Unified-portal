import { eventWallToUtc } from "@/lib/public-event-time";

export function parseScheduledInviteDateTime(date: string, time: string): Date | null {
  return eventWallToUtc(date.trim(), time.trim());
}

export function formatScheduledInviteDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(date);
}
