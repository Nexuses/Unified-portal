import {
  buildJobTitleFilterQuery,
  type JobTitleFilterPayload,
} from "@/lib/people/job-title-filter-query";
import { buildPeopleLookalikesFilterQuery } from "@/lib/people/people-lookalikes-filter-query";
import { buildCompanyFilterQuery } from "@/lib/people/company-filter-query";
import type {
  CompanyFilter,
  EmployeesFilter,
  IndustryKeywordsFilter,
  LocationFilter,
  PeopleLookalikesFilter,
  RevenueFilter,
  TechnologiesFilter,
} from "@/lib/people/data-browser/types";
import {
  isCompanyFilterActive,
  isEmployeesFilterEmpty,
  isIndustryKeywordsFilterEmpty,
  isLocationFilterEmpty,
  isRevenueFilterEmpty,
  isTechnologiesFilterEmpty,
} from "@/lib/people/data-browser/types";
import { buildLocationFilterQuery } from "@/lib/people/location-filter-query";
import { buildEmailStatusFilterQuery } from "@/lib/people/email-status-filter-query";
import { buildPhoneFilterQuery } from "@/lib/people/phone-filter-query";
import { buildEmployeesFilterQuery } from "@/lib/people/employees-filter-query";
import { buildIndustryKeywordsFilterQuery } from "@/lib/people/industry-keywords-filter-query";
import { buildTechnologiesFilterQuery } from "@/lib/people/technologies-filter-query";
import { buildRevenueFilterQuery } from "@/lib/people/revenue-filter-query";
import {
  buildColumnFiltersQuery,
  parseColumnFilterState,
} from "@/lib/people/column-filters";
import { getDistinctValues } from "@/lib/people/distinct-values-cache";
import { getRuntimeAliasBundles } from "@/lib/people/search-aliases";
import type { AliasOverrides } from "@/lib/people/field-synonyms";
import {
  VIEW_SEARCH_FIELDS,
  recordTypeFilter,
  type DataView,
} from "@/lib/people/data-views";

export type StatTab = "total" | "net_new" | "saved";

type ViewFilters = Partial<
  Record<
    | "name"
    | "company"
    | "location"
    | "jobTitles"
    | "employees"
    | "industryKeywords"
    | "emailStatus"
    | "personalPhone"
    | "companyPhone"
    | "technologies"
    | "revenue",
    string[]
  >
>;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJobTitleFilter(raw: string | null): JobTitleFilterPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const asStringArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];
    const legacyPastTitles = asStringArray(parsed.pastTitles);
    return {
      include: asStringArray(parsed.include),
      // Default ON (Apollo-style similar titles) unless explicitly disabled
      includeSimilar: parsed.includeSimilar !== false,
      exactMatch: parsed.exactMatch === true,
      exclude: asStringArray(parsed.exclude),
      pastTitlesInclude:
        asStringArray(parsed.pastTitlesInclude).length > 0
          ? asStringArray(parsed.pastTitlesInclude)
          : legacyPastTitles,
      pastTitlesExclude: asStringArray(parsed.pastTitlesExclude),
      managementLevel: asStringArray(parsed.managementLevel),
      departments: asStringArray(parsed.departments),
    };
  } catch {
    return null;
  }
}

function parsePeopleLookalikesFilter(raw: string | null): PeopleLookalikesFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const lookalikeRaw = parsed.lookalikeOf;
    const lookalikeOf =
      lookalikeRaw && typeof lookalikeRaw === "object"
        ? {
            firstName:
              typeof (lookalikeRaw as Record<string, unknown>).firstName === "string"
                ? (lookalikeRaw as Record<string, string>).firstName
                : "",
            lastName:
              typeof (lookalikeRaw as Record<string, unknown>).lastName === "string"
                ? (lookalikeRaw as Record<string, string>).lastName
                : "",
            company:
              typeof (lookalikeRaw as Record<string, unknown>).company === "string"
                ? (lookalikeRaw as Record<string, string>).company
                : "",
            title:
              typeof (lookalikeRaw as Record<string, unknown>).title === "string"
                ? (lookalikeRaw as Record<string, string>).title
                : "",
            industry:
              typeof (lookalikeRaw as Record<string, unknown>).industry === "string"
                ? (lookalikeRaw as Record<string, string>).industry
                : undefined,
            linkedInUrl:
              typeof (lookalikeRaw as Record<string, unknown>).linkedInUrl === "string"
                ? (lookalikeRaw as Record<string, string>).linkedInUrl
                : undefined,
          }
        : undefined;

    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      workUrls: typeof parsed.workUrls === "string" ? parsed.workUrls : "",
      lookalikeOf,
    };
  } catch {
    return null;
  }
}

