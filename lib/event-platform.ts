/** Where the meeting happens. Independent from {@link EventFormat} event type. */
export type EventPlatform = "Zoom" | "Teams" | "Virtual" | "In Person Meeting";

export const PLATFORM_OPTIONS: ReadonlyArray<{ value: EventPlatform; label: string }> = [
  { value: "Zoom", label: "Zoom" },
  { value: "Teams", label: "Teams" },
  { value: "Virtual", label: "Virtual" },
  { value: "In Person Meeting", label: "In Person Meeting" },
];

export function normalizeEventPlatform(value: unknown): EventPlatform {
  const s = String(value ?? "").trim();
  if (s === "Teams") {
    return "Teams";
  }
  if (s === "Virtual") {
    return "Virtual";
  }
  if (s === "In Person Meeting" || s.toLowerCase() === "in person") {
    return "In Person Meeting";
  }
  return "Zoom";
}

export function isInPersonMeetingPlatform(value: unknown): boolean {
  return normalizeEventPlatform(value) === "In Person Meeting";
}

/** Virtual platforms include a join link; in-person events do not. */
export function platformUsesMeetingLink(value: unknown): boolean {
  return !isInPersonMeetingPlatform(value);
}

export function resolveMeetingLink(platform: unknown, link: unknown): string {
  if (!platformUsesMeetingLink(platform)) {
    return "";
  }
  return String(link ?? "").trim();
}
