export type DataToolRecordType = "people" | "companies";

export type DataToolRecord = {
  id: string;
  type: DataToolRecordType | string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company_name?: string;
  email?: string;
  email_status?: string;
  seniority?: string;
  departments?: string;
  personal_phone?: string;
  company_phone?: string;
  employees?: string;
  industry?: string;
  person_linkedin_url?: string;
  contact_country?: string;
  website?: string;
  technologies?: string;
  company_address?: string;
  company_linkedin_url?: string;
  company_country?: string;
  annual_revenue?: string;
  data_date?: string;
  sourceFile?: string;
  isUsed?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type DataToolListResponse = {
  type: DataToolRecordType | string;
  page: number;
  limit: number;
  total: number;
  records: DataToolRecord[];
};

export type EnrichSearchFilters = {
  titles?: string[];
  managementLevels?: string[];
  employeeSizes?: string[];
  industryKeywords?: string[];
  revenueRanges?: string[];
  technologies?: string[];
  personLocations?: string[];
  companyLocations?: string[];
};

export type EnrichOptions = {
  titles: string[];
  managementLevels: string[];
  employeeSizes: string[];
  industryKeywords: string[];
  revenueRanges: string[];
  technologies: string[];
  personLocations: string[];
  companyLocations: string[];
  scanned: number;
  total: number;
};

type NumericRange = {
  label: string;
  min: number;
  max: number | null;
};

/** Fixed employee-size buckets for Enrich (not raw Data Tool strings). */
export const ENRICH_EMPLOYEE_SIZE_RANGES: NumericRange[] = [
  { label: "1-500", min: 1, max: 500 },
  { label: "500-1,000", min: 500, max: 1000 },
  { label: "1,000-5,000", min: 1000, max: 5000 },
  { label: "5,000-10,000", min: 5000, max: 10000 },
  { label: "10,000-20,000", min: 10000, max: 20000 },
  { label: "20,000-50,000", min: 20000, max: 50000 },
  { label: "50,000-100,000", min: 50000, max: 100000 },
  { label: "100,000+", min: 100000, max: null },
];

/** Fixed revenue buckets for Enrich. */
export const ENRICH_REVENUE_RANGES: NumericRange[] = [
  { label: "Under $1M", min: 0, max: 1_000_000 },
  { label: "$1M-$10M", min: 1_000_000, max: 10_000_000 },
  { label: "$10M-$50M", min: 10_000_000, max: 50_000_000 },
  { label: "$50M-$100M", min: 50_000_000, max: 100_000_000 },
  { label: "$100M-$500M", min: 100_000_000, max: 500_000_000 },
  { label: "$500M-$1B", min: 500_000_000, max: 1_000_000_000 },
  { label: "$1B-$5B", min: 1_000_000_000, max: 5_000_000_000 },
  { label: "$5B+", min: 5_000_000_000, max: null },
];

export const ENRICH_EMPLOYEE_SIZE_LABELS = ENRICH_EMPLOYEE_SIZE_RANGES.map(
  (range) => range.label,
);
export const ENRICH_REVENUE_RANGE_LABELS = ENRICH_REVENUE_RANGES.map(
  (range) => range.label,
);

const DEFAULT_BASE = "https://datatool.nexuses-online.com";

function getConfig() {
  const apiKey = process.env.DATATOOL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DATATOOL_API_KEY is not set. Add it to .env.local to use CRM Enrich.",
    );
  }
  const baseUrl = (
    process.env.DATATOOL_API_BASE_URL?.trim() || DEFAULT_BASE
  ).replace(/\/$/, "");
  return { apiKey, baseUrl };
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

export async function verifyDataToolKey() {
  const { apiKey, baseUrl } = getConfig();
  const response = await fetch(`${baseUrl}/api/v1/me`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    key?: { name?: string; scope?: string; scopeLabel?: string };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error || `Data Tool auth failed (${response.status})`);
  }
  return data;
}

