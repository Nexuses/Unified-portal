import {
  AI_FILTERS_READY_RULES,
  AI_FILTERS_READY_SCHEMA,
  AI_SEARCH_MAX_QUERY_LENGTH,
  extractJsonObject,
  normalizeAiSearchPayload,
  type AiSearchFilters,
} from "@/lib/people/ai-search";
import { callAiGatewayJson } from "@/lib/people/ai-gateway";
import {
  applyJevDecisions,
  askJevForFilterDecisions,
  isJevFiltersEnabled,
} from "@/lib/people/jev-filters";
import {
  EMPTY_JOB_TITLE_FILTER,
  EMPTY_PEOPLE_LOOKALIKES_FILTER,
} from "@/lib/people/data-browser/types";
import type { DataView } from "@/lib/people/data-views";

function buildSystemPrompt(view: DataView): string {
  const viewRules =
    view === "companies"
      ? `- The user is on the Companies page. "view" MUST be "companies".
- Leave people-only filters empty: filters.name, filters.emailStatus, jobTitleFilter, peopleLookalikesFilter.
- Put any location in locationFilter with tab "account_hq".`
      : `- The user is on the People page. "view" MUST be "people".
- Put a location in locationFilter with tab "contact" unless the user clearly means company HQ.`;

  return `You turn a plain-English description into sidebar filters for a people/companies CRM tool.
Return ONLY a single JSON object. No markdown, no commentary.
Never ask clarifying questions — always return best-effort filters using this schema:
${AI_FILTERS_READY_SCHEMA}

Rules:
${viewRules}
${AI_FILTERS_READY_RULES}
- For job titles, include common spelling variants (e.g. "VP Sales", "Vice President Sales") and set managementLevel / departments when they are implied.
- For places with well-known alternate names, include both (e.g. "Bangalore" and "Bengaluru", "Bombay" and "Mumbai").
- For fintech, include both "Fintech" and "Financial Services" in industries.
- "explanation" is a short label joined by " — " (e.g. "VP Sales — SaaS — United States — verified emails"), not a sentence.`;
}

export async function parseFiltersWithAiGateway(
  query: string,
  view: DataView
): Promise<AiSearchFilters> {
  const content = await callAiGatewayJson({
    messages: [
      { role: "system", content: buildSystemPrompt(view) },
      { role: "user", content: query.trim().slice(0, AI_SEARCH_MAX_QUERY_LENGTH) },
    ],
  });

  const parsed = normalizeAiSearchPayload(extractJsonObject(content));
  const filters: AiSearchFilters = { ...parsed, view };

  if (view === "companies") {
    filters.filters = {};
    filters.jobTitleFilter = { ...EMPTY_JOB_TITLE_FILTER };
    filters.peopleLookalikesFilter = { ...EMPTY_PEOPLE_LOOKALIKES_FILTER };
  }

  return filters;
}

/**
 * AI Gateway fills free-text fields; Jev (when enabled) decides fixed-option
 * fields in parallel. A Jev failure falls back to the AI Gateway result.
 */
export async function parseFiltersHybrid(
  query: string,
  view: DataView
): Promise<AiSearchFilters> {
  if (!isJevFiltersEnabled()) {
    return parseFiltersWithAiGateway(query, view);
  }

  const trimmed = query.trim().slice(0, AI_SEARCH_MAX_QUERY_LENGTH);
  const [filters, decisions] = await Promise.all([
    parseFiltersWithAiGateway(trimmed, view),
    askJevForFilterDecisions(trimmed, view).catch((error: unknown) => {
      console.warn("Jev filter decisions failed; using AI Gateway filters only:", error);
      return null;
    }),
  ]);

  return decisions ? applyJevDecisions(filters, decisions) : filters;
}