function parseCompanyInclude(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string" && entry.trim()) {
        return { name: entry.trim() };
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        if (!name) return null;
        const domain = typeof record.domain === "string" ? record.domain.trim() : undefined;
        return { name, domain: domain || undefined };
      }
      return null;
    })
    .filter((entry): entry is { name: string; domain?: string } => Boolean(entry));
}

function parseCompanyFilter(raw: string | null): CompanyFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const modeRaw = parsed.mode;
    const mode =
      modeRaw === "is_known" || modeRaw === "is_unknown" ? modeRaw : "is_any_of";

    return {
      mode,
      include: parseCompanyInclude(parsed.include),
      isNotAnyOf: parsed.isNotAnyOf === true,
      includePastCompany: parsed.includePastCompany === true,
      excludePastCompany: parsed.excludePastCompany === true,
      domainExists: parsed.domainExists === true,
      includeList: typeof parsed.includeList === "string" ? parsed.includeList : "",
      excludeList: typeof parsed.excludeList === "string" ? parsed.excludeList : "",
      includeListNamesOnly: parsed.includeListNamesOnly === true,
      excludeListNamesOnly: parsed.excludeListNamesOnly === true,
    };
  } catch {
    return null;
  }
}

function parseLocationFilter(raw: string | null): LocationFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const asStringArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];
    const tab = parsed.tab === "account_hq" ? "account_hq" : "contact";

    return {
      tab,
      mode: "select_region",
      include: asStringArray(parsed.include),
      exclude: asStringArray(parsed.exclude),
    };
  } catch {
    return null;
  }
}

function parseEmployeesFilter(raw: string | null): EmployeesFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const asStringArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];

    return {
      mode: parsed.mode === "custom" ? "custom" : "predefined",
      predefinedRanges: asStringArray(parsed.predefinedRanges),
      customMin: typeof parsed.customMin === "string" ? parsed.customMin : "",
      customMax: typeof parsed.customMax === "string" ? parsed.customMax : "",
    };
  } catch {
    return null;
  }
}

function parseIndustryKeywordsFilter(raw: string | null): IndustryKeywordsFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const asStringArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];
    const advancedMode =
      parsed.advancedMode === "is_not_any_of" ||
      parsed.advancedMode === "is_known" ||
      parsed.advancedMode === "is_unknown"
        ? parsed.advancedMode
        : null;

    return {
      industries: asStringArray(parsed.industries),
      advancedMode,
      excludeIndustries: asStringArray(parsed.excludeIndustries),
      includeKeywordsEnabled:
        typeof parsed.includeKeywordsEnabled === "boolean"
          ? parsed.includeKeywordsEnabled
          : true,
      keywords: asStringArray(parsed.keywords),
      searchName: parsed.searchName !== false,
      searchKeywords: parsed.searchKeywords !== false,
      searchCompanyDescription: parsed.searchCompanyDescription === true,
      includeAllKeywords: parsed.includeAllKeywords === true,
      excludeKeywordsEnabled: parsed.excludeKeywordsEnabled === true,
      excludeKeywords: asStringArray(parsed.excludeKeywords),
    };
  } catch {
    return null;
  }
}

function parseTechnologiesFilter(raw: string | null): TechnologiesFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const asStringArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];

    return {
      include: asStringArray(parsed.include),
      includeAll: asStringArray(parsed.includeAll),
      exclude: asStringArray(parsed.exclude),
    };
  } catch {
    return null;
  }
}

function parseRevenueFilter(raw: string | null): RevenueFilter | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mode =
      parsed.mode === "is_known" || parsed.mode === "is_unknown" || parsed.mode === "is_between"
        ? parsed.mode
        : "is_between";

    return {
      mode,
      min: typeof parsed.min === "string" ? parsed.min : "",
      max: typeof parsed.max === "string" ? parsed.max : "",
    };
  } catch {
    return null;
  }
}

function isPeopleLookalikesFilterActive(filter: PeopleLookalikesFilter) {
  return Boolean(
    filter.lookalikeOf ||
      filter.query.trim() ||
      filter.workUrls.trim()
  );
}

