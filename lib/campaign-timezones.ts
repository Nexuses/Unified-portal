const FALLBACK_TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function readSupportedTimeZones(): string[] {
  try {
    if (
      typeof Intl !== "undefined" &&
      "supportedValuesOf" in Intl &&
      typeof Intl.supportedValuesOf === "function"
    ) {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // Older runtimes may throw for unsupported keys.
  }
  return [];
}

/** Full IANA timezone list for campaign advanced settings (drip + 1-1). */
export function listCampaignTimezones(preferred?: string | null): string[] {
  const supported = readSupportedTimeZones();
  const zones = supported.length > 0 ? [...supported] : [...FALLBACK_TIMEZONES];

  // UTC is valid for scheduling but omitted by some Intl.supportedValuesOf builds.
  for (const required of ["UTC", "Asia/Kolkata"]) {
    if (!zones.includes(required)) {
      zones.push(required);
    }
  }

  const preferredZones = ["Asia/Kolkata", "UTC"];
  if (preferred?.trim()) {
    preferredZones.unshift(preferred.trim());
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const zone of preferredZones) {
    if (!zone || seen.has(zone)) {
      continue;
    }
    if (zones.includes(zone) || preferred?.trim() === zone) {
      seen.add(zone);
      ordered.push(zone);
    }
  }
  for (const zone of zones.sort((a, b) => a.localeCompare(b))) {
    if (seen.has(zone)) {
      continue;
    }
    seen.add(zone);
    ordered.push(zone);
  }
  return ordered;
}

export function formatTimezoneLabel(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    return `${timeZone} ${offset.replace("GMT", "GMT ")}`.trim();
  } catch {
    return timeZone;
  }
}
