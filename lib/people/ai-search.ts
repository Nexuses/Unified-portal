import {
  EMPTY_COMPANY_FILTER,
  EMPTY_EMPLOYEES_FILTER,
  EMPTY_INDUSTRY_KEYWORDS_FILTER,
  EMPTY_JOB_TITLE_FILTER,
  EMPTY_LOCATION_FILTER,
  EMPTY_PEOPLE_LOOKALIKES_FILTER,
  EMPTY_REVENUE_FILTER,
  EMPTY_TECHNOLOGIES_FILTER,
  companyActiveTags,
  employeesActiveTags,
  industryKeywordsActiveTags,
  isCompanyFilterEmpty,
  isEmployeesFilterEmpty,
  isIndustryKeywordsFilterEmpty,
  isJobTitleFilterEmpty,
  isLocationFilterEmpty,
  isPeopleLookalikesFilterEmpty,
  isRevenueFilterEmpty,
  isTechnologiesFilterEmpty,
  jobTitleActiveTags,
  locationActiveTags,
  peopleLookalikesActiveTags,
  revenueActiveTags,
  technologiesActiveTags,
  type CompanyFilter,
  type EmployeesFilter,
  type IndustryKeywordsFilter,
  type JobTitleFilter,
  type LocationFilter,
  type PeopleLookalikesFilter,
  type RevenueFilter,
  type TechnologiesFilter,
} from "@/lib/people/data-browser/types";
import { EMPTY_COLUMN_FILTER_STATE } from "@/lib/people/column-filters";
import type { FilterPresetPayload } from "@/lib/people/filter-presets";
import type { DataView } from "@/lib/people/data-views";
import {
  expandTechnologyTermsAgainstOptions,
  expandTermsAgainstOptions,
  TECHNOLOGY_AMBIGUOUS_TERMS,
} from "@/lib/people/expand-filter-terms";

export const AI_SEARCH_MAX_QUERY_LENGTH = 500;

export type AiSearchExpandOptions = {
  technologies?: string[];
  industries?: string[];
  locations?: string[];
  jobTitles?: string[];
};

export type AiSearchFilters = {
  view: DataView;
  search: string;
  filters: {
    name?: string[];
    emailStatus?: string[];
  };
  jobTitleFilter: JobTitleFilter;
  peopleLookalikesFilter: PeopleLookalikesFilter;
  companyFilter: CompanyFilter;
  locationFilter: LocationFilter;
  employeesFilter: EmployeesFilter;
  industryKeywordsFilter: IndustryKeywordsFilter;
  technologiesFilter: TechnologiesFilter;
  revenueFilter: RevenueFilter;
  explanation: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function mergeJobTitleFilter(raw: unknown): JobTitleFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_JOB_TITLE_FILTER };
  const data = raw as Record<string, unknown>;
  return {
    include: asStringArray(data.include),
    includeSimilar: asBoolean(data.includeSimilar, true),
    exactMatch: asBoolean(data.exactMatch, false),
    exclude: asStringArray(data.exclude),
    pastTitlesInclude: asStringArray(data.pastTitlesInclude),
    pastTitlesExclude: asStringArray(data.pastTitlesExclude),
    managementLevel: asStringArray(data.managementLevel),
    departments: asStringArray(data.departments),
  };
}

function mergePeopleLookalikesFilter(raw: unknown): PeopleLookalikesFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PEOPLE_LOOKALIKES_FILTER };
  const data = raw as Record<string, unknown>;
  const lookalikeOf =
    data.lookalikeOf && typeof data.lookalikeOf === "object"
      ? {
          firstName: asString((data.lookalikeOf as Record<string, unknown>).firstName),
          lastName: asString((data.lookalikeOf as Record<string, unknown>).lastName),
          company: asString((data.lookalikeOf as Record<string, unknown>).company),
          title: asString((data.lookalikeOf as Record<string, unknown>).title),
          industry: asString((data.lookalikeOf as Record<string, unknown>).industry) || undefined,
          linkedInUrl:
            asString((data.lookalikeOf as Record<string, unknown>).linkedInUrl) || undefined,
        }
      : undefined;

  return {
    query: asString(data.query),
    workUrls: asString(data.workUrls),
    ...(lookalikeOf &&
    (lookalikeOf.firstName || lookalikeOf.lastName || lookalikeOf.company || lookalikeOf.title)
      ? { lookalikeOf }
      : {}),
  };
}

