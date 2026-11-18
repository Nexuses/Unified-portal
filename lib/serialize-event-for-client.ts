import { normalizeEventFormat } from "@/lib/event-format";
import {
  extractRawEventCalendarsField,
  normalizeEventCalendarsArray,
} from "@/lib/normalize-event-calendars";

/**
 * `JSON.parse(JSON.stringify(mongoDoc))` can mangle or drop `eventCalendars` depending on BSON
 * types. Always re-attach a normalized calendar array for client components.
 */
export function serializeEventForClient<T extends Record<string, unknown>>(event: T): T {
  const raw = extractRawEventCalendarsField(event) ?? event.eventCalendars;
  const clone = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
  clone.eventCalendars = normalizeEventCalendarsArray(raw);
  clone.eventFormat = normalizeEventFormat(clone.eventFormat);
  return clone as T;
}
