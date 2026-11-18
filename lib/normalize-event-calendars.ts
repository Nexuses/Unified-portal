import { type EventPlatform, normalizeEventPlatform } from "@/lib/event-platform";
import { toWallDateYmd } from "@/lib/public-event-time";

export type NormalizedEventCalendar = {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink: string;
};

/** Read calendars from a Mongo / API document (camelCase or snake_case). */
export function extractRawEventCalendarsField(doc: unknown): unknown {
  if (doc == null || typeof doc !== "object") {
    return undefined;
  }
  const o = doc as Record<string, unknown>;
  return (
    o.eventCalendars ??
    o.event_calendars ??
    o.EventCalendars ??
    o["event calendars"]
  );
}

function normalizeOneCalendarEntry(item: unknown): NormalizedEventCalendar[] {
  const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const eventDate = toWallDateYmd(o.eventDate ?? o.event_date);
  const platform = normalizeEventPlatform(o.platform);
  const platformLink = String(o.platformLink ?? o.platform_link ?? "");
  const primary: NormalizedEventCalendar = {
    eventDate,
    eventTimeStart: String(o.eventTimeStart ?? o.event_time_start ?? ""),
    eventTimeEnd: String(o.eventTimeEnd ?? o.event_time_end ?? ""),
    platform,
    platformLink,
  };
  const extrasRaw = o.extraTimeSlots ?? o.extra_time_slots;
  if (!Array.isArray(extrasRaw)) {
    return [primary];
  }
  const extras = extrasRaw
    .map((extra): NormalizedEventCalendar => {
      const e = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
      return {
        eventDate,
        eventTimeStart: String(e.eventTimeStart ?? e.event_time_start ?? ""),
        eventTimeEnd: String(e.eventTimeEnd ?? e.event_time_end ?? ""),
        platform,
        platformLink,
      };
    })
    .filter((slot) => slot.eventTimeStart.trim() || slot.eventTimeEnd.trim());
  return [primary, ...extras];
}

/**
 * Mongo / JSON sometimes yields array-like objects (`{ "0": {...}, "1": {...} }`) instead of arrays.
 * Expands grouped `extraTimeSlots` so every bookable row appears in the public calendar picker.
 */
export function normalizeEventCalendarsArray(value: unknown): NormalizedEventCalendar[] {
  if (value == null) {
    return [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      return normalizeEventCalendarsArray(JSON.parse(trimmed) as unknown);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeOneCalendarEntry(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      return normalizeEventCalendarsArray(keys.map((k) => record[k]));
    }
  }
  return [];
}
