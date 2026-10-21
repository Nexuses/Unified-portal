import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  resolveCampaignTimezone,
  zonedDateTimeToIso,
} from "@/lib/drip-campaigns";

/** Local minute-of-day (0–1439) for a timestamp in the given IANA zone. */
export function minuteOfDayInZone(value: Date, timeZone: string): number {
  const zone = resolveCampaignTimezone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return 0;
    }
    return Math.min(1439, Math.max(0, hour * 60 + minute));
  } catch {
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }
}

export function medianMinuteOfDay(minutes: number[]): number | undefined {
  if (minutes.length === 0) {
    return undefined;
  }
  const sorted = [...minutes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function ymdInZone(value: Date, timeZone: string): string {
  const zone = resolveCampaignTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Next occurrence of `minuteOfDay` on or after `base`, in `timeZone`.
 * If that local time is already past relative to `base`, uses the next calendar day.
 */
export function nextAvailableAt(
  base: Date,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const clamped = Math.min(1439, Math.max(0, Math.round(minuteOfDay)));
  const hour = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minute = String(clamped % 60).padStart(2, "0");
  const zone = resolveCampaignTimezone(timeZone);
  const ymd = ymdInZone(base, zone);
  const sameDay = new Date(zonedDateTimeToIso(ymd, hour, minute, zone));
  if (sameDay.getTime() >= base.getTime()) {
    return sameDay;
  }
  const nextYmd = addCalendarDays(ymd, 1);
  return new Date(zonedDateTimeToIso(nextYmd, hour, minute, zone));
}

/** Snap `base` to the contact’s usual open minute when known; otherwise return `base`. */
export function snapToUsualOpenTime(
  base: Date,
  usualMinute: number | undefined,
  timeZone: string,
): Date {
  if (usualMinute === undefined) {
    return base;
  }
  return nextAvailableAt(base, usualMinute, timeZone);
}

/**
 * Schedule a follow-up `delayDays` calendar days after `from`, at the usual open
 * minute. Unlike snap-after-(from+delayMs), a morning open time does not push a
 * 1-day delay into a second extra day.
 *
 * Example: sent Mon 15:00, delay 1, open 11:30 → Tue 11:30 (not Wed 11:30).
 */
export function followUpAvailableAt(
  from: Date,
  delayDays: number,
  usualMinute: number | undefined,
  timeZone: string,
): Date {
  const days = Math.max(0, Math.round(delayDays) || 0);
  if (usualMinute === undefined) {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  }

  const zone = resolveCampaignTimezone(timeZone);
  const clamped = Math.min(1439, Math.max(0, Math.round(usualMinute)));
  const hour = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minute = String(clamped % 60).padStart(2, "0");
  let ymd = addCalendarDays(ymdInZone(from, zone), days);
  let candidate = new Date(zonedDateTimeToIso(ymd, hour, minute, zone));
  let guard = 0;
  while (candidate.getTime() <= from.getTime() && guard < 14) {
    ymd = addCalendarDays(ymd, 1);
    candidate = new Date(zonedDateTimeToIso(ymd, hour, minute, zone));
    guard += 1;
  }
  return candidate;
}

/**
 * Median local open minute-of-day per email from past campaign opens in this project.
 * Emails with no opens are omitted.
 */
export async function loadUsualOpenMinutes(
  projectId: ObjectId,
  emails: string[],
  timeZone: string,
): Promise<Map<string, number>> {
  const normalized = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const result = new Map<string, number>();
  if (normalized.length === 0) {
    return result;
  }

  const db = await getDb();
  const zone = resolveCampaignTimezone(timeZone);
  const byEmail = new Map<string, number[]>();

  for (let offset = 0; offset < normalized.length; offset += 500) {
    const chunk = normalized.slice(offset, offset + 500);
    const rows = await db
      .collection<{ email: string; openedAt: Date }>("campaign_sends")
      .find({
        projectId,
        email: { $in: chunk },
        openedAt: { $exists: true },
      })
      .project({ email: 1, openedAt: 1 })
      .toArray();

    for (const row of rows) {
      const email = row.email?.trim().toLowerCase();
      const openedAt =
        row.openedAt instanceof Date ? row.openedAt : new Date(row.openedAt);
      if (!email || Number.isNaN(openedAt.getTime())) {
        continue;
      }
      const list = byEmail.get(email) ?? [];
      list.push(minuteOfDayInZone(openedAt, zone));
      byEmail.set(email, list);
    }
  }

  for (const [email, minutes] of byEmail) {
    const median = medianMinuteOfDay(minutes);
    if (median !== undefined) {
      result.set(email, median);
    }
  }
  return result;
}
