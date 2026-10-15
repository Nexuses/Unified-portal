import {
  AI_PENDING_FILTERS_KEY,
  aiSearchFiltersToPresetPayload,
  type AiSearchFilters,
} from "@/lib/people/ai-search";

export type EnrichExclusions = { unsubscribed: boolean; existing: boolean };

export const ENRICH_SESSION_SCOPE = "portal-enrich-people";

/** Fired on window with a `FilterPresetPayload` when Enrich is already open. */
export const ENRICH_APPLY_FILTERS_EVENT = "portal-enrich:apply-filters";

export const ENRICH_PEOPLE_ROUTE = "/portal/crm/enrich?view=people";

export const ENRICH_MAX_SAVE = 5000;

export const ENRICH_MAX_SAVE_MESSAGE = `You can save up to ${ENRICH_MAX_SAVE.toLocaleString()} contacts at a time. Select fewer rows or narrow your filters.`;

/**
 * Hand AI-picked filters to the Enrich people browser. Stores them for the
 * next mount and also applies them live if the browser is already on screen.
 */
export function queueEnrichFilters(filters: AiSearchFilters) {
  const payload = aiSearchFiltersToPresetPayload(filters, { activeStat: "total" });
  try {
    sessionStorage.setItem(
      AI_PENDING_FILTERS_KEY,
      JSON.stringify({ view: "people", payload })
    );
  } catch {
    // Private mode / quota — the live event below still works on the page.
  }
  window.dispatchEvent(new CustomEvent(ENRICH_APPLY_FILTERS_EVENT, { detail: payload }));
}
