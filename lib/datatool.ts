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

function splitKeywords(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((part) => String(part ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\n,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Match selected portal values (exact, or either side contains the other). */
function matchesSelected(value: string, selected: string[]) {
  if (selected.length === 0) {
    return true;
  }
  if (!value) {
    return false;
  }
  const hay = normalizeToken(value);
  return selected.some((item) => {
    const needle = normalizeToken(item);
    if (!needle) {
      return false;
    }
    return hay === needle || hay.includes(needle) || needle.includes(hay);
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

    if (titles.length > 0 && !matchesSelected(title, titles)) {
      return false;
    }
    if (
      levels.length > 0 &&
      !matchesSelected(seniority, levels) &&
      !matchesSelected(title, levels)
    ) {
      return false;
    }
    if (sizes.length > 0) {
      const known = sizes.filter((label) =>
        ENRICH_EMPLOYEE_SIZE_RANGES.some((range) => range.label === label),
      );
      const custom = sizes.filter(
        (label) =>
          !ENRICH_EMPLOYEE_SIZE_RANGES.some((range) => range.label === label),
      );
      const count = parseEmployeeCount(employees);
      const knownOk =
        known.length === 0 ||
        count == null ||
        valueInSelectedRanges(count, known, ENRICH_EMPLOYEE_SIZE_RANGES);
      const customOk =
        custom.length === 0 || matchesSelected(employees, custom);
      if (known.length > 0 && custom.length > 0) {
        if (!knownOk && !customOk) {
          return false;
        }
      } else if (known.length > 0) {
        if (count != null && !knownOk) {
          return false;
        }
      } else if (!customOk) {
        return false;
      }
    }
    if (industries.length > 0) {
      const industryParts = splitKeywords(industry);
      const ok =
        matchesSelected(industry, industries) ||
        industryParts.some((part) => matchesSelected(part, industries));
      if (!ok) {
        return false;
      }
    }
    if (techs.length > 0) {
      const techParts = splitKeywords(technologies);
      const ok =
        matchesSelected(technologies, techs) ||
        techParts.some((part) => matchesSelected(part, techs));
      if (!ok) {
        return false;
      }
    }
    if (revenues.length > 0) {
      const known = revenues.filter((label) =>
        ENRICH_REVENUE_RANGES.some((range) => range.label === label),
      );
      const custom = revenues.filter(
        (label) => !ENRICH_REVENUE_RANGES.some((range) => range.label === label),
      );
      const amount = parseRevenueUsd(annualRevenue);
      const knownOk =
        known.length === 0 ||
        amount == null ||
        valueInSelectedRanges(amount, known, ENRICH_REVENUE_RANGES);
      const customOk =
        custom.length === 0 || matchesSelected(annualRevenue, custom);
      if (known.length > 0 && custom.length > 0) {
        if (!knownOk && !customOk) {
          return false;
        }
      } else if (known.length > 0) {
        if (amount != null && !knownOk) {
          return false;
        }
      } else if (!customOk) {
        return false;
      }
    }
    if (personLocs.length > 0 && !matchesSelected(contactCountry, personLocs)) {
      return false;
    }
    if (
      companyLocs.length > 0 &&
      !matchesSelected(companyCountry, companyLocs) &&
      !matchesSelected(companyAddress, companyLocs)
    ) {
      return false;
    }
    return true;
  });
}

export const ENRICH_RESULT_COLUMNS = [
  { key: "name", label: "Name", alwaysOn: true },
  { key: "title", label: "Title", alwaysOn: true },
  { key: "company_name", label: "Company", alwaysOn: true },
  { key: "email", label: "Email", alwaysOn: true },
  { key: "contact_country", label: "Person Location", alwaysOn: false },
  { key: "first_name", label: "First Name", alwaysOn: false },
  { key: "last_name", label: "Last Name", alwaysOn: false },
  { key: "email_status", label: "Email Status", alwaysOn: false },
  { key: "seniority", label: "Management Level", alwaysOn: false },
  { key: "departments", label: "Departments", alwaysOn: false },
  { key: "personal_phone", label: "Personal Phone", alwaysOn: false },
  { key: "company_phone", label: "Company Phone", alwaysOn: false },
  { key: "employees", label: "Employees", alwaysOn: false },
  { key: "industry", label: "Industry", alwaysOn: false },
  { key: "person_linkedin_url", label: "Person LinkedIn", alwaysOn: false },
  { key: "website", label: "Website", alwaysOn: false },
  { key: "technologies", label: "Technologies", alwaysOn: false },
  { key: "company_address", label: "Company Address", alwaysOn: false },
  { key: "company_linkedin_url", label: "Company LinkedIn", alwaysOn: false },
  { key: "company_country", label: "Company Country", alwaysOn: false },
  { key: "annual_revenue", label: "Revenue", alwaysOn: false },
  { key: "data_date", label: "Data Date", alwaysOn: false },
] as const;

export type EnrichColumnKey = (typeof ENRICH_RESULT_COLUMNS)[number]["key"];

export const DEFAULT_ENRICH_VISIBLE_COLUMNS: EnrichColumnKey[] = [
  "name",
  "title",
  "company_name",
  "email",
  "contact_country",
];

export function formatEnrichRecordField(
  record: DataToolRecord,
  key: EnrichColumnKey,
) {
  if (key === "name") {
    const name = [record.first_name, record.last_name]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    return name || String(record.email ?? "Unknown");
  }
  return String(record[key] ?? "").trim();
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
  put("phoneNumber", record.personal_phone || record.company_phone);
  put("personalPhone", record.personal_phone);
  put("companyPhone", record.company_phone);
  put(
    "personLocation",
    [record.contact_country, record.company_address, record.company_country]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(", "),
  );
  put("contactCountry", record.contact_country);
  put("companyCountry", record.company_country);
  put("companyAddress", record.company_address);
  put("seniority", record.seniority);
  put("employees", record.employees);
  put("technologies", record.technologies);
  put("annualRevenue", record.annual_revenue);
  put("departments", record.departments);
  put("emailStatus", record.email_status);
  put("dataDate", record.data_date);
  put("dataToolId", record.id);
  put("sourceFile", record.sourceFile);

  return {
    firstName: firstName || email.split("@")[0] || "Unknown",
    lastName,
    email,
    companyName,
    attributes,
  };
}
