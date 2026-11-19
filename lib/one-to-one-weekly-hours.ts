import { type EventPlatform, normalizeEventPlatform } from "@/lib/event-platform";
import { partitionEventCalendars } from "@/lib/event-form-calendars";
import { normalizeEventCalendarsArray } from "@/lib/normalize-event-calendars";
import { eventWallToUtc, toWallDateYmd } from "@/lib/public-event-time";
import { slotEndsAfterNow, type OneToOneSlotRow } from "@/lib/one-to-one-booking-slots";

export type WeeklyTimeRange = {
  start: string;
  end: string;
};

export type WeeklyDayHours = {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  enabled: boolean;
  ranges: WeeklyTimeRange[];
};

export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DEFAULT_ONE_TO_ONE_HORIZON_DAYS = 60;
export const DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS = 1;
export const DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES = 30;

export function defaultWeeklyHours(): WeeklyDayHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
    ranges: dayOfWeek >= 1 && dayOfWeek <= 5 ? [{ start: "09:00", end: "17:00" }] : [],
  }));
}

function normalizeTime(value: string) {
  const trimmed = String(value ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return "";
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) {
    return "";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const normalized = normalizeTime(value);
  if (!normalized) {
    return Number.NaN;
  }
  const [h, m] = normalized.split(":").map(Number);
  return h * 60 + m;
}

export function isWeeklyRangeValid(range: WeeklyTimeRange) {
  const start = timeToMinutes(range.start);
  const end = timeToMinutes(range.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function normalizeWeeklyHours(input: unknown): WeeklyDayHours[] {
  const defaults = defaultWeeklyHours();
  if (!Array.isArray(input)) {
    return defaults;
  }
  const byDay = new Map<number, WeeklyDayHours>();
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const dayOfWeek = Number((item as WeeklyDayHours).dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      continue;
    }
    const enabled = Boolean((item as WeeklyDayHours).enabled);
    const ranges = Array.isArray((item as WeeklyDayHours).ranges)
      ? (item as WeeklyDayHours).ranges
          .map((range) => ({
            start: normalizeTime(range?.start ?? ""),
            end: normalizeTime(range?.end ?? ""),
          }))
          .filter((range) => range.start && range.end && isWeeklyRangeValid(range))
      : [];
    byDay.set(dayOfWeek, {
      dayOfWeek,
      enabled: enabled && ranges.length > 0,
      ranges: enabled ? ranges : [],
    });
  }
  return defaults.map((day) => byDay.get(day.dayOfWeek) ?? day);
}

export function deriveWeeklyHoursFromLegacyEvent(input: {
  eventTimeStart?: string;
  eventTimeEnd?: string;
  eventCalendars?: unknown;
}): WeeklyDayHours[] {
  const templates = new Set<string>();
  const add = (start: string, end: string) => {
    const s = normalizeTime(start);
    const e = normalizeTime(end);
    if (s && e && isWeeklyRangeValid({ start: s, end: e })) {
      templates.add(`${s}::${e}`);
    }
  };
  add(input.eventTimeStart ?? "", input.eventTimeEnd ?? "");
  const mainDate = "";
  const calendars = normalizeEventCalendarsArray(input.eventCalendars);
  const { sameDayTimeSlots } = partitionEventCalendars(mainDate, "Zoom", "", calendars);
  for (const row of sameDayTimeSlots) {
    add(row.eventTimeStart, row.eventTimeEnd);
  }
  for (const slot of calendars) {
    add(slot.eventTimeStart ?? "", slot.eventTimeEnd ?? "");
  }
  const ranges = Array.from(templates).map((key) => {
    const [start, end] = key.split("::");
    return { start, end };
  });
  if (ranges.length === 0) {
    return defaultWeeklyHours();
  }
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
    ranges: dayOfWeek >= 1 && dayOfWeek <= 5 ? ranges.map((range) => ({ ...range })) : [],
  }));
}

function todayInIstYmd() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) {
    return ymd;
  }
  const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  const y = String(dt.getFullYear());
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function wallDayKey(ymd: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd).trim());
  if (!match) {
    return Number.NEGATIVE_INFINITY;
  }
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
}

function ymdToDayOfWeek(ymd: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) {
    return -1;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay();
}