function mergeCompanyFilter(raw: unknown): CompanyFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_COMPANY_FILTER };
  const data = raw as Record<string, unknown>;
  const mode =
    data.mode === "is_known" || data.mode === "is_unknown" || data.mode === "is_any_of"
      ? data.mode
      : "is_any_of";
  const include = Array.isArray(data.include)
    ? data.include
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const name = asString((entry as Record<string, unknown>).name);
          if (!name) return null;
          const domain = asString((entry as Record<string, unknown>).domain);
          return domain ? { name, domain } : { name };
        })
        .filter((entry): entry is { name: string; domain?: string } => Boolean(entry))
    : [];

  return {
    mode,
    include,
    isNotAnyOf: asBoolean(data.isNotAnyOf, false),
    includePastCompany: asBoolean(data.includePastCompany, false),
    excludePastCompany: asBoolean(data.excludePastCompany, false),
    domainExists: asBoolean(data.domainExists, false),
    includeList: asString(data.includeList),
    excludeList: asString(data.excludeList),
    includeListNamesOnly: asBoolean(data.includeListNamesOnly, false),
    excludeListNamesOnly: asBoolean(data.excludeListNamesOnly, false),
  };
}

function mergeLocationFilter(raw: unknown): LocationFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_LOCATION_FILTER };
  const data = raw as Record<string, unknown>;
  return {
    tab: data.tab === "account_hq" ? "account_hq" : "contact",
    mode: "select_region",
    include: asStringArray(data.include),
    exclude: asStringArray(data.exclude),
  };
}

function mergeEmployeesFilter(raw: unknown): EmployeesFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_EMPLOYEES_FILTER };
  const data = raw as Record<string, unknown>;
  const customMin = asString(data.customMin);
  const customMax = asString(data.customMax);
  const predefinedRanges = asStringArray(data.predefinedRanges);
  const mode =
    data.mode === "custom" || customMin || customMax
      ? "custom"
      : data.mode === "predefined"
        ? "predefined"
        : predefinedRanges.length > 0
          ? "predefined"
          : customMin || customMax
            ? "custom"
            : "predefined";

  return {
    mode,
    predefinedRanges,
    customMin,
    customMax,
  };
}

function mergeIndustryKeywordsFilter(raw: unknown): IndustryKeywordsFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_INDUSTRY_KEYWORDS_FILTER };
  const data = raw as Record<string, unknown>;
  const advancedMode =
    data.advancedMode === "is_not_any_of" ||
    data.advancedMode === "is_known" ||
    data.advancedMode === "is_unknown"
      ? data.advancedMode
      : null;

  return {
    industries: asStringArray(data.industries),
    advancedMode,
    excludeIndustries: asStringArray(data.excludeIndustries),
    includeKeywordsEnabled: asBoolean(data.includeKeywordsEnabled, true),
    keywords: asStringArray(data.keywords),
    searchName: asBoolean(data.searchName, true),
    searchKeywords: asBoolean(data.searchKeywords, true),
    searchCompanyDescription: asBoolean(data.searchCompanyDescription, false),
    includeAllKeywords: asBoolean(data.includeAllKeywords, false),
    excludeKeywordsEnabled: asBoolean(data.excludeKeywordsEnabled, false),
    excludeKeywords: asStringArray(data.excludeKeywords),
  };
}

function mergeTechnologiesFilter(raw: unknown): TechnologiesFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TECHNOLOGIES_FILTER };
  const data = raw as Record<string, unknown>;
  return {
    include: asStringArray(data.include),
    includeAll: asStringArray(data.includeAll),
    exclude: asStringArray(data.exclude),
  };
}

function mergeRevenueFilter(raw: unknown): RevenueFilter {
  if (!raw || typeof raw !== "object") return { ...EMPTY_REVENUE_FILTER };
  const data = raw as Record<string, unknown>;
  const mode =
    data.mode === "is_known" || data.mode === "is_unknown" || data.mode === "is_between"
      ? data.mode
      : "is_between";
  return {
    mode,
    min: asString(data.min),
    max: asString(data.max),
  };
}

