const COUNTRY_NAMES: Record<string, string> = {
  AF: "Afghanistan",
  AL: "Albania",
  DZ: "Algeria",
  AR: "Argentina",
  AM: "Armenia",
  AU: "Australia",
  AT: "Austria",
  AZ: "Azerbaijan",
  BH: "Bahrain",
  BD: "Bangladesh",
  BY: "Belarus",
  BE: "Belgium",
  BO: "Bolivia",
  BA: "Bosnia and Herzegovina",
  BR: "Brazil",
  BG: "Bulgaria",
  KH: "Cambodia",
  CA: "Canada",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  HR: "Croatia",
  CY: "Cyprus",
  CZ: "Czechia",
  DK: "Denmark",
  DO: "Dominican Republic",
  EC: "Ecuador",
  EG: "Egypt",
  EE: "Estonia",
  ET: "Ethiopia",
  FI: "Finland",
  FR: "France",
  GE: "Georgia",
  DE: "Germany",
  GH: "Ghana",
  GR: "Greece",
  GT: "Guatemala",
  HK: "Hong Kong",
  HU: "Hungary",
  IS: "Iceland",
  IN: "India",
  ID: "Indonesia",
  IR: "Iran",
  IQ: "Iraq",
  IE: "Ireland",
  IL: "Israel",
  IT: "Italy",
  JM: "Jamaica",
  JP: "Japan",
  JO: "Jordan",
  KZ: "Kazakhstan",
  KE: "Kenya",
  KW: "Kuwait",
  LV: "Latvia",
  LB: "Lebanon",
  LT: "Lithuania",
  LU: "Luxembourg",
  MY: "Malaysia",
  MV: "Maldives",
  MT: "Malta",
  MX: "Mexico",
  MD: "Moldova",
  MN: "Mongolia",
  ME: "Montenegro",
  MA: "Morocco",
  MM: "Myanmar",
  NP: "Nepal",
  NL: "Netherlands",
  NZ: "New Zealand",
  NG: "Nigeria",
  MK: "North Macedonia",
  NO: "Norway",
  OM: "Oman",
  PK: "Pakistan",
  PA: "Panama",
  PY: "Paraguay",
  PE: "Peru",
  PH: "Philippines",
  PL: "Poland",
  PT: "Portugal",
  QA: "Qatar",
  RO: "Romania",
  RU: "Russia",
  SA: "Saudi Arabia",
  RS: "Serbia",
  SG: "Singapore",
  SK: "Slovakia",
  SI: "Slovenia",
  ZA: "South Africa",
  KR: "South Korea",
  ES: "Spain",
  LK: "Sri Lanka",
  SE: "Sweden",
  CH: "Switzerland",
  TW: "Taiwan",
  TZ: "Tanzania",
  TH: "Thailand",
  TR: "Turkey",
  UG: "Uganda",
  UA: "Ukraine",
  AE: "United Arab Emirates",
  GB: "United Kingdom",
  UK: "United Kingdom",
  US: "United States",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VE: "Venezuela",
  VN: "Vietnam",
  ZW: "Zimbabwe",
};

const TIMEZONE_COUNTRY: Record<string, string> = {
  "Asia/Kolkata": "India",
  "Asia/Calcutta": "India",
  "Asia/Dubai": "United Arab Emirates",
  "Asia/Singapore": "Singapore",
  "Asia/Hong_Kong": "Hong Kong",
  "Asia/Tokyo": "Japan",
  "Asia/Seoul": "South Korea",
  "Asia/Shanghai": "China",
  "Asia/Taipei": "Taiwan",
  "Asia/Bangkok": "Thailand",
  "Asia/Jakarta": "Indonesia",
  "Asia/Manila": "Philippines",
  "Asia/Karachi": "Pakistan",
  "Asia/Dhaka": "Bangladesh",
  "Asia/Kathmandu": "Nepal",
  "Asia/Colombo": "Sri Lanka",
  "Asia/Riyadh": "Saudi Arabia",
  "Asia/Qatar": "Qatar",
  "Asia/Kuwait": "Kuwait",
  "Asia/Bahrain": "Bahrain",
  "Europe/London": "United Kingdom",
  "Europe/Dublin": "Ireland",
  "Europe/Paris": "France",
  "Europe/Berlin": "Germany",
  "Europe/Amsterdam": "Netherlands",
  "Europe/Madrid": "Spain",
  "Europe/Rome": "Italy",
  "Europe/Zurich": "Switzerland",
  "Europe/Stockholm": "Sweden",
  "Europe/Moscow": "Russia",
  "America/New_York": "United States",
  "America/Chicago": "United States",
  "America/Denver": "United States",
  "America/Los_Angeles": "United States",
  "America/Toronto": "Canada",
  "America/Vancouver": "Canada",
  "America/Sao_Paulo": "Brazil",
  "America/Mexico_City": "Mexico",
  "Australia/Sydney": "Australia",
  "Australia/Melbourne": "Australia",
  "Pacific/Auckland": "New Zealand",
  "Africa/Johannesburg": "South Africa",
  "Africa/Lagos": "Nigeria",
  "Africa/Cairo": "Egypt",
};

