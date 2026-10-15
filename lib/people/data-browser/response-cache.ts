import type { PeopleSuggestionRecord } from "@/app/components/portal/crm/people/people-lookalike-suggestions";
import type { DataView } from "@/lib/people/data-views";

/**
 * In-memory caches for `/api/data` responses that survive client-side route
 * changes, so switching sidebar tabs repaints instantly and refreshes quietly.
 */

export interface RecordsResponse {
  records: Array<{ id: string; [key: string]: string }>;
  total: number;
  totalPages: number;
  stats: { total: number; netNew: number; saved: number };
  expandedHighlights?: { title: string[]; departments: string[]; industry: string[] };
}

export interface FacetsResponse {
  facets: Record<string, string[]>;
  facetCounts: Record<string, Record<string, number>>;
  managementLevelCounts: Record<string, number>;
  employeeRangeCounts: Record<string, number>;
  peopleSuggestions: PeopleSuggestionRecord[];
}

const MAX_RECORD_ENTRIES = 30;
const FACETS_FRESH_MS = 10 * 60 * 1000;

interface CachedRecords {
  value: RecordsResponse;
  /** Raw response body, compared to skip re-rendering unchanged refreshes. */
  body: string;
}

const recordsCache = new Map<string, CachedRecords>();
const facetsCache = new Map<DataView, { value: FacetsResponse; at: number }>();

export function getCachedRecords(key: string) {
  const entry = recordsCache.get(key);
  if (!entry) return null;
  recordsCache.delete(key);
  recordsCache.set(key, entry);
  return entry;
}

export function setCachedRecords(key: string, value: RecordsResponse, body: string) {
  recordsCache.delete(key);
  recordsCache.set(key, { value, body });
  while (recordsCache.size > MAX_RECORD_ENTRIES) {
    const oldest = recordsCache.keys().next().value;
    if (oldest === undefined) break;
    recordsCache.delete(oldest);
  }
}

export function getCachedFacets(view: DataView) {
  const entry = facetsCache.get(view);
  if (!entry) return null;
  return { value: entry.value, fresh: Date.now() - entry.at < FACETS_FRESH_MS };
}

export function setCachedFacets(view: DataView, value: FacetsResponse) {
  facetsCache.set(view, { value, at: Date.now() });
}

export function clearDataBrowserCache() {
  recordsCache.clear();
  facetsCache.clear();
}