export function normalizeAiSearchPayload(raw: unknown): AiSearchFilters {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const view: DataView = data.view === "people" ? "people" : "companies";
  const filtersRaw =
    data.filters && typeof data.filters === "object"
      ? (data.filters as Record<string, unknown>)
      : {};

  return {
    view,
    search: asString(data.search),
    filters: {
      name: asStringArray(filtersRaw.name),
      emailStatus: asStringArray(filtersRaw.emailStatus),
    },
    jobTitleFilter: mergeJobTitleFilter(data.jobTitleFilter),
    peopleLookalikesFilter: mergePeopleLookalikesFilter(data.peopleLookalikesFilter),
    companyFilter: mergeCompanyFilter(data.companyFilter),
    locationFilter: mergeLocationFilter(data.locationFilter),
    employeesFilter: mergeEmployeesFilter(data.employeesFilter),
    industryKeywordsFilter: mergeIndustryKeywordsFilter(data.industryKeywordsFilter),
    technologiesFilter: mergeTechnologiesFilter(data.technologiesFilter),
    revenueFilter: mergeRevenueFilter(data.revenueFilter),
    explanation: asString(data.explanation) || "Applied filters from your query",
  };
}

export function parseAiSearchExpandOptions(raw: unknown): AiSearchExpandOptions {
  if (!raw || typeof raw !== "object") return {};
  const data = raw as Record<string, unknown>;
  return {
    technologies: asStringArray(data.technologies),
    industries: asStringArray(data.industries),
    locations: asStringArray(data.locations),
    jobTitles: asStringArray(data.jobTitles),
  };
}

export function aiSearchFiltersToPresetPayload(
  filters: AiSearchFilters,
  options?: { activeStat?: FilterPresetPayload["activeStat"] }
): FilterPresetPayload {
  return {
    search: filters.search ?? "",
    activeStat: options?.activeStat ?? "total",
    selectedFilters: filters.filters ?? {},
    jobTitleFilter: filters.jobTitleFilter,
    peopleLookalikesFilter: filters.peopleLookalikesFilter,
    companyFilter: filters.companyFilter,
    locationFilter: filters.locationFilter,
    employeesFilter: filters.employeesFilter,
    industryKeywordsFilter: filters.industryKeywordsFilter,
    technologiesFilter: filters.technologiesFilter,
    revenueFilter: filters.revenueFilter,
    columnFilters: EMPTY_COLUMN_FILTER_STATE,
  };
}

/**
 * Expand AI filter terms against live facet catalogs so a search like
 * "aws" becomes OR includes for Amazon AWS, AWS, AWS SDK for JavaScript, etc.
 */
export function expandAiSearchFilters(
  filters: AiSearchFilters,
  catalogs: AiSearchExpandOptions
): AiSearchFilters {
  const technologies = catalogs.technologies ?? [];
  const industries = catalogs.industries ?? [];
  const locations = catalogs.locations ?? [];
  const jobTitles = catalogs.jobTitles ?? [];

  let next: AiSearchFilters = {
    ...filters,
    jobTitleFilter: {
      ...filters.jobTitleFilter,
      include: filters.jobTitleFilter.exactMatch
        ? filters.jobTitleFilter.include
        : expandTermsAgainstOptions(filters.jobTitleFilter.include, jobTitles),
      exclude: filters.jobTitleFilter.exactMatch
        ? filters.jobTitleFilter.exclude
        : expandTermsAgainstOptions(filters.jobTitleFilter.exclude, jobTitles),
    },
    locationFilter: {
      ...filters.locationFilter,
      include: expandTermsAgainstOptions(
        filters.locationFilter.include,
        locations
      ),
      exclude: expandTermsAgainstOptions(
        filters.locationFilter.exclude,
        locations
      ),
    },
    industryKeywordsFilter: {
      ...filters.industryKeywordsFilter,
      industries: expandTermsAgainstOptions(
        filters.industryKeywordsFilter.industries,
        industries
      ),
      excludeIndustries: expandTermsAgainstOptions(
        filters.industryKeywordsFilter.excludeIndustries,
        industries
      ),
      keywords: expandTermsAgainstOptions(
        filters.industryKeywordsFilter.keywords,
        industries
      ),
    },
    technologiesFilter: {
      ...filters.technologiesFilter,
      include: expandTechnologyTermsAgainstOptions(
        filters.technologiesFilter.include,
        technologies
      ),
      includeAll: expandTechnologyTermsAgainstOptions(
        filters.technologiesFilter.includeAll,
        technologies
      ),
      exclude: expandTechnologyTermsAgainstOptions(
        filters.technologiesFilter.exclude,
        technologies
      ),
    },
  };

  // If the model put industry words (SaaS, fintech, …) into technologies,
  // move them to industry and clear the bad tech includes.
  next = relocateAmbiguousTechnologyTerms(next, industries);

  return next;
}

