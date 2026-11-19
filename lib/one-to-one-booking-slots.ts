import { type EventPlatform, normalizeEventPlatform } from "@/lib/event-platform";
import { partitionEventCalendars } from "@/lib/event-form-calendars";
import { normalizeEventCalendarsArray } from "@/lib/normalize-event-calendars";
import { eventWallToUtc, toWallDateYmd } from "@/lib/public-event-time";

export type OneToOneSlotRow = {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink: string;
};

function wallDayKey(ymd: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd).trim());
  if (!match) {
    return Number.NEGATIVE_INFINITY;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return Number.NEGATIVE_INFINITY;
  }
  return y * 10000 + m * 100 + d;
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

function isWeekendYmd(ymd: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ymd);
  if (!match) {
    return false;
  }
  const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const day = dt.getDay();
  return day === 0 || day === 6;
}

export function weekdaysInRange(startYmd: string, endYmd: string) {
  const start = toWallDateYmd(startYmd);
  const end = toWallDateYmd(endYmd);
  if (!start || !end || wallDayKey(end) < wallDayKey(start)) {
    return [];
  }
  const dates: string[] = [];
  let cursor = start;
  while (wallDayKey(cursor) <= wallDayKey(end)) {
    if (!isWeekendYmd(cursor)) {
      dates.push(cursor);
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

export function collectOneToOneDailyTimeTemplates(input: {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: unknown;
  platformLink?: unknown;
  eventCalendars?: unknown;
}) {
  const mainDate = toWallDateYmd(input.eventDate);
  const platform = normalizeEventPlatform(input.platform);
  const platformLink = String(input.platformLink ?? "");
  const calendars = normalizeEventCalendarsArray(input.eventCalendars).map((slot) => ({
    eventDate: slot.eventDate,
    eventTimeStart: slot.eventTimeStart,
    eventTimeEnd: slot.eventTimeEnd,
    platform: slot.platform,
    platformLink: slot.platformLink ?? "",
  }));
  const { sameDayTimeSlots } = partitionEventCalendars(
    mainDate,
    platform,
    platformLink,
    calendars
  );

  const seen = new Set<string>();
  const templates: Array<{ start: string; end: string }> = [];
  const add = (start: string, end: string) => {
    const key = `${start}::${end}`;
    if (!start.trim() || !end.trim() || seen.has(key)) {
      return;
    }
    seen.add(key);
    templates.push({ start: start.trim(), end: end.trim() });
  };

  add(String(input.eventTimeStart ?? ""), String(input.eventTimeEnd ?? ""));
  for (const row of sameDayTimeSlots) {
    add(row.eventTimeStart, row.eventTimeEnd);
  }

  return templates;
}

export function buildOneToOneSlotsFromBookingRange(input: {
  eventDate: string;
  oneToOneBookingEndDate?: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: unknown;
  platformLink?: unknown;
  eventCalendars?: unknown;
}): OneToOneSlotRow[] {
  const rangeEnd = toWallDateYmd(input.oneToOneBookingEndDate ?? "");
  const rangeStart = toWallDateYmd(input.eventDate);
  if (!rangeStart || !rangeEnd || wallDayKey(rangeEnd) < wallDayKey(rangeStart)) {
    return [];
  }

  const platform = normalizeEventPlatform(input.platform);
  const platformLink = String(input.platformLink ?? "");
  const templates = collectOneToOneDailyTimeTemplates(input);
  if (templates.length === 0) {
    return [];
  }

  const dates = weekdaysInRange(rangeStart, rangeEnd);
  const slots = dates.flatMap((eventDate) =>
    templates.map((template) => ({
      eventDate,
      eventTimeStart: template.start,
      eventTimeEnd: template.end,
      platform,
      platformLink,
    }))
  );

  const calendars = normalizeEventCalendarsArray(input.eventCalendars);
  const rangeDateSet = new Set(dates);
  for (const slot of calendars) {
    const date = toWallDateYmd(slot.eventDate);
    if (!date || rangeDateSet.has(date)) {
      continue;
    }
    if (isWeekendYmd(date)) {
      continue;
    }
    slots.push({
      eventDate: date,
      eventTimeStart: String(slot.eventTimeStart ?? ""),
      eventTimeEnd: String(slot.eventTimeEnd ?? ""),
      platform: normalizeEventPlatform(slot.platform),
      platformLink: String(slot.platformLink ?? platformLink),
    });
  }

  return slots;
}

export function slotEndsAfterNow(slot: OneToOneSlotRow, now: Date) {
  const startUtc = eventWallToUtc(slot.eventDate, slot.eventTimeStart);
  let endUtc = eventWallToUtc(slot.eventDate, slot.eventTimeEnd);
  if (!startUtc || !endUtc) {
    return false;
  }
  if (endUtc.getTime() < startUtc.getTime()) {
    endUtc = new Date(endUtc.getTime() + 24 * 60 * 60 * 1000);
  }
  return endUtc.getTime() > now.getTime();
}

export function meetingDurationMinutes(start: string, end: string) {
  const startUtc = eventWallToUtc("2000-01-03", start);
  let endUtc = eventWallToUtc("2000-01-03", end);
  if (!startUtc || !endUtc) {
    return 30;
  }
  if (endUtc.getTime() < startUtc.getTime()) {
    endUtc = new Date(endUtc.getTime() + 24 * 60 * 60 * 1000);
  }
  const mins = Math.round((endUtc.getTime() - startUtc.getTime()) / 60000);
  return mins > 0 ? mins : 30;
}

/** Minutes kept free before and after each booked meeting (e.g. 2:30–3:00 blocks 2:00–3:30). */
export const DEFAULT_ONE_TO_ONE_BUFFER_MINUTES = 30;

function normalizeTimeHHMM(value: string) {
  const trimmed = String(value ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(trimmed);
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
  const normalized = normalizeTimeHHMM(value);
  if (!normalized) {
    return Number.NaN;
  }
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

export type BookedInterval = {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
};

export function slotOverlapsBookedWithBuffer(
  slot: { eventDate: string; eventTimeStart: string; eventTimeEnd: string },
  booked: BookedInterval,
  bufferMinutes = DEFAULT_ONE_TO_ONE_BUFFER_MINUTES
) {
  const slotDate = toWallDateYmd(slot.eventDate);
  const bookedDate = toWallDateYmd(booked.eventDate);
  if (!slotDate || !bookedDate || slotDate !== bookedDate) {
    return false;
  }

  const slotStart = timeToMinutes(slot.eventTimeStart);
  const slotEnd = timeToMinutes(slot.eventTimeEnd);
  const bookedStart = timeToMinutes(booked.eventTimeStart);
  const bookedEnd = timeToMinutes(booked.eventTimeEnd);
  if (
    !Number.isFinite(slotStart) ||
    !Number.isFinite(slotEnd) ||
    !Number.isFinite(bookedStart) ||
    !Number.isFinite(bookedEnd)
  ) {
    return false;
  }

  const buffer = Math.max(0, bufferMinutes);
  const bookedStartWithBuffer = bookedStart - buffer;
  const bookedEndWithBuffer = bookedEnd + buffer;
  return slotStart < bookedEndWithBuffer && slotEnd > bookedStartWithBuffer;
}

export function resolveBlockedSlotIndexes(
  slots: Array<{ eventDate: string; eventTimeStart: string; eventTimeEnd: string }>,
  bookings: BookedInterval[],
  bufferMinutes = DEFAULT_ONE_TO_ONE_BUFFER_MINUTES
) {
  const blocked = new Set<number>();
  for (const [index, slot] of slots.entries()) {
    for (const booked of bookings) {
      if (slotOverlapsBookedWithBuffer(slot, booked, bufferMinutes)) {
        blocked.add(index);
        break;
      }
    }
  }
  return Array.from(blocked).sort((a, b) => a - b);
}