export type VisitorLocation = {
  country: string;
  region: string;
  city: string;
};

function clean(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\+/g, " ");
}

function decodeHeader(value: string) {
  const raw = clean(value);
  if (!raw) {
    return "";
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function countryNameFromCode(code: string) {
  const normalized = clean(code).toUpperCase();
  if (!normalized || normalized === "XX" || normalized === "T1") {
    return "";
  }
  return COUNTRY_NAMES[normalized] || normalized;
}

export function countryFromTimezone(timezone: string) {
  const tz = clean(timezone);
  if (!tz) {
    return "";
  }
  if (TIMEZONE_COUNTRY[tz]) {
    return TIMEZONE_COUNTRY[tz];
  }
  if (tz.startsWith("Asia/Kolkata") || tz.startsWith("Asia/Calcutta")) {
    return "India";
  }
  if (tz.startsWith("America/")) {
    return "United States";
  }
  if (tz.startsWith("Europe/London")) {
    return "United Kingdom";
  }
  return "";
}

export function displayCountry(country: string, timezone?: string) {
  const direct = clean(country);
  if (direct && direct.toLowerCase() !== "unknown") {
    return countryNameFromCode(direct) || direct;
  }
  return countryFromTimezone(timezone ?? "") || "";
}

export function clientIpFromHeaders(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
  const cfIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const vercelIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const candidate = forwarded || realIp || cfIp || vercelIp;
  if (!candidate || candidate === "::1" || candidate === "127.0.0.1") {
    return "";
  }
  return candidate;
}

function locationFromPlatformHeaders(request: Request): VisitorLocation {
  const countryCode =
    request.headers.get("x-vercel-ip-country")?.trim() ||
    request.headers.get("cf-ipcountry")?.trim() ||
    "";
  return {
    country: countryNameFromCode(countryCode),
    region: decodeHeader(request.headers.get("x-vercel-ip-country-region") ?? ""),
    city: decodeHeader(request.headers.get("x-vercel-ip-city") ?? ""),
  };
}

async function locationFromIpLookup(ip: string): Promise<VisitorLocation | null> {
  if (!ip) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      success?: boolean;
      country?: string;
      region?: string;
      city?: string;
      country_code?: string;
    };
    if (payload.success === false) {
      return null;
    }
    const country =
      clean(payload.country) || countryNameFromCode(clean(payload.country_code));
    return {
      country,
      region: clean(payload.region),
      city: clean(payload.city),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveVisitorLocation(input: {
  request: Request;
  timezone?: string;
}): Promise<VisitorLocation> {
  const fromHeaders = locationFromPlatformHeaders(input.request);
  if (fromHeaders.country || fromHeaders.city) {
    return {
      country: fromHeaders.country || countryFromTimezone(input.timezone ?? ""),
      region: fromHeaders.region,
      city: fromHeaders.city,
    };
  }

  const ip = clientIpFromHeaders(input.request);
  const fromIp = await locationFromIpLookup(ip);
  if (fromIp && (fromIp.country || fromIp.city)) {
    return fromIp;
  }

  return {
    country: countryFromTimezone(input.timezone ?? ""),
    region: "",
    city: "",
  };
}
