import { isSharedSessionFormat } from "@/lib/event-format";
import { type EventPlatform, normalizeEventPlatform } from "@/lib/event-platform";
import { eventWallToUtc, normalizeTimeInput, toWallDateYmd } from "@/lib/public-event-time";
import { normalizeEventCalendarsArray, type NormalizedEventCalendar } from "@/lib/normalize-event-calendars";
import {
  buildOneToOneSlotsFromBookingRange,
  slotEndsAfterNow,
} from "@/lib/one-to-one-booking-slots";
import {
  buildSlotsFromWeeklyHours,
  hasWeeklyHoursConfig,
  resolveWeeklyHoursForEvent,
} from "@/lib/one-to-one-weekly-hours";

type SlotRow = {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink: string;
};

const SLOT_TIME_PRESET: ReadonlyArray<{ start: string; end: string }> = [
  { start: "10:00", end: "10:30" },
  { start: "11:00", end: "11:30" },
  { start: "12:00", end: "12:30" },
  { start: "15:00", end: "15:30" },
  { start: "17:00", end: "17:30" },
];

function toPlatform(value: unknown): EventPlatform {
  return normalizeEventPlatform(value);
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

function isWeekendYmd(ymd: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ymd);
  if (!match) {
    return false;
  }
  const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const day = dt.getDay();
  return day === 0 || day === 6;
}

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

