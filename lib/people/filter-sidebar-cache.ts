import { recordTypeFilter, type DataView } from "@/lib/people/data-views";
import {
  FACET_VALUE_LIMIT,
  cappedFieldValues,
  toFacetRows,
} from "@/lib/people/capped-distinct";
import { splitTechnologies } from "@/lib/people/technologies";
import { DataRecord } from "@/lib/people/models/DataRecord";

/** Served without recomputing for this long. */
const FRESH_MS = 30 * 60 * 1000;
/** Past fresh, still served instantly while a background refresh runs. */
const STALE_MS = 24 * 60 * 60 * 1000;

export type FacetRow = { _id: string; count?: number };

export interface FilterSidebarMeta {
  facets: Record<string, FacetRow[]>;
  managementLevelCounts: Record<string, number>;
  employeeRangeCounts: Record<string, number>;
  peopleSuggestions: Array<{
    id: string;
    firstName: string;
    lastName: string;
    name: string;
    title: string;
    company: string;
    linkedInUrl: string;
    industry: string;
  }>;
}

interface CacheEntry {
  value: FilterSidebarMeta;
  computedAt: number;
}

interface SidebarCacheStore {
  entries: Map<DataView, CacheEntry>;
  inFlight: Map<DataView, Promise<FilterSidebarMeta>>;
  /** Bumped on invalidation so refreshes started earlier can't overwrite newer data. */
  generation: number;
}

declare global {
  var filterSidebarCache: SidebarCacheStore | undefined;
}

// Lives on globalThis so dev hot reloads don't throw away ~3s of facet scans.
const store: SidebarCacheStore = (globalThis.filterSidebarCache ??= {
  entries: new Map(),
  inFlight: new Map(),
  generation: 0,
});

function mergeFilters(
  base: Record<string, unknown>,
  extra: Record<string, unknown>
): Record<string, unknown> {
  if (Object.keys(base).length === 0) return extra;
  if (Object.keys(extra).length === 0) return base;
  return { $and: [base, extra] };
}

async function loadFacetField(
  field: string,
  scopeFilter: Record<string, unknown>
): Promise<FacetRow[]> {
  try {
    const values = await cappedFieldValues(field, scopeFilter, FACET_VALUE_LIMIT);
    if (field !== "technologies") {
      return toFacetRows(values);
    }

    // Technologies are stored as long comma-joined strings; tokenize so the
    // sidebar gets real tech names instead of giant row blobs.
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const value of values) {
      for (const token of splitTechnologies(value)) {
        const key = token.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tokens.push(token);
        if (tokens.length >= FACET_VALUE_LIMIT) {
          return toFacetRows(tokens);
        }
      }
    }
    return toFacetRows(tokens);
  } catch (error) {
    console.error(`[filter-sidebar-cache] facet failed for ${field}`, error);
    return [];
  }
}

async function loadFacets(
  scopeFilter: Record<string, unknown>,
  view: DataView
): Promise<Record<string, FacetRow[]>> {
  if (view === "people") {
    const [
      contactLocations,
      accountHqLocations,
      jobTitles,
      departments,
      company,
      employees,
      industryKeywords,
      emailStatus,
      technologies,
      revenue,
    ] = await Promise.all([
      loadFacetField("contact_country", scopeFilter),
      loadFacetField("company_country", scopeFilter),
      loadFacetField("title", scopeFilter),
      loadFacetField("departments", scopeFilter),
      loadFacetField("company_name", scopeFilter),
      loadFacetField("employees", scopeFilter),
      loadFacetField("industry", scopeFilter),
      DataRecord.aggregate<FacetRow>([
        { $match: scopeFilter },
        { $group: { _id: "$email_status", count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ""] } } },
        { $limit: FACET_VALUE_LIMIT },
      ]).catch((error) => {
        console.error("[filter-sidebar-cache] email_status facet failed", error);
        return [] as FacetRow[];
      }),
      loadFacetField("technologies", scopeFilter),
      loadFacetField("annual_revenue", scopeFilter),
    ]);

    return {
      contactLocations,
      accountHqLocations,
      jobTitles,
      departments,
      company,
      employees,
      industryKeywords,
      emailStatus,
      technologies,
      revenue,
    };
  }

  const [
    company,
    accountHqLocations,
    employees,
    industryKeywords,
    technologies,
    revenue,
  ] = await Promise.all([
    loadFacetField("company_name", scopeFilter),
    loadFacetField("company_country", scopeFilter),
    loadFacetField("employees", scopeFilter),
    loadFacetField("industry", scopeFilter),
    loadFacetField("technologies", scopeFilter),
    loadFacetField("annual_revenue", scopeFilter),
  ]);

  return {
    company,
    accountHqLocations,
    location: accountHqLocations,
    employees,
    industryKeywords,
    technologies,
    revenue,
  };
}