/**
 * Industry-like tokens wrongly placed in technologiesFilter are moved to
 * industryKeywordsFilter (when not already present) and stripped from tech.
 */
function relocateAmbiguousTechnologyTerms(
  filters: AiSearchFilters,
  industryCatalog: string[]
): AiSearchFilters {
  const buckets = [
    filters.technologiesFilter.include,
    filters.technologiesFilter.includeAll,
    filters.technologiesFilter.exclude,
  ] as const;

  const ambiguous: string[] = [];
  const scrub = (values: string[]) =>
    values.filter((value) => {
      const key = value.trim().toLowerCase();
      if (!TECHNOLOGY_AMBIGUOUS_TERMS.has(key)) return true;
      ambiguous.push(value.trim());
      return false;
    });

  const include = scrub(buckets[0]);
  const includeAll = scrub(buckets[1]);
  const exclude = scrub(buckets[2]);

  if (ambiguous.length === 0) return filters;

  const existingIndustries = new Set(
    filters.industryKeywordsFilter.industries.map((v) => v.toLowerCase())
  );
  const extras = expandTermsAgainstOptions(ambiguous, industryCatalog).filter(
    (industry) => !existingIndustries.has(industry.toLowerCase())
  );

  return {
    ...filters,
    technologiesFilter: { include, includeAll, exclude },
    industryKeywordsFilter: {
      ...filters.industryKeywordsFilter,
      industries: [...filters.industryKeywordsFilter.industries, ...extras],
    },
  };
}

export const AI_PENDING_FILTERS_KEY = "ai-search-pending-filters:v1";

export function buildAiSearchQueryParams(
  parsed: AiSearchFilters,
  options?: { page?: number; limit?: number }
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(options?.page ?? 1),
    limit: String(options?.limit ?? 50),
    view: parsed.view,
    stat: "total",
    filters: JSON.stringify(parsed.filters),
  });

  if (parsed.search) {
    params.set("search", parsed.search);
  }
  if (!isJobTitleFilterEmpty(parsed.jobTitleFilter)) {
    params.set("jobTitleFilter", JSON.stringify(parsed.jobTitleFilter));
  }
  if (!isPeopleLookalikesFilterEmpty(parsed.peopleLookalikesFilter)) {
    params.set("peopleLookalikesFilter", JSON.stringify(parsed.peopleLookalikesFilter));
  }
  if (!isCompanyFilterEmpty(parsed.companyFilter)) {
    params.set("companyFilter", JSON.stringify(parsed.companyFilter));
  }
  if (!isLocationFilterEmpty(parsed.locationFilter)) {
    params.set("locationFilter", JSON.stringify(parsed.locationFilter));
  }
  if (!isEmployeesFilterEmpty(parsed.employeesFilter)) {
    params.set("employeesFilter", JSON.stringify(parsed.employeesFilter));
  }
  if (!isIndustryKeywordsFilterEmpty(parsed.industryKeywordsFilter)) {
    params.set("industryKeywordsFilter", JSON.stringify(parsed.industryKeywordsFilter));
  }
  if (!isTechnologiesFilterEmpty(parsed.technologiesFilter)) {
    params.set("technologiesFilter", JSON.stringify(parsed.technologiesFilter));
  }
  if (!isRevenueFilterEmpty(parsed.revenueFilter)) {
    params.set("revenueFilter", JSON.stringify(parsed.revenueFilter));
  }

  return params;
}

