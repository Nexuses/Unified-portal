import {
  aiSearchFilterChips,
  buildAiSearchQueryParams,
  expandAiSearchFilters,
  normalizeAiSearchPayload,
  type AiSearchExpandOptions,
  type AiSearchFilters,
} from "@/lib/people/ai-search";
import {
  getTechnologySuggestions,
  mergeTechnologyOptions,
} from "@/app/components/portal/crm/people/technology-options";
import {
  EMPTY_JOB_TITLE_FILTER,
  EMPTY_PEOPLE_LOOKALIKES_FILTER,
} from "@/lib/people/data-browser/types";
import {
  buildDataRecordsFilter,
  parseDataRecordsQuery,
} from "@/lib/people/data-records-query";
import type { DataView } from "@/lib/people/data-views";
import { getFilterSidebarMeta } from "@/lib/people/filter-sidebar-cache";
import { connectDB } from "@/lib/people/mongodb";
import { buildTechnologyFacets } from "@/lib/people/technologies";
import { DataRecord } from "@/lib/people/models/DataRecord";

export const AGENT_MANAGEMENT_LEVELS = [
  "Owner",
  "Founder",
  "C suite",
  "Partner",
  "Vp",
  "Head",
  "Director",
  "Manager",
  "Senior",
  "Lead",
  "Entry",
  "Intern",
] as const;

export const AGENT_EMPLOYEE_RANGES = [
  "1-10",
  "11-20",
  "21-50",
  "51-100",
  "101-200",
  "201-500",
  "501-1000",
  "1001-2000",
  "2001-5000",
  "5001-10000",
  "10001+",
] as const;

export const AGENT_LOOKUP_FIELDS = [
  "jobTitles",
  "industries",
  "technologies",
  "locations",
] as const;

export type AgentSearchInput = {
  view: DataView;
  summary: string;
  keywordSearch?: string;
  personName?: string;
  jobTitles?: string[];
  excludeJobTitles?: string[];
  managementLevels?: string[];
  departments?: string[];
  locations?: string[];
  excludeLocations?: string[];
  locationScope?: "contact" | "account_hq";
  industries?: string[];
  excludeIndustries?: string[];
  keywords?: string[];
  technologies?: string[];
  excludeTechnologies?: string[];
  companyNames?: string[];
  excludeCompanyNames?: boolean;
  employeeRanges?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  minRevenue?: string;
  maxRevenue?: string;
  verifiedEmailsOnly?: boolean;
};

export type AgentSampleRecord = Record<string, string>;

export type AgentSearchResult = {
  view: DataView;
  total: number;
  summary: string;
  chips: string[];
  filters: AiSearchFilters;
  sample: AgentSampleRecord[];
};

const PEOPLE_SAMPLE_FIELDS = ["title", "company_name", "industry", "contact_country"];
const COMPANY_SAMPLE_FIELDS = ["company_name", "industry", "employees", "company_country"];
const SAMPLE_SIZE = 5;
const QUERY_TIMEOUT_MS = 20_000;

