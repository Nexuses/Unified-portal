/**
 * Event date + time fields are wall-clock values in this zone (legacy UI used GMT+5:30).
 */
export const EVENT_WALL_TIME_ZONE = "Asia/Kolkata";

/** Normalize stored times to `HH:MM` for `<input type="time">`. */
export function normalizeTimeInput(value: unknown): string {
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

/** Fixed locale so SSR and first client paint produce identical strings. */
const STABLE_DISPLAY_LOCALE = "en-GB";

function pad2(n: number) {
  return String(Math.trunc(n)).padStart(2, "0");
}

/**
 * Normalizes stored event dates to `YYYY-MM-DD` for comparisons and IST wall parsing.
 * Handles HTML date values, ISO datetimes (`2025-05-04T00:00:00.000Z`), and BSON `Date`.
 */
export function toWallDateYmd(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    const y = value.getUTCFullYear();
    const mo = value.getUTCMonth() + 1;
    const d = value.getUTCDate();
    return `${pad2(y)}-${pad2(mo)}-${pad2(d)}`;
  }
  const s = String(value).trim();
  if (!s) {
    return "";
  }
  const isoDay = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoDay) {
    return isoDay[1];
  }
  return s;
}

/** Parses HTML time values like `14:30` or `9:05`. */
export function parseClockToMinutes(timeStr: string): number | null {
  const t = timeStr.trim();
  if (!t) {
    return null;
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

function parseYmd(dateStr: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toWallDateYmd(dateStr));
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  return { y, mo, d };
}

/**
 * Interprets YYYY-MM-DD + HH:mm as a moment in {@link EVENT_WALL_TIME_ZONE} (fixed +05:30).
 */
export function eventWallToUtc(dateStr: string, timeStr: string): Date | null {
  const ymd = parseYmd(dateStr);
  const mins = parseClockToMinutes(timeStr);
  if (!ymd || mins === null) {
    return null;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const iso = `${pad2(ymd.y)}-${pad2(ymd.mo)}-${pad2(ymd.d)}T${pad2(h)}:${pad2(m)}:00+05:30`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function resolveEndUtc(
  dateStr: string,
  timeStartStr: string,
  timeEndStr: string
): Date | null {
  const start = eventWallToUtc(dateStr, timeStartStr);
  let end = eventWallToUtc(dateStr, timeEndStr);
  if (!start || !end) {
    return end;
  }
  if (end.getTime() < start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return end;
}

export type ViewerSlotDisplay = {
  calendarMonth: string;
  calendarDay: string;
  titleLine: string;
  timeRangeLine: string;
  zoneSuffix: string;
};

/** Fixed abbreviations when Intl only returns GMT/UTC offsets in English. */
const ZONE_ABBREVIATIONS: Record<string, string> = {
  "Asia/Kolkata": "IST",
  "Asia/Calcutta": "IST",
  "Asia/Colombo": "IST",
  "Asia/Hong_Kong": "HKT",
  "Asia/Bangkok": "ICT",
  "Asia/Ho_Chi_Minh": "ICT",
  "Asia/Jakarta": "WIB",
  "Asia/Manila": "PHT",
  "Asia/Seoul": "KST",
  "Asia/Shanghai": "CST",
  "Asia/Taipei": "CST",
  "Asia/Kuala_Lumpur": "MYT",
  "Asia/Karachi": "PKT",
  "Asia/Dhaka": "BST",
  "Asia/Tokyo": "JST",
  "Asia/Singapore": "SGT",
  "Asia/Dubai": "GST",
  "Asia/Muscat": "GST",
  "Asia/Riyadh": "AST",
  "Asia/Kathmandu": "NPT",
  "Asia/Yangon": "MMT",
  "Asia/Jerusalem": "IST",
  "Asia/Tehran": "IRST",
};

const TIMEZONE_NAME_LOCALES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-NZ",
  "en-IN",
  "en-SG",
  "en-CA",
  "ja-JP",
] as const;

function isOffsetStyleTimeZoneName(name: string): boolean {
  return /^gmt[+-]/i.test(name) || /^utc[+-−]/i.test(name);
}

function preferredLocalesForTimeZone(viewerIana: string): string[] {
  const ordered = new Set<string>();

  if (viewerIana.startsWith("America/")) {
    ordered.add("en-US");
    ordered.add("en-CA");
  } else if (viewerIana.startsWith("Australia/")) {
    ordered.add("en-AU");
  } else if (viewerIana.startsWith("Pacific/Auckland")) {
    ordered.add("en-NZ");
  } else if (viewerIana === "Asia/Kolkata" || viewerIana === "Asia/Calcutta") {
    ordered.add("en-IN");
  } else if (viewerIana === "Asia/Singapore") {
    ordered.add("en-SG");
  } else if (viewerIana === "Asia/Tokyo") {
    ordered.add("ja-JP");
  } else if (viewerIana.startsWith("Europe/")) {
    ordered.add("en-GB");
  }

  for (const locale of TIMEZONE_NAME_LOCALES) {
    ordered.add(locale);
  }
  ordered.add(STABLE_DISPLAY_LOCALE);

  return [...ordered];
}

function readShortTimeZoneName(at: Date, viewerIana: string, locale: string): string | null {
  try {
    const name = new Intl.DateTimeFormat(locale, {
      timeZone: viewerIana,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")
      ?.value?.trim();
    if (!name || isOffsetStyleTimeZoneName(name)) {
      return null;
    }
    return name;
  } catch {
    return null;
  }
}

export function viewerTimeZoneLabel(at: Date, viewerIana: string): string {
  const mapped = ZONE_ABBREVIATIONS[viewerIana];
  if (mapped) {
    return mapped;
  }

  for (const locale of preferredLocalesForTimeZone(viewerIana)) {
    const name = readShortTimeZoneName(at, viewerIana, locale);
    if (name) {
      return name;
    }
  }

  return viewerIana.split("/").pop()?.replace(/_/g, " ") ?? viewerIana;
}

/**
 * Formats one slot for the public page in the viewer's IANA timezone.
 */
export function formatEventSlotForViewer(
  eventDate: string,
  eventTimeStart: string,
  eventTimeEnd: string,
  viewerIana: string
): ViewerSlotDisplay | null {
  const start = eventWallToUtc(eventDate, eventTimeStart);
  const end = resolveEndUtc(eventDate, eventTimeStart, eventTimeEnd);
  if (!start || !end) {
    return null;
  }

  const zoneSuffix = viewerTimeZoneLabel(start, viewerIana);

  const calendarMonth = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    month: "short",
    timeZone: viewerIana,
  })
    .format(start)
    .toUpperCase();

  const calendarDay = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    day: "numeric",
    timeZone: viewerIana,
  }).format(start);

  const titleLine = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: viewerIana,
  }).format(start);

  const tf = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: viewerIana,
  });
  const timeRangeLine = `${tf.format(start)} – ${tf.format(end)}`;

  return {
    calendarMonth,
    calendarDay,
    titleLine,
    timeRangeLine,
    zoneSuffix,
  };
}