function splitKeywords(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((part) => String(part ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\n,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pushUnique(target: Set<string>, value: unknown, splitMulti = false) {
  const text = String(value ?? "").trim();
  if (!text) {
    return;
  }
  if (!splitMulti) {
    target.add(text);
    return;
  }
  for (const part of text.split(/[,|;/]+/)) {
    const item = part.trim();
    if (item) {
      target.add(item);
    }
  }
}

function sortedOptions(values: Set<string>) {
  return [...values].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/** Build a free-text `q` for Data Tool list endpoint from enrich form fields. */
export function buildEnrichQuery(filters: EnrichSearchFilters) {
  // Employee size + revenue are numeric range filters — do not put labels into `q`.
  const parts = [
    ...splitKeywords(filters.titles),
    ...(filters.managementLevels || []),
    ...splitKeywords(filters.industryKeywords),
    ...splitKeywords(filters.technologies),
    ...(filters.personLocations || []),
    ...(filters.companyLocations || []),
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" ").trim();
}

function matchesExact(value: string, selected: string[]) {
  if (selected.length === 0) {
    return true;
  }
  if (!value) {
    return false;
  }
  const needle = value.toLowerCase();
  return selected.some((item) => item.toLowerCase() === needle);
}

function matchesExactOrContains(value: string, selected: string[]) {
  if (selected.length === 0) {
    return true;
  }
  if (!value) {
    return false;
  }
  const hay = value.toLowerCase();
  return selected.some((item) => {
    const needle = item.toLowerCase();
    return hay === needle || hay.includes(needle);
  });
}

/** Parse employee headcount from Data Tool strings like "51-100", "10,000+", "500". */
export function parseEmployeeCount(raw: string): number | null {
  const cleaned = String(raw ?? "").replace(/,/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const nums = [...cleaned.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) {
    return null;
  }
  if (nums.length >= 2) {
    return Math.round((nums[0] + nums[1]) / 2);
  }
  return nums[0];
}

/** Parse revenue USD from strings like "$10M", "1.5B", "$50,000,000", "10 million". */
export function parseRevenueUsd(raw: string): number | null {
  const text = String(raw ?? "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\$/g, "")
    .trim();
  if (!text) {
    return null;
  }

  const millionMatch = text.match(/(\d+(?:\.\d+)?)\s*(million|mm)\b/);
  if (millionMatch) {
    return Number(millionMatch[1]) * 1_000_000;
  }
  const billionMatch = text.match(/(\d+(?:\.\d+)?)\s*(billion|bb)\b/);
  if (billionMatch) {
    return Number(billionMatch[1]) * 1_000_000_000;
  }

  const suffixMatch = text.match(/(\d+(?:\.\d+)?)\s*([kmb])\b/);
  if (suffixMatch) {
    const amount = Number(suffixMatch[1]);
    const suffix = suffixMatch[2];
    if (suffix === "k") return amount * 1_000;
    if (suffix === "m") return amount * 1_000_000;
    if (suffix === "b") return amount * 1_000_000_000;
  }

  const rangeNums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*([kmb])?/g)].map(
    (match) => {
      const amount = Number(match[1]);
      const suffix = match[2];
      if (suffix === "k") return amount * 1_000;
      if (suffix === "m") return amount * 1_000_000;
      if (suffix === "b") return amount * 1_000_000_000;
      return amount;
    },
  );
  if (rangeNums.length >= 2) {
    return Math.round((rangeNums[0] + rangeNums[1]) / 2);
  }
  if (rangeNums.length === 1 && Number.isFinite(rangeNums[0])) {
    return rangeNums[0];
  }
  return null;
}

function valueInSelectedRanges(
  value: number | null,
  selectedLabels: string[],
  ranges: NumericRange[],
) {
  if (selectedLabels.length === 0) {
    return true;
  }
  if (value == null || !Number.isFinite(value)) {
    return false;
  }
  const selected = new Set(selectedLabels);
  return ranges.some((range) => {
    if (!selected.has(range.label)) {
      return false;
    }
    if (value < range.min) {
      return false;
    }
    if (range.max == null) {
      return true;
    }
    return value <= range.max;
  });
}

/** Filter using portal values + fixed size/revenue ranges. */
export function filterEnrichRecords(
  records: DataToolRecord[],
  filters: EnrichSearchFilters,
) {
  const titles = (filters.titles || []).map((v) => v.trim()).filter(Boolean);
  const levels = (filters.managementLevels || [])
    .map((v) => v.trim())
    .filter(Boolean);
  const sizes = (filters.employeeSizes || []).map((v) => v.trim()).filter(Boolean);
  const industries = (filters.industryKeywords || [])
    .map((v) => v.trim())
    .filter(Boolean);
  const techs = (filters.technologies || []).map((v) => v.trim()).filter(Boolean);
  const revenues = (filters.revenueRanges || [])
    .map((v) => v.trim())
    .filter(Boolean);
  const personLocs = (filters.personLocations || [])
    .map((v) => v.trim())
    .filter(Boolean);
  const companyLocs = (filters.companyLocations || [])
    .map((v) => v.trim())
    .filter(Boolean);

  return records.filter((record) => {
    const title = String(record.title ?? "").trim();
    const seniority = String(record.seniority ?? "").trim();
    const employees = String(record.employees ?? "").trim();
    const industry = String(record.industry ?? "").trim();
    const technologies = String(record.technologies ?? "").trim();
    const annualRevenue = String(record.annual_revenue ?? "").trim();
    const contactCountry = String(record.contact_country ?? "").trim();
    const companyCountry = String(record.company_country ?? "").trim();
    const companyAddress = String(record.company_address ?? "").trim();

    if (titles.length > 0 && !matchesExact(title, titles)) {
      return false;
    }
    if (levels.length > 0 && !matchesExact(seniority, levels)) {
      return false;
    }
    if (
      sizes.length > 0 &&
      !valueInSelectedRanges(
        parseEmployeeCount(employees),
        sizes,
        ENRICH_EMPLOYEE_SIZE_RANGES,
      )
    ) {
      return false;
    }
    if (industries.length > 0) {
      const industryParts = splitKeywords(industry);
      const ok =
        industryParts.some((part) => matchesExact(part, industries)) ||
        matchesExact(industry, industries);
      if (!ok) {
        return false;
      }
    }
    if (techs.length > 0) {
      const techParts = splitKeywords(technologies);
      if (!techParts.some((part) => matchesExact(part, techs))) {
        return false;
      }
    }
    if (
      revenues.length > 0 &&
      !valueInSelectedRanges(
        parseRevenueUsd(annualRevenue),
        revenues,
        ENRICH_REVENUE_RANGES,
      )
    ) {
      return false;
    }
    if (
      personLocs.length > 0 &&
      !matchesExactOrContains(contactCountry, personLocs)
    ) {
      return false;
    }
    if (
      companyLocs.length > 0 &&
      !matchesExactOrContains(companyCountry, companyLocs) &&
      !matchesExactOrContains(companyAddress, companyLocs)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Scan Data Tool people records and collect distinct portal values for dropdowns.
 * Employee size + revenue always use fixed range labels.
 */
export async function collectEnrichOptions(input?: {
  q?: string;
  maxPages?: number;
}) {
  const maxPages = Math.min(12, Math.max(1, input?.maxPages || 8));
  const titles = new Set<string>();
  const managementLevels = new Set<string>();
  const industryKeywords = new Set<string>();
  const technologies = new Set<string>();
  const personLocations = new Set<string>();
  const companyLocations = new Set<string>();

  let total = 0;
  let scanned = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listDataToolRecords({
      type: "people",
      q: input?.q,
      page,
      limit: 200,
    });
    total = result.total;
    scanned += result.records.length;
    if (result.records.length === 0) {
      break;
    }

    for (const record of result.records) {
      pushUnique(titles, record.title);
      pushUnique(managementLevels, record.seniority);
      pushUnique(industryKeywords, record.industry, true);
      pushUnique(technologies, record.technologies, true);
      pushUnique(personLocations, record.contact_country);
      pushUnique(companyLocations, record.company_country);
      pushUnique(companyLocations, record.company_address);
    }

    if (page * result.limit >= result.total) {
      break;
    }
  }

  return {
    titles: sortedOptions(titles),
    managementLevels: sortedOptions(managementLevels),
    employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
    industryKeywords: sortedOptions(industryKeywords),
    revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
    technologies: sortedOptions(technologies),
    personLocations: sortedOptions(personLocations),
    companyLocations: sortedOptions(companyLocations),
    scanned,
    total,
  } satisfies EnrichOptions;
}

export async function listDataToolRecords(input: {
  type?: DataToolRecordType;
  q?: string;
  page?: number;
  limit?: number;
}) {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(`${baseUrl}/api/v1/records`);
  url.searchParams.set("type", input.type || "people");
  url.searchParams.set("page", String(Math.max(1, input.page || 1)));
  url.searchParams.set(
    "limit",
    String(Math.min(200, Math.max(1, input.limit || 50))),
  );
  if (input.q?.trim()) {
    url.searchParams.set("q", input.q.trim());
  }

  const response = await fetch(url, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as
    | (DataToolListResponse & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(
      data?.error || `Data Tool search failed (${response.status})`,
    );
  }

  return {
    type: data?.type || input.type || "people",
    page: Number(data?.page || input.page || 1),
    limit: Number(data?.limit || input.limit || 50),
    total: Number(data?.total || 0),
    records: Array.isArray(data?.records) ? data.records : [],
  } satisfies DataToolListResponse;
}

export async function searchEnrichPeople(
  filters: EnrichSearchFilters,
  options?: { page?: number; limit?: number },
) {
  const q = buildEnrichQuery(filters);
  const page = Math.max(1, options?.page || 1);
  const limit = Math.min(100, Math.max(1, options?.limit || 50));
  const result = await listDataToolRecords({
    type: "people",
    q,
    page,
    limit,
  });
  const filtered = filterEnrichRecords(result.records, filters);
  return {
    ...result,
    q,
    records: filtered,
    matched: filtered.length,
  };
}

export function mapDataToolRecordToContact(record: DataToolRecord) {
  const firstName = String(record.first_name ?? "").trim();
  const lastName = String(record.last_name ?? "").trim();
  const email = String(record.email ?? "").trim();
  const companyName = String(record.company_name ?? "").trim() || "Unknown";
  const attributes: Record<string, string> = {};

  const put = (key: string, value: unknown) => {
    const text = String(value ?? "").trim();
    if (text) {
      attributes[key] = text;
    }
  };

  put("position", record.title);
  put("industry", record.industry);
  put("website", record.website);
  put("companySourceUrl", record.company_linkedin_url);
  put("personalLinkedIn", record.person_linkedin_url);
  put(
    "phoneNumber",
    record.personal_phone || record.company_phone,
  );
  put(
    "personLocation",
    [record.contact_country, record.company_country]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(", "),
  );
  put("seniority", record.seniority);
  put("employees", record.employees);
  put("technologies", record.technologies);
  put("annualRevenue", record.annual_revenue);
  put("departments", record.departments);
  put("emailStatus", record.email_status);
  put("dataToolId", record.id);

  return {
    firstName: firstName || email.split("@")[0] || "Unknown",
    lastName,
    email,
    companyName,
    attributes,
  };
}
