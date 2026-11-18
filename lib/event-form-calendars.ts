import { type EventPlatform, normalizeEventPlatform } from "@/lib/event-platform";
import { toWallDateYmd } from "@/lib/public-event-time";

export type FormEventCalendar = {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink: string;
};

export type SameDayTimeSlot = {
  eventTimeStart: string;
  eventTimeEnd: string;
};

export type OtherDateCalendar = FormEventCalendar & {
  extraTimeSlots: SameDayTimeSlot[];
};

function normalizePlatformValue(value: string): EventPlatform {
  return normalizeEventPlatform(value);
}

/** Splits stored calendars: same main date + platform + link → extra time rows; everything else → other-date calendars. */
export function partitionEventCalendars(
  mainDate: string,
  mainPlatform: string,
  mainPlatformLink: string,
  calendars: FormEventCalendar[]
): { sameDayTimeSlots: SameDayTimeSlot[]; otherCalendars: FormEventCalendar[] } {
  const d = toWallDateYmd(mainDate);
  const pl = (mainPlatformLink ?? "").trim();
  const pf = normalizePlatformValue(mainPlatform);
  const sameDayTimeSlots: SameDayTimeSlot[] = [];
  const otherCalendars: FormEventCalendar[] = [];

  for (const c of calendars) {
    const cd = toWallDateYmd(c.eventDate);
    const cpl = (c.platformLink ?? "").trim();
    const cpf = normalizePlatformValue(c.platform);
    if (cd === d && cpl === pl && cpf === pf) {
      sameDayTimeSlots.push({
        eventTimeStart: c.eventTimeStart ?? "",
        eventTimeEnd: c.eventTimeEnd ?? "",
      });
    } else {
      otherCalendars.push(c);
    }
  }
  return { sameDayTimeSlots, otherCalendars };
}

/** Groups multiple stored rows with the same date/platform/link into one card + extra times. */
export function groupOtherDateCalendars(calendars: FormEventCalendar[]): OtherDateCalendar[] {
  const groups: OtherDateCalendar[] = [];

  for (const calendar of calendars) {
    const dateKey = toWallDateYmd(calendar.eventDate);
    const platform = normalizePlatformValue(calendar.platform);
    const platformLink = (calendar.platformLink ?? "").trim();
    const existing = groups.find(
      (group) =>
        toWallDateYmd(group.eventDate) === dateKey &&
        normalizePlatformValue(group.platform) === platform &&
        (group.platformLink ?? "").trim() === platformLink
    );

    if (!existing) {
      groups.push({
        eventDate: calendar.eventDate,
        eventTimeStart: calendar.eventTimeStart ?? "",
        eventTimeEnd: calendar.eventTimeEnd ?? "",
        platform,
        platformLink: calendar.platformLink ?? "",
        extraTimeSlots: [],
      });
      continue;
    }

    existing.extraTimeSlots.push({
      eventTimeStart: calendar.eventTimeStart ?? "",
      eventTimeEnd: calendar.eventTimeEnd ?? "",
    });
  }

  return groups;
}

export function buildFormCalendarState(
  mainDate: string,
  mainPlatform: string,
  mainPlatformLink: string,
  calendars: FormEventCalendar[]
): { sameDayTimeSlots: SameDayTimeSlot[]; eventCalendars: OtherDateCalendar[] } {
  const { sameDayTimeSlots, otherCalendars } = partitionEventCalendars(
    mainDate,
    mainPlatform,
    mainPlatformLink,
    calendars
  );
  return {
    sameDayTimeSlots,
    eventCalendars: groupOtherDateCalendars(otherCalendars),
  };
}

function isGroupedOtherDateCalendar(
  value: unknown
): value is OtherDateCalendar {
  return (
    typeof value === "object" &&
    value !== null &&
    "extraTimeSlots" in value &&
    Array.isArray((value as OtherDateCalendar).extraTimeSlots)
  );
}

/** Rebuild flat calendar rows from form state (used when hydrating edit form). */
export function expandCalendarsFromFormState(input: {
  eventDate: string;
  platform: string;
  platformLink: string;
  sameDayTimeSlots?: SameDayTimeSlot[];
  eventCalendars?: OtherDateCalendar[] | FormEventCalendar[];
}): FormEventCalendar[] {
  const platform = normalizePlatformValue(input.platform);
  const fromSameDay = (input.sameDayTimeSlots ?? []).map((slot) => ({
    eventDate: input.eventDate,
    eventTimeStart: slot.eventTimeStart,
    eventTimeEnd: slot.eventTimeEnd,
    platform,
    platformLink: input.platformLink ?? "",
  }));

  const others = input.eventCalendars ?? [];
  const fromOther =
    others.length > 0 && isGroupedOtherDateCalendar(others[0])
      ? flattenOtherDateCalendars(others as OtherDateCalendar[])
      : (others as FormEventCalendar[]);

  return [...fromSameDay, ...fromOther];
}

export function flattenOtherDateCalendars(calendars: OtherDateCalendar[]): FormEventCalendar[] {
  return calendars.flatMap((group) => [
    {
      eventDate: group.eventDate,
      eventTimeStart: group.eventTimeStart,
      eventTimeEnd: group.eventTimeEnd,
      platform: group.platform,
      platformLink: group.platformLink,
    },
    ...group.extraTimeSlots.map((slot) => ({
      eventDate: group.eventDate,
      eventTimeStart: slot.eventTimeStart,
      eventTimeEnd: slot.eventTimeEnd,
      platform: group.platform,
      platformLink: group.platformLink,
    })),
  ]);
}