function facetValues(
  facets: Record<string, Array<{ _id: string }>>,
  key: string
): string[] {
  return (facets[key] ?? [])
    .map((row) => row._id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export async function loadAgentCatalogs(
  view: DataView
): Promise<Required<AiSearchExpandOptions>> {
  await connectDB();
  const { facets } = await getFilterSidebarMeta(view);
  const contactLocations = facets.contactLocations
    ? facetValues(facets, "contactLocations")
    : facetValues(facets, "location");
  return {
    technologies: mergeTechnologyOptions(
      getTechnologySuggestions(),
      buildTechnologyFacets(facets.technologies ?? []).options
    ),
    industries: facetValues(facets, "industryKeywords"),
    locations: Array.from(
      new Set([...contactLocations, ...facetValues(facets, "accountHqLocations")])
    ),
    jobTitles: facetValues(facets, "jobTitles"),
  };
}

export function agentInputToFilters(input: AgentSearchInput): AiSearchFilters {
  const view = input.view;
  const hasCustomEmployees =
    input.minEmployees !== undefined || input.maxEmployees !== undefined;

  const filters = normalizeAiSearchPayload({
    view,
    search: input.keywordSearch ?? "",
    filters: {
      name: input.personName ? [input.personName] : [],
      emailStatus: input.verifiedEmailsOnly ? ["verified"] : [],
    },
    jobTitleFilter: {
      include: input.jobTitles ?? [],
      exclude: input.excludeJobTitles ?? [],
      includeSimilar: true,
      exactMatch: false,
      managementLevel: input.managementLevels ?? [],
      departments: input.departments ?? [],
    },
    companyFilter: {
      mode: "is_any_of",
      include: (input.companyNames ?? []).map((name) => ({ name })),
      isNotAnyOf: input.excludeCompanyNames === true,
    },
    locationFilter: {
      tab: input.locationScope ?? (view === "companies" ? "account_hq" : "contact"),
      include: input.locations ?? [],
      exclude: input.excludeLocations ?? [],
    },
    employeesFilter: hasCustomEmployees
      ? {
          mode: "custom",
          customMin: input.minEmployees !== undefined ? String(input.minEmployees) : "",
          customMax: input.maxEmployees !== undefined ? String(input.maxEmployees) : "",
        }
      : { mode: "predefined", predefinedRanges: input.employeeRanges ?? [] },
    industryKeywordsFilter: {
      industries: input.industries ?? [],
      excludeIndustries: input.excludeIndustries ?? [],
      keywords: input.keywords ?? [],
      includeKeywordsEnabled: true,
    },
    technologiesFilter: {
      include: input.technologies ?? [],
      exclude: input.excludeTechnologies ?? [],
    },
    revenueFilter: {
      mode: "is_between",
      min: input.minRevenue ?? "",
      max: input.maxRevenue ?? "",
    },
    explanation: input.summary,
  });

  if (view === "companies") {
    filters.filters = {};
    filters.jobTitleFilter = { ...EMPTY_JOB_TITLE_FILTER };
    filters.peopleLookalikesFilter = { ...EMPTY_PEOPLE_LOOKALIKES_FILTER };
  }

  return filters;
}

export async function searchRecordsForAgent(
  input: AgentSearchInput
): Promise<AgentSearchResult> {
  const catalogs = await loadAgentCatalogs(input.view);
  const filters = expandAiSearchFilters(agentInputToFilters(input), catalogs);
  const query = parseDataRecordsQuery(buildAiSearchQueryParams(filters));
  const { recordsFilter } = await buildDataRecordsFilter(query, {
    resolvedView: query.view,
  });

  const sampleFields =
    query.view === "companies" ? COMPANY_SAMPLE_FIELDS : PEOPLE_SAMPLE_FIELDS;
  const [total, sampleDocs] = await Promise.all([
    DataRecord.countDocuments(recordsFilter).maxTimeMS(QUERY_TIMEOUT_MS),
    DataRecord.find(recordsFilter)
      .select(sampleFields.join(" "))
      .sort({ createdAt: -1 })
      .limit(SAMPLE_SIZE)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean<Array<Record<string, unknown>>>(),
  ]);

  return {
    view: query.view,
    total,
    summary: filters.explanation,
    chips: aiSearchFilterChips(filters),
    filters,
    sample: sampleDocs.map((doc) =>
      Object.fromEntries(
        sampleFields.map((field) => [field, String(doc[field] ?? "").trim()])
      )
    ),
  };
}

export async function lookupFilterValuesForAgent(args: {
  view: DataView;
  field: (typeof AGENT_LOOKUP_FIELDS)[number];
  query: string;
  limit?: number;
}): Promise<string[]> {
  const catalogs = await loadAgentCatalogs(args.view);
  const needle = args.query.trim().toLowerCase();
  const values = catalogs[args.field];
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  if (!needle) return values.slice(0, limit);

  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const value of values) {
    const lower = value.toLowerCase();
    if (lower.startsWith(needle)) startsWith.push(value);
    else if (lower.includes(needle)) contains.push(value);
    if (startsWith.length >= limit) break;
  }
  return [...startsWith, ...contains].slice(0, limit);
}