function nextWeekdayDates(startYmd: string, count: number) {
  const dates: string[] = [];
  let cursor = startYmd;
  while (dates.length < count) {
    if (!isWeekendYmd(cursor)) {
      dates.push(cursor);
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

function nextWeekdayAfter(ymd: string) {
  let cursor = addDaysYmd(ymd, 1);
  while (isWeekendYmd(cursor)) {
    cursor = addDaysYmd(cursor, 1);
  }
  return cursor;
}

function sortSlots(a: SlotRow, b: SlotRow) {
  if (a.eventDate !== b.eventDate) {
    return a.eventDate.localeCompare(b.eventDate);
  }
  if (a.eventTimeStart !== b.eventTimeStart) {
    return a.eventTimeStart.localeCompare(b.eventTimeStart);
  }
  return a.eventTimeEnd.localeCompare(b.eventTimeEnd);
}

export function buildNextTwoWeekdayPresetSlots(input?: {
  startDate?: string;
  platform?: unknown;
  platformLink?: unknown;
}): SlotRow[] {
  const startYmd = toWallDateYmd(input?.startDate) || todayInIstYmd();
  const firstDate = nextWeekdayAfter(startYmd);
  const platform = toPlatform(input?.platform);
  const platformLink = String(input?.platformLink ?? "");
  const dates = nextWeekdayDates(firstDate, 2);
  return dates.flatMap((eventDate) =>
    SLOT_TIME_PRESET.map((slot) => ({
      eventDate,
      eventTimeStart: slot.start,
      eventTimeEnd: slot.end,
      platform,
      platformLink,
    }))
  );
}

export function resolveRollingOneToOneSlots(input: {
  eventFormat?: unknown;
  eventDate: string;
  oneToOneBookingEndDate?: string;
  oneToOneWeeklyHours?: unknown;
  oneToOneBookingHorizonDays?: number;
  oneToOneMinNoticeDays?: number;
  oneToOneMeetingDurationMinutes?: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: unknown;
  platformLink?: unknown;
  eventCalendars?: unknown;
}): SlotRow[] {
  return resolveRollingOneToOneSlotsWithExpired(input).activeSlots;
}

export function resolveRollingOneToOneSlotsWithExpired(input: {
  eventFormat?: unknown;
  eventDate: string;
  oneToOneBookingEndDate?: string;
  oneToOneWeeklyHours?: unknown;
  oneToOneBookingHorizonDays?: number;
  oneToOneMinNoticeDays?: number;
  oneToOneMeetingDurationMinutes?: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: unknown;
  platformLink?: unknown;
  eventCalendars?: unknown;
}): { activeSlots: SlotRow[]; expiredSlots: SlotRow[] } {
  if (isSharedSessionFormat(input.eventFormat)) {
    return {
      activeSlots: [
        {
          eventDate: toWallDateYmd(input.eventDate),
          eventTimeStart: normalizeTimeInput(input.eventTimeStart),
          eventTimeEnd: normalizeTimeInput(input.eventTimeEnd),
          platform: toPlatform(input.platform),
          platformLink: String(input.platformLink ?? ""),
        },
      ],
      expiredSlots: [],
    };
  }

  if (hasWeeklyHoursConfig(input)) {
    const activeSlots = buildSlotsFromWeeklyHours({
      weeklyHours: resolveWeeklyHoursForEvent(input),
      horizonDays: input.oneToOneBookingHorizonDays,
      minNoticeDays: input.oneToOneMinNoticeDays,
      meetingDurationMinutes: input.oneToOneMeetingDurationMinutes,
      platform: input.platform,
      platformLink: input.platformLink,
    });
    return { activeSlots, expiredSlots: [] };
  }

  const rangeEnd = toWallDateYmd(input.oneToOneBookingEndDate ?? "");
  const rangeStart = toWallDateYmd(input.eventDate);
  const hasBookingRange =
    Boolean(rangeStart) && Boolean(rangeEnd) && wallDayKey(rangeEnd) >= wallDayKey(rangeStart);

  const todayYmd = todayInIstYmd();
  const todayKey = wallDayKey(todayYmd);
  const now = new Date();
  const platform = toPlatform(input.platform);
  const platformLink = String(input.platformLink ?? "");

  const combined: SlotRow[] = hasBookingRange
    ? buildOneToOneSlotsFromBookingRange(input)
    : [
        {
          eventDate: toWallDateYmd(input.eventDate),
          eventTimeStart: String(input.eventTimeStart ?? ""),
          eventTimeEnd: String(input.eventTimeEnd ?? ""),
          platform,
          platformLink,
        },
        ...normalizeEventCalendarsArray(input.eventCalendars).map(
          (slot: NormalizedEventCalendar): SlotRow => ({
            eventDate: toWallDateYmd(slot.eventDate),
            eventTimeStart: String(slot.eventTimeStart ?? ""),
            eventTimeEnd: String(slot.eventTimeEnd ?? ""),
            platform: toPlatform(slot.platform),
            platformLink: String(slot.platformLink ?? platformLink),
          })
        ),
      ];
  const keyOf = (slot: SlotRow) =>
    `${slot.eventDate}::${slot.eventTimeStart}::${slot.eventTimeEnd}::${slot.platform}`;
  const base: SlotRow[] = combined
    .filter((slot) => slot.eventDate && slot.eventTimeStart && slot.eventTimeEnd)
    .filter((slot) => !isWeekendYmd(slot.eventDate))
    .filter((slot) => wallDayKey(slot.eventDate) > todayKey)
    .filter((slot) => slotEndsAfterNow(slot, now));
  const expiredBase: SlotRow[] = combined
    .filter((slot) => slot.eventDate && slot.eventTimeStart && slot.eventTimeEnd)
    .filter((slot) => !isWeekendYmd(slot.eventDate))
    .filter((slot) => !base.some((active) => keyOf(active) === keyOf(slot)));

  const seen = new Set<string>();
  const deduped = base.filter((slot) => {
    const key = keyOf(slot);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (hasBookingRange) {
    const activeSlots = deduped.sort(sortSlots);
    const expiredSeen = new Set<string>();
    const expiredSlots = expiredBase
      .filter((slot) => {
        const key = keyOf(slot);
        if (seen.has(key) || expiredSeen.has(key)) {
          return false;
        }
        expiredSeen.add(key);
        return true;
      })
      .sort(sortSlots);
    return { activeSlots, expiredSlots };
  }

  const uniqueFutureDates = new Set(deduped.map((slot) => slot.eventDate));
  let anchorDate =
    deduped.length > 0
      ? deduped[deduped.length - 1].eventDate
      : todayYmd;
  while (uniqueFutureDates.size < 2) {
    anchorDate = nextWeekdayAfter(anchorDate);
    uniqueFutureDates.add(anchorDate);
    for (const time of SLOT_TIME_PRESET) {
      const slot = {
        eventDate: anchorDate,
        eventTimeStart: time.start,
        eventTimeEnd: time.end,
        platform,
        platformLink,
      };
      const key = keyOf(slot);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(slot);
      }
    }
  }

  const activeSlots = deduped.sort(sortSlots);
  const expiredSeen = new Set<string>();
  const expiredSlots = expiredBase
    .filter((slot) => {
      const key = keyOf(slot);
      if (seen.has(key) || expiredSeen.has(key)) {
        return false;
      }
      expiredSeen.add(key);
      return true;
    })
    .sort(sortSlots);
  return { activeSlots, expiredSlots };
}