export function aiSearchFilterChips(parsed: AiSearchFilters): string[] {
  return buildAiSearchRemovableChips(parsed).map((chip) => chip.label);
}

export type AiSearchFilterChipKind =
  | "view"
  | "search"
  | "name"
  | "emailStatus"
  | "jobTitle"
  | "peopleLookalikes"
  | "company"
  | "location"
  | "employees"
  | "industryKeywords"
  | "technologies"
  | "revenue";

export type AiSearchFilterChip = {
  id: string;
  label: string;
  removable: boolean;
  kind: AiSearchFilterChipKind;
  field?: string;
  value?: string;
};

export function buildAiSearchRemovableChips(
  parsed: AiSearchFilters
): AiSearchFilterChip[] {
  const chips: AiSearchFilterChip[] = [
    {
      id: "view",
      label: `View: ${parsed.view === "people" ? "People" : "Companies"}`,
      removable: false,
      kind: "view",
    },
  ];

  if (parsed.search) {
    chips.push({
      id: `search:${parsed.search}`,
      label: `Search: ${parsed.search}`,
      removable: true,
      kind: "search",
      value: parsed.search,
    });
  }

  for (const value of parsed.filters.name ?? []) {
    chips.push({
      id: `name:${value}`,
      label: `Name: ${value}`,
      removable: true,
      kind: "name",
      field: "name",
      value,
    });
  }

  for (const value of parsed.filters.emailStatus ?? []) {
    chips.push({
      id: `emailStatus:${value}`,
      label: `Email status: ${value}`,
      removable: true,
      kind: "emailStatus",
      field: "emailStatus",
      value,
    });
  }

  for (const tag of jobTitleActiveTags(parsed.jobTitleFilter)) {
    chips.push({
      id: `jobTitle:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "jobTitle",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of peopleLookalikesActiveTags(parsed.peopleLookalikesFilter)) {
    chips.push({
      id: `peopleLookalikes:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "peopleLookalikes",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of companyActiveTags(parsed.companyFilter)) {
    chips.push({
      id: `company:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "company",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of locationActiveTags(parsed.locationFilter)) {
    chips.push({
      id: `location:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "location",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of employeesActiveTags(parsed.employeesFilter)) {
    chips.push({
      id: `employees:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "employees",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of industryKeywordsActiveTags(parsed.industryKeywordsFilter)) {
    chips.push({
      id: `industryKeywords:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "industryKeywords",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of technologiesActiveTags(parsed.technologiesFilter)) {
    chips.push({
      id: `technologies:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "technologies",
      field: tag.field,
      value: tag.value,
    });
  }

  for (const tag of revenueActiveTags(parsed.revenueFilter)) {
    chips.push({
      id: `revenue:${tag.field}:${tag.value}`,
      label: tag.label,
      removable: true,
      kind: "revenue",
      field: tag.field,
      value: tag.value,
    });
  }

  return chips;
}

/** Remove one chip from AI filters; CSV / re-apply should use the returned filters. */
export function removeAiSearchFilterChip(
  filters: AiSearchFilters,
  chip: AiSearchFilterChip
): AiSearchFilters {
  if (!chip.removable) return filters;

  const next: AiSearchFilters = {
    ...filters,
    filters: { ...filters.filters },
    jobTitleFilter: { ...filters.jobTitleFilter },
    peopleLookalikesFilter: { ...filters.peopleLookalikesFilter },
    companyFilter: { ...filters.companyFilter },
    locationFilter: { ...filters.locationFilter },
    employeesFilter: { ...filters.employeesFilter },
    industryKeywordsFilter: { ...filters.industryKeywordsFilter },
    technologiesFilter: { ...filters.technologiesFilter },
    revenueFilter: { ...filters.revenueFilter },
  };

  switch (chip.kind) {
    case "search":
      next.search = "";
      break;
    case "name": {
      const values = (next.filters.name ?? []).filter((entry) => entry !== chip.value);
      if (values.length === 0) delete next.filters.name;
      else next.filters.name = values;
      break;
    }
    case "emailStatus": {
      const values = (next.filters.emailStatus ?? []).filter(
        (entry) => entry !== chip.value
      );
      if (values.length === 0) delete next.filters.emailStatus;
      else next.filters.emailStatus = values;
      break;
    }
    case "jobTitle": {
      const field = chip.field as keyof JobTitleFilter | undefined;
      if (
        field === "include" ||
        field === "exclude" ||
        field === "pastTitlesInclude" ||
        field === "pastTitlesExclude" ||
        field === "managementLevel" ||
        field === "departments"
      ) {
        next.jobTitleFilter = {
          ...next.jobTitleFilter,
          [field]: next.jobTitleFilter[field].filter((entry) => entry !== chip.value),
        };
      }
      break;
    }
    case "peopleLookalikes":
      if (chip.field === "query") {
        next.peopleLookalikesFilter = {
          ...next.peopleLookalikesFilter,
          query: "",
          lookalikeOf: undefined,
        };
      } else if (chip.field === "workUrls") {
        next.peopleLookalikesFilter = {
          ...next.peopleLookalikesFilter,
          workUrls: "",
        };
      }
      break;
    case "company": {
      const field = chip.field;
      const company = next.companyFilter;
      if (field === "include") {
        next.companyFilter = {
          ...company,
          include: company.include.filter((entry) => entry.name !== chip.value),
        };
      } else if (field === "mode") {
        next.companyFilter = { ...company, mode: "is_any_of" };
      } else if (field === "isNotAnyOf") {
        next.companyFilter = { ...company, isNotAnyOf: false };
      } else if (field === "domainExists") {
        next.companyFilter = { ...company, domainExists: false };
      } else if (field === "includePastCompany") {
        next.companyFilter = { ...company, includePastCompany: false };
      } else if (field === "excludePastCompany") {
        next.companyFilter = { ...company, excludePastCompany: false };
      } else if (field === "includeList") {
        next.companyFilter = { ...company, includeList: "" };
      } else if (field === "excludeList") {
        next.companyFilter = { ...company, excludeList: "" };
      }
      break;
    }
    case "location": {
      const field = chip.field;
      if (field === "include" || field === "exclude") {
        next.locationFilter = {
          ...next.locationFilter,
          [field]: next.locationFilter[field].filter((entry) => entry !== chip.value),
        };
      }
      break;
    }
    case "employees": {
      const field = chip.field;
      if (field === "predefined") {
        next.employeesFilter = {
          ...next.employeesFilter,
          predefinedRanges: next.employeesFilter.predefinedRanges.filter(
            (entry) => entry !== chip.value
          ),
        };
      } else if (field === "customMin") {
        next.employeesFilter = { ...next.employeesFilter, customMin: "" };
      } else if (field === "customMax") {
        next.employeesFilter = { ...next.employeesFilter, customMax: "" };
      }
      break;
    }
    case "industryKeywords": {
      const field = chip.field;
      const industry = next.industryKeywordsFilter;
      if (field === "industries") {
        next.industryKeywordsFilter = {
          ...industry,
          industries: industry.industries.filter((entry) => entry !== chip.value),
        };
      } else if (field === "excludeIndustries") {
        next.industryKeywordsFilter = {
          ...industry,
          excludeIndustries: industry.excludeIndustries.filter(
            (entry) => entry !== chip.value
          ),
        };
      } else if (field === "advancedMode") {
        next.industryKeywordsFilter = { ...industry, advancedMode: null };
      } else if (field === "keywords") {
        next.industryKeywordsFilter = {
          ...industry,
          keywords: industry.keywords.filter((entry) => entry !== chip.value),
        };
      } else if (field === "excludeKeywords") {
        next.industryKeywordsFilter = {
          ...industry,
          excludeKeywords: industry.excludeKeywords.filter(
            (entry) => entry !== chip.value
          ),
        };
      } else if (field === "includeAllKeywords") {
        next.industryKeywordsFilter = { ...industry, includeAllKeywords: false };
      }
      break;
    }
    case "technologies": {
      const field = chip.field;
      if (field === "include" || field === "includeAll" || field === "exclude") {
        next.technologiesFilter = {
          ...next.technologiesFilter,
          [field]: next.technologiesFilter[field].filter(
            (entry) => entry !== chip.value
          ),
        };
      }
      break;
    }
    case "revenue": {
      const field = chip.field;
      if (field === "mode") {
        next.revenueFilter = { ...next.revenueFilter, mode: "is_between" };
      } else if (field === "min") {
        next.revenueFilter = { ...next.revenueFilter, min: "" };
      } else if (field === "max") {
        next.revenueFilter = { ...next.revenueFilter, max: "" };
      }
      break;
    }
    default:
      break;
  }

  return next;
}

export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI did not return valid filter JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export const AI_FILTERS_READY_SCHEMA = `{
  "status": "ready",
  "message": string,
  "view": "people" | "companies",
  "search": string,
  "filters": { "name": string[], "emailStatus": string[] },
  "jobTitleFilter": {
    "include": string[], "includeSimilar": boolean, "exactMatch": boolean, "exclude": string[],
    "pastTitlesInclude": string[], "pastTitlesExclude": string[],
    "managementLevel": string[], "departments": string[]
  },
  "peopleLookalikesFilter": { "query": string, "workUrls": string },
  "companyFilter": {
    "mode": "is_any_of" | "is_known" | "is_unknown",
    "include": [{ "name": string, "domain"?: string }],
    "isNotAnyOf": boolean, "includePastCompany": boolean, "excludePastCompany": boolean,
    "domainExists": boolean, "includeList": string, "excludeList": string,
    "includeListNamesOnly": boolean, "excludeListNamesOnly": boolean
  },
  "locationFilter": {
    "tabs": ("contact" | "account_hq")[],
    "tab": "contact" | "account_hq",
    "mode": "select_region",
    "include": string[], "exclude": string[]
  },
  "employeesFilter": {
    "mode": "predefined" | "custom",
    "predefinedRanges": string[],
    "customMin": string, "customMax": string
  },
  "industryKeywordsFilter": {
    "industries": string[],
    "advancedMode": "is_not_any_of" | "is_known" | "is_unknown" | null,
    "excludeIndustries": string[],
    "includeKeywordsEnabled": boolean, "keywords": string[],
    "searchName": boolean, "searchKeywords": boolean, "searchCompanyDescription": boolean,
    "includeAllKeywords": boolean, "excludeKeywordsEnabled": boolean, "excludeKeywords": string[]
  },
  "technologiesFilter": { "include": string[], "includeAll": string[], "exclude": string[] },
  "revenueFilter": { "mode": "is_between" | "is_known" | "is_unknown", "min": string, "max": string },
  "explanation": string
}`;

export const AI_FILTERS_READY_RULES = `- Prefer "companies" when the query is about companies/orgs; "people" for contacts/roles/titles.
- For employee count like "more than 2000", use employeesFilter mode "custom" with customMin "2000" and customMax "".
- predefinedRanges may use: "1-10","11-20","21-50","51-100","101-200","201-500","501-1000","1001-2000","2001-5000","5001-10000","10001+".
- For USA/US/United States, put "United States" and "USA" in locationFilter.include. Use tabs ["account_hq"] for company HQ, ["contact"] for people location, or both ["contact","account_hq"] when either should match. Also set tab to the first tabs value for compatibility.
- Map finance/banking/fintech/SaaS/software to industryKeywordsFilter.industries (e.g. "SaaS", "Finance", "Financial Services"). NEVER put industry words like SaaS, cloud, software, fintech into technologiesFilter.
- Technology/product names (AWS, Salesforce, React, Docker, HubSpot, etc.) MUST go in technologiesFilter.include (OR) ONLY when the user explicitly asks for companies/people that use that product/stack.
- If the user says "SaaS companies" or "tech companies", that is an industry filter — leave technologiesFilter.include empty.
- Do not invent technology filters from industry keywords or generic words in the query.
- managementLevel values: Owner, Founder, C suite, Partner, Vp, Head, Director, Manager, Senior, Lead, Entry, Intern.
- companyFilter.include is ONLY for specific named companies (e.g. "at Google", "Aramco employees"). Generic phrases like "construction companies" or "banks" are industries — never company names.
- Keep companyFilter.mode "is_any_of" and revenueFilter.mode "is_between" (with empty min/max) unless the user explicitly asks for companies/revenue that are known or unknown.
- Leave unused filters empty (empty arrays / empty strings / null advancedMode).
- "message" and "explanation" should briefly confirm what you will search.`;
