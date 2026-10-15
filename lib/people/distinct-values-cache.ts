import { recordTypeFilter, type DataView } from "@/lib/people/data-views";
import {
  CORPUS_VALUE_LIMIT,
  cappedFieldValues,
  cappedFieldValuesForTerms,
} from "@/lib/people/capped-distinct";
import { invalidateFilterSidebarCache } from "@/lib/people/filter-sidebar-cache";

const CACHE_TTL_MS = 3 * 60 * 1000;

export interface DistinctValues {
  titles: string[];
  departments: string[];
  industries: string[];
  revenueValues: string[];
}

export interface DistinctValuesRequest {
  titleTerms?: string[];
  departmentTerms?: string[];
  industryTerms?: string[];
  /** When true, only load annual_revenue samples (skip title/dept/industry scans). */
  revenueOnly?: boolean;
}

interface CacheEntry {
  values: DistinctValues;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(view: DataView, request: DistinctValuesRequest = {}) {
  const normalize = (terms: string[] | undefined) =>
    (terms ?? [])
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("|");
  return [
    view,
    request.revenueOnly ? "revenueOnly" : "full",
    normalize(request.titleTerms),
    normalize(request.departmentTerms),
    normalize(request.industryTerms),
  ].join("::");
}

async function fetchDistinctValues(
  view: DataView,
  request: DistinctValuesRequest = {}
): Promise<DistinctValues> {
  const typeFilter = recordTypeFilter(view);

  if (request.revenueOnly) {
    const revenueValues = await cappedFieldValues(
      "annual_revenue",
      typeFilter,
      CORPUS_VALUE_LIMIT
    );
    return {
      titles: [],
      departments: [],
      industries: [],
      revenueValues,
    };
  }

  const [titles, departments, industries, revenueValues] = await Promise.all([
    cappedFieldValuesForTerms(
      "title",
      typeFilter,
      request.titleTerms ?? [],
      CORPUS_VALUE_LIMIT
    ),
    cappedFieldValuesForTerms(
      "departments",
      typeFilter,
      request.departmentTerms ?? [],
      CORPUS_VALUE_LIMIT
    ),
    cappedFieldValuesForTerms(
      "industry",
      typeFilter,
      request.industryTerms ?? [],
      CORPUS_VALUE_LIMIT
    ),
    cappedFieldValues("annual_revenue", typeFilter, CORPUS_VALUE_LIMIT),
  ]);

  return { titles, departments, industries, revenueValues };
}

const EMPTY_DISTINCT_VALUES: DistinctValues = {
  titles: [],
  departments: [],
  industries: [],
  revenueValues: [],
};

export async function getDistinctValues(
  view: DataView,
  request: DistinctValuesRequest = {}
): Promise<DistinctValues> {
  const key = cacheKey(view, request);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.values;
  }

  try {
    const values = await fetchDistinctValues(view, request);
    cache.set(key, { values, expiresAt: now + CACHE_TTL_MS });
    return values;
  } catch (error) {
    console.error("[distinct-values-cache] failed; using empty corpus", error);
    return EMPTY_DISTINCT_VALUES;
  }
}

export function invalidateDistinctValuesCache(view?: DataView) {
  invalidateFilterSidebarCache();
  if (!view) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${view}::`)) {
      cache.delete(key);
    }
  }
}