function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function splitRangeIntoSlots(range: WeeklyTimeRange, durationMinutes: number) {
  const start = timeToMinutes(range.start);
  const end = timeToMinutes(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }
  const duration = Math.max(15, Math.min(240, durationMinutes));
  const slots: WeeklyTimeRange[] = [];
  for (let cursor = start; cursor + duration <= end; cursor += duration) {
    slots.push({
      start: minutesToTime(cursor),
      end: minutesToTime(cursor + duration),
    });
  }
  return slots;
}

export function buildSlotsFromWeeklyHours(input: {
  weeklyHours: WeeklyDayHours[];
  horizonDays?: number;
  minNoticeDays?: number;
  meetingDurationMinutes?: number;
  platform: unknown;
  platformLink?: unknown;
}): OneToOneSlotRow[] {
  const weeklyHours = normalizeWeeklyHours(input.weeklyHours);
  const horizonDays = Math.max(1, Math.min(365, Math.floor(input.horizonDays ?? DEFAULT_ONE_TO_ONE_HORIZON_DAYS)));
  const minNoticeDays = Math.max(0, Math.min(horizonDays, Math.floor(input.minNoticeDays ?? DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS)));
  const meetingDurationMinutes = Math.max(
    15,
    Math.min(240, Math.floor(input.meetingDurationMinutes ?? DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES))
  );
  const platform = normalizeEventPlatform(input.platform);
  const platformLink = String(input.platformLink ?? "");
  const todayYmd = todayInIstYmd();
  const startYmd = addDaysYmd(todayYmd, minNoticeDays);
  const endYmd = addDaysYmd(todayYmd, horizonDays);
  const now = new Date();
  const hoursByDay = new Map(weeklyHours.map((day) => [day.dayOfWeek, day]));
  const slots: OneToOneSlotRow[] = [];
  let cursor = startYmd;
  while (wallDayKey(cursor) <= wallDayKey(endYmd)) {
    const dayConfig = hoursByDay.get(ymdToDayOfWeek(cursor));
    if (dayConfig?.enabled) {
      for (const range of dayConfig.ranges) {
        for (const slot of splitRangeIntoSlots(range, meetingDurationMinutes)) {
          const row = {
            eventDate: cursor,
            eventTimeStart: slot.start,
            eventTimeEnd: slot.end,
            platform,
            platformLink,
          };
          if (slotEndsAfterNow(row, now)) {
            slots.push(row);
          }
        }
      }
    }
    cursor = addDaysYmd(cursor, 1);
  }
  const keyOf = (slot: OneToOneSlotRow) =>
    `${slot.eventDate}::${slot.eventTimeStart}::${slot.eventTimeEnd}::${slot.platform}`;
  const seen = new Set<string>();
  return slots.filter((slot) => {
    const key = keyOf(slot);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function resolveWeeklyHoursForEvent(event: {
  oneToOneWeeklyHours?: unknown;
  eventTimeStart?: string;
  eventTimeEnd?: string;
  eventCalendars?: unknown;
}) {
  const stored = normalizeWeeklyHours(event.oneToOneWeeklyHours);
  const hasStored = Array.isArray(event.oneToOneWeeklyHours) && event.oneToOneWeeklyHours.length > 0;
  if (hasStored) {
    return stored;
  }
  return deriveWeeklyHoursFromLegacyEvent(event);
}

export function hasWeeklyHoursConfig(event: { oneToOneWeeklyHours?: unknown }) {
  return Array.isArray(event.oneToOneWeeklyHours) && event.oneToOneWeeklyHours.length > 0;
}

export function firstWeeklySlotPreview(event: {
  oneToOneWeeklyHours?: unknown;
  oneToOneBookingHorizonDays?: number;
  oneToOneMinNoticeDays?: number;
  oneToOneMeetingDurationMinutes?: number;
  eventTimeStart?: string;
  eventTimeEnd?: string;
  eventCalendars?: unknown;
  platform?: unknown;
  platformLink?: unknown;
}) {
  const slots = buildSlotsFromWeeklyHours({
    weeklyHours: resolveWeeklyHoursForEvent(event),
    horizonDays: event.oneToOneBookingHorizonDays,
    minNoticeDays: event.oneToOneMinNoticeDays,
    meetingDurationMinutes: event.oneToOneMeetingDurationMinutes,
    platform: event.platform ?? "Zoom",
    platformLink: event.platformLink ?? "",
  });
  return slots[0] ?? null;
}