function parseFilters(raw: string | null): ViewFilters {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed as Record<string, unknown>).map(
      ([key, value]) => [key, Array.isArray(value) ? value.filter((v) => typeof v === "string") : []] as const
    );
    return Object.fromEntries(entries) as ViewFilters;
  } catch {
    return {};
  }
}

function viewFilterQuery(view: DataView, filters: ViewFilters) {
  const andFilters: Record<string, unknown>[] = [];

  if (view === "people") {
    const emailStatusValues = filters.emailStatus ?? [];
    if (emailStatusValues.length > 0) {
      const emailStatusQuery = buildEmailStatusFilterQuery(emailStatusValues);
      if (Object.keys(emailStatusQuery).length > 0) {
        andFilters.push(emailStatusQuery);
      }
    }

    const personalPhoneQuery = buildPhoneFilterQuery(
      "personal_phone",
      filters.personalPhone
    );
    if (Object.keys(personalPhoneQuery).length > 0) {
      andFilters.push(personalPhoneQuery);
    }

    const nameQuery = (filters.name ?? [])[0]?.trim();
    if (nameQuery) {
      const tokens = nameQuery.split(/\s+/).filter(Boolean);
      const regex = { $regex: escapeRegex(nameQuery), $options: "i" };
      if (tokens.length >= 2) {
        andFilters.push({
          $or: [
            {
              $and: [
                { first_name: { $regex: escapeRegex(tokens[0]), $options: "i" } },
                {
                  last_name: {
                    $regex: escapeRegex(tokens.slice(1).join(" ")),
                    $options: "i",
                  },
                },
              ],
            },
            { first_name: regex },
            { last_name: regex },
          ],
        });
      } else {
        andFilters.push({
          $or: [{ first_name: regex }, { last_name: regex }],
        });
      }
    }
  }

  const companyPhoneQuery = buildPhoneFilterQuery(
    "company_phone",
    filters.companyPhone
  );
  if (Object.keys(companyPhoneQuery).length > 0) {
    andFilters.push(companyPhoneQuery);
  }

  if (view === "companies") {
    const nameQuery = (filters.name ?? [])[0]?.trim();
    if (nameQuery) {
      const regex = { $regex: escapeRegex(nameQuery), $options: "i" };
      andFilters.push({
        $or: [{ company_name: regex }, { website: regex }, { industry: regex }],
      });
    }
  }

  if (andFilters.length === 0) return {};
  return { $and: andFilters };
}

/** Parse the filter query-string contract shared by `/api/data` and the AI search agent. */
export function parseDataRecordsQuery(searchParams: URLSearchParams) {
  const viewParam = searchParams.get("view");
  const view: DataView = viewParam === "companies" ? "companies" : "people";
  return {
    view,
    search: (searchParams.get("search") || "").trim(),
    stat: (searchParams.get("stat") || "total") as StatTab,
    filters: parseFilters(searchParams.get("filters")),
    jobTitleFilter:
      view === "people" ? parseJobTitleFilter(searchParams.get("jobTitleFilter")) : null,
    peopleLookalikesFilter:
      view === "people"
        ? parsePeopleLookalikesFilter(searchParams.get("peopleLookalikesFilter"))
        : null,
    companyFilter: parseCompanyFilter(searchParams.get("companyFilter")),
    locationFilter: parseLocationFilter(searchParams.get("locationFilter")),
    employeesFilter: parseEmployeesFilter(searchParams.get("employeesFilter")),
    industryKeywordsFilter: parseIndustryKeywordsFilter(
      searchParams.get("industryKeywordsFilter")
    ),
    technologiesFilter: parseTechnologiesFilter(searchParams.get("technologiesFilter")),
    revenueFilter: parseRevenueFilter(searchParams.get("revenueFilter")),
    columnFilters: parseColumnFilterState(searchParams.get("columnFilters")),
    listId: (searchParams.get("listId") || "").trim(),
  };
}

export type DataRecordsQuery = ReturnType<typeof parseDataRecordsQuery>;

/**
 * Build the Mongo filters for a parsed data query. Callers must `connectDB()` first
 * and resolve any saved-list scope themselves.
 */