async function getPeopleSuggestions(scopeFilter: Record<string, unknown>) {
  try {
    return await DataRecord.aggregate([
      {
        $match: mergeFilters(scopeFilter, {
          first_name: { $ne: "" },
          last_name: { $ne: "" },
        }),
      },
      { $limit: 5_000 },
      {
        $group: {
          _id: {
            firstName: "$first_name",
            lastName: "$last_name",
            company: "$company_name",
          },
          title: { $first: "$title" },
          linkedInUrl: { $first: "$person_linkedin_url" },
          industry: { $first: "$industry" },
          recordId: { $first: "$_id" },
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$recordId" },
          firstName: "$_id.firstName",
          lastName: "$_id.lastName",
          name: { $concat: ["$_id.firstName", " ", "$_id.lastName"] },
          title: 1,
          company: "$_id.company",
          linkedInUrl: 1,
          industry: 1,
        },
      },
      { $sort: { name: 1 } },
      { $limit: 200 },
    ]);
  } catch (error) {
    console.error("[filter-sidebar-cache] people suggestions failed", error);
    return [];
  }
}

async function fetchSidebarMeta(
  view: DataView,
  listScopeFilter: Record<string, unknown>
): Promise<FilterSidebarMeta> {
  const scopeFilter = mergeFilters(recordTypeFilter(view), listScopeFilter);

  // Facet dictionaries + a small people sample. Skip management/employee
  // countDocuments here — those are dozens of regex scans and made first
  // paint wait ~10s+. Empty counts are fine; filter UIs still work.
  const [facets, peopleSuggestions] = await Promise.all([
    loadFacets(scopeFilter, view),
    view === "people" ? getPeopleSuggestions(scopeFilter) : Promise.resolve([]),
  ]);

  return {
    facets,
    managementLevelCounts: {},
    employeeRangeCounts: {},
    peopleSuggestions,
  };
}

const EMPTY_SIDEBAR_META: FilterSidebarMeta = {
  facets: {},
  managementLevelCounts: {},
  employeeRangeCounts: {},
  peopleSuggestions: [],
};

function refreshSidebarMeta(view: DataView): Promise<FilterSidebarMeta> {
  const pending = store.inFlight.get(view);
  if (pending) return pending;

  const generation = store.generation;
  const promise = fetchSidebarMeta(view, {})
    .then((value) => {
      if (generation === store.generation) {
        store.entries.set(view, { value, computedAt: Date.now() });
      }
      return value;
    })
    .catch((error) => {
      console.error("[filter-sidebar-cache] sidebar meta failed", error);
      return store.entries.get(view)?.value ?? EMPTY_SIDEBAR_META;
    })
    .finally(() => {
      if (store.inFlight.get(view) === promise) store.inFlight.delete(view);
    });
  store.inFlight.set(view, promise);
  return promise;
}

/**
 * Facet dictionaries are view-wide (saved-list scope is ignored), so they are
 * cached per view and served stale-while-revalidate.
 */
export async function getFilterSidebarMeta(view: DataView): Promise<FilterSidebarMeta> {
  const cached = store.entries.get(view);
  const age = cached ? Date.now() - cached.computedAt : Infinity;
  if (cached && age < FRESH_MS) return cached.value;
  if (cached && age < STALE_MS) {
    void refreshSidebarMeta(view);
    return cached.value;
  }
  return refreshSidebarMeta(view);
}

/** Start computing facets in the background so the first sidebar load is instant. */
export function warmFilterSidebarMeta(view: DataView) {
  const cached = store.entries.get(view);
  if (!cached || Date.now() - cached.computedAt >= FRESH_MS) {
    void refreshSidebarMeta(view);
  }
}

export function invalidateFilterSidebarCache() {
  store.generation += 1;
  store.inFlight.clear();
  const views = [...store.entries.keys()];
  store.entries.clear();
  for (const view of views) void refreshSidebarMeta(view);
}