export function formatHeaderClock(now: Date, viewerIana: string): string {
  const clock = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    timeZone: viewerIana,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const suffix = viewerTimeZoneLabel(now, viewerIana);
  return `${clock} ${suffix}`;
}

export type EventEmailDateTimeDisplay = {
  displayDate: string;
  displayTime: string;
};

/**
 * Formats event date/time for invite emails in the registrant's IANA timezone.
 * Falls back to {@link EVENT_WALL_TIME_ZONE} when no viewer zone is provided.
 */
export function formatEventEmailDateTime(
  eventDate: string,
  eventTimeStart: string,
  eventTimeEnd: string,
  viewerIana?: string | null
): EventEmailDateTimeDisplay {
  const zone = viewerIana?.trim() || EVENT_WALL_TIME_ZONE;
  const start = eventWallToUtc(eventDate, eventTimeStart);
  const end = resolveEndUtc(eventDate, eventTimeStart, eventTimeEnd);

  if (!start || !end) {
    const zoneSuffix = viewerTimeZoneLabel(new Date(), zone);
    return {
      displayDate: eventDate,
      displayTime: `${eventTimeStart} - ${eventTimeEnd} ${zoneSuffix}`,
    };
  }

  const displayDate = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: zone,
  }).format(start);

  const tf = new Intl.DateTimeFormat(STABLE_DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  });
  const zoneSuffix = viewerTimeZoneLabel(start, zone);

  return {
    displayDate,
    displayTime: `${tf.format(start)} - ${tf.format(end)} ${zoneSuffix}`,
  };
}