export async function buildDataRecordsFilter(
  query: DataRecordsQuery,
  options: {
    resolvedView: DataView;
    listScopeFilter?: Record<string, unknown>;
  }
) {
  const { resolvedView, listScopeFilter = {} } = options;
  const {
    search,
    stat,
    filters,
    jobTitleFilter,
    peopleLookalikesFilter,
    companyFilter,
    locationFilter,
    employeesFilter,
    industryKeywordsFilter,
    technologiesFilter,
    revenueFilter,
    columnFilters,
  } = query;

  const needsRevenueCorpus = Boolean(
    revenueFilter &&
      !isRevenueFilterEmpty(revenueFilter) &&
      revenueFilter.mode === "is_between"
  );
  // Title/industry/department Mongo matching uses alias dictionaries + static
  // department groups only — never scan the full distinct corpus into `$or`.
  const needsDistinctCorpus = needsRevenueCorpus;

  const aliasBundlesPromise = getRuntimeAliasBundles();
  const distinctPromise = needsDistinctCorpus
    ? getDistinctValues(resolvedView, { revenueOnly: true })
    : Promise.resolve({
        titles: [] as string[],
        departments: [] as string[],
        industries: [] as string[],
        revenueValues: [] as string[],
      });

  const [distinctValues, aliasBundles] = await Promise.all([
    distinctPromise,
    aliasBundlesPromise,
  ]);

  const {
    titles: distinctTitles,
    departments: distinctDepartments,
    industries: distinctIndustries,
    revenueValues: distinctRevenueValues,
  } = distinctValues;

  const aliasOverrides: AliasOverrides = {
    jobTitle: aliasBundles.jobTitle,
    department: aliasBundles.department,
    industry: aliasBundles.industry,
  };

  const synonymContext = {
    titles: distinctTitles,
    departments: distinctDepartments,
    industries: distinctIndustries,
    aliasOverrides,
  };

  const typeFilter = recordTypeFilter(resolvedView);
  const textFilter =
    search.length > 0
      ? {
          $or: VIEW_SEARCH_FIELDS[resolvedView].map((field) => ({
            [field]: { $regex: escapeRegex(search), $options: "i" },
          })),
        }
      : {};
  const viewFilters = viewFilterQuery(resolvedView, filters);
  const jobTitleFilters =
    resolvedView === "people" && jobTitleFilter
      ? buildJobTitleFilterQuery(jobTitleFilter, synonymContext)
      : {};
  const peopleLookalikesFilters =
    resolvedView === "people" &&
    peopleLookalikesFilter &&
    isPeopleLookalikesFilterActive(peopleLookalikesFilter)
      ? buildPeopleLookalikesFilterQuery(peopleLookalikesFilter)
      : {};
  const companyFilters =
    companyFilter && isCompanyFilterActive(companyFilter)
      ? buildCompanyFilterQuery(companyFilter)
      : {};
  const locationFilters =
    locationFilter && !isLocationFilterEmpty(locationFilter)
      ? buildLocationFilterQuery(locationFilter)
      : {};
  const employeesFilters =
    employeesFilter && !isEmployeesFilterEmpty(employeesFilter)
      ? buildEmployeesFilterQuery(employeesFilter)
      : {};
  const industryKeywordsFilters =
    industryKeywordsFilter && !isIndustryKeywordsFilterEmpty(industryKeywordsFilter)
      ? buildIndustryKeywordsFilterQuery(industryKeywordsFilter, synonymContext)
      : {};
  const technologiesFilters =
    technologiesFilter && !isTechnologiesFilterEmpty(technologiesFilter)
      ? buildTechnologiesFilterQuery(technologiesFilter)
      : {};
  const revenueFilters =
    revenueFilter && !isRevenueFilterEmpty(revenueFilter)
      ? buildRevenueFilterQuery(revenueFilter, distinctRevenueValues)
      : {};
  const columnFilterQuery = buildColumnFiltersQuery(columnFilters);
  const baseFilter = {
    $and: [
      listScopeFilter,
      typeFilter,
      textFilter,
      viewFilters,
      jobTitleFilters,
      peopleLookalikesFilters,
      companyFilters,
      locationFilters,
      employeesFilters,
      industryKeywordsFilters,
      technologiesFilters,
      revenueFilters,
      columnFilterQuery,
    ].filter((entry) => Object.keys(entry).length > 0),
  };
  const statFilter =
    stat === "net_new" ? { isUsed: { $ne: true } } : stat === "saved" ? { isUsed: true } : {};
  const recordsFilter = {
    $and: [baseFilter, statFilter].filter((entry) => Object.keys(entry).length > 0),
  };

  return {
    baseFilter,
    recordsFilter,
    distinctTitles,
    distinctDepartments,
    distinctIndustries,
    aliasOverrides,
  };
}
