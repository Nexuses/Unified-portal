/**
 * Sending schedule for cloud campaigns: a start time, the recipients' timezone, weekdays to skip,
 * and an optional daily window. Pure functions (no dependencies) so they run on server and client.
 */

export type CloudSchedule = {
  /** IANA timezone, e.g. "Asia/Dubai". */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  excludedDays: number[];
  /** "HH:MM" local to `timezone`; both set = only send inside this window. */
  windowStart?: string;
  windowEnd?: string;
  /** When sending should begin (UTC ISO). Empty = as soon as started. */
  startAt?: string;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

/** Weekday + minutes-since-midnight of an instant, in a timezone. */
export function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function toMinutes(hhmm?: string) {
  const match = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

export function hasWindow(schedule: CloudSchedule) {
  const start = toMinutes(schedule.windowStart);
  const end = toMinutes(schedule.windowEnd);
  return start !== null && end !== null && end > start;
}

/** True when an email may be sent at this instant under the schedule's days and window. */
export function isSendAllowed(date: Date, schedule: CloudSchedule) {
  const tz = isValidTimezone(schedule.timezone) ? schedule.timezone : "UTC";
  const local = zonedParts(date, tz);
  if ((schedule.excludedDays || []).includes(local.weekday)) return false;
  if (!hasWindow(schedule)) return true;
  const now = local.hour * 60 + local.minute;
  return now >= toMinutes(schedule.windowStart)! && now < toMinutes(schedule.windowEnd)!;
}

/**
 * Earliest instant at or after `from` when sending is allowed (and not before `startAt`).
 * Returns null when nothing is allowed in the next 14 days (e.g. every day excluded).
 */
export function nextAllowedTime(from: Date, schedule: CloudSchedule): Date | null {
  let cursor = new Date(from.getTime());
  const startAt = schedule.startAt ? new Date(schedule.startAt) : null;
  if (startAt && startAt.getTime() > cursor.getTime()) cursor = startAt;
  if (isSendAllowed(cursor, schedule)) return cursor;
  // Coarse 15-minute steps to the next allowed slot, then back up to the exact minute.
  const step = 15 * 60 * 1000;
  const limit = cursor.getTime() + 14 * 24 * 60 * 60 * 1000;
  let probe = Math.floor(cursor.getTime() / step) * step + step;
  while (probe <= limit) {
    if (isSendAllowed(new Date(probe), schedule)) {
      let exact = probe;
      while (exact - 60_000 > cursor.getTime() && isSendAllowed(new Date(exact - 60_000), schedule)) {
        exact -= 60_000;
      }
      return new Date(exact);
    }
    probe += step;
  }
  return null;
}

/** Offset (ms) of a timezone from UTC at a given instant. */
function tzOffsetMs(date: Date, timezone: string) {
  const p = zonedParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** "2026-11-20T09:30" in `timezone` -> UTC Date (handles DST). */
export function zonedLocalToUtc(local: string, timezone: string): Date | null {
  const match = String(local).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(new Date(guess), timezone);
  const second = guess - tzOffsetMs(new Date(first), timezone);
  return new Date(second);
}

/** UTC instant -> "YYYY-MM-DDTHH:MM" in `timezone` (for datetime-local inputs). */
export function utcToZonedLocal(iso: string, timezone: string) {
  const p = zonedParts(new Date(iso), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Human summary, e.g. "Mon–Fri · 09:00–18:00 Asia/Dubai". */
export function describeSchedule(schedule: CloudSchedule) {
  const allowed = WEEKDAYS.filter((_, i) => !(schedule.excludedDays || []).includes(i));
  const days = allowed.length === 7 ? "Every day" : allowed.length ? allowed.join(", ") : "No days";
  const window = hasWindow(schedule) ? ` · ${schedule.windowStart}–${schedule.windowEnd}` : "";
  return `${days}${window} · ${schedule.timezone || "UTC"}`;
}
