/** Client-safe event format helpers (no MongoDB / Node built-ins). */

export type EventFormat = "one_to_one" | "webinar" | "webinar_waitlisted";

export function normalizeEventFormat(value: unknown): EventFormat {
  if (value === "webinar") {
    return "webinar";
  }
  if (value === "webinar_waitlisted" || value === "webinar_waitlist") {
    return "webinar_waitlisted";
  }
  return "one_to_one";
}

/** Open webinar: public register goes straight to Going. */
export function isWebinarFormat(value: unknown): boolean {
  return normalizeEventFormat(value) === "webinar";
}

/** Waitlisted webinar: public register joins waitlist until admin confirms. */
export function isWaitlistedWebinarFormat(value: unknown): boolean {
  return normalizeEventFormat(value) === "webinar_waitlisted";
}

/** Shared single-session events (open webinar or waitlisted). */
export function isSharedSessionFormat(value: unknown): boolean {
  const format = normalizeEventFormat(value);
  return format === "webinar" || format === "webinar_waitlisted";
}

export function eventFormatLabel(value: unknown): string {
  const format = normalizeEventFormat(value);
  if (format === "webinar") {
    return "Webinar";
  }
  if (format === "webinar_waitlisted") {
    return "Webinar Waitlist";
  }
  return "1-1";
}

export const EVENT_FORMAT_OPTIONS: Array<{ value: EventFormat; label: string }> = [
  { value: "one_to_one", label: "1-1" },
  { value: "webinar", label: "Webinar" },
  { value: "webinar_waitlisted", label: "Webinar Waitlist" },
];
