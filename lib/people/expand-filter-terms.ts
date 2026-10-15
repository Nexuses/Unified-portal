/**
 * Expand short search terms into matching catalog values (OR semantics),
 * matching how the Technologies sidebar filters by substring.
 */
export function expandTermsAgainstOptions(
  terms: string[],
  options: string[],
  maxPerTerm = 25
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function add(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  }

  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;

    const query = trimmed.toLowerCase();
    if (query.length < 2 || options.length === 0) {
      add(trimmed);
      continue;
    }

    const matches = options
      .filter((option) => option.toLowerCase().includes(query))
      .slice(0, maxPerTerm);

    // Keep the user's own term so expansion only ever widens the match.
    add(trimmed);
    matches.forEach(add);
  }

  return result;
}

/**
 * Industry / business terms that often appear inside product names
 * (e.g. "SaaS" in "Kronos SaaShr"). Never expand these as technologies.
 */
export const TECHNOLOGY_AMBIGUOUS_TERMS = new Set([
  "saas",
  "paas",
  "iaas",
  "software",
  "cloud",
  "tech",
  "technology",
  "technologies",
  "fintech",
  "healthtech",
  "edtech",
  "martech",
  "insurtech",
  "proptech",
  "crm",
  "erp",
  "ai",
  "ml",
  "digital",
  "internet",
  "mobile",
  "security",
  "analytics",
  "data",
  "platform",
  "platforms",
  "app",
  "apps",
  "web",
  "online",
  "enterprise",
  "automation",
  "marketing",
  "sales",
  "finance",
  "banking",
  "healthcare",
  "education",
  "retail",
  "manufacturing",
]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-token match so "aws" hits "Amazon AWS" but not random substrings. */
function optionHasTermToken(option: string, term: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
  return pattern.test(option);
}

/**
 * Strict technology expansion: exact catalog hits + token-aware relatives.
 * Skips ambiguous industry words (SaaS, cloud, …) so they are not turned
 * into dozens of product filters.
 */
export function expandTechnologyTermsAgainstOptions(
  terms: string[],
  options: string[],
  maxPerTerm = 25
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function add(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  }

  const optionsByKey = new Map(
    options.map((option) => [option.trim().toLowerCase(), option.trim()] as const)
  );

  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const query = trimmed.toLowerCase();

    if (TECHNOLOGY_AMBIGUOUS_TERMS.has(query)) {
      continue;
    }

    const exact = optionsByKey.get(query);
    if (exact) {
      add(exact);
    }

    if (query.length < 3 || options.length === 0) {
      if (!exact) add(trimmed);
      continue;
    }

    const matches = options
      .filter((option) => {
        const lower = option.toLowerCase();
        if (lower === query) return false; // already added
        return optionHasTermToken(option, query);
      })
      .slice(0, maxPerTerm);

    if (matches.length > 0) {
      matches.forEach(add);
    } else if (!exact) {
      // Keep LLM term as-is so the filter still attempts a match
      add(trimmed);
    }
  }

  return result;
}

/** True when `query` matches at least one catalog option as a substring. */
export function queryMatchesCatalog(query: string, options: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return false;
  return options.some((option) => option.toLowerCase().includes(q));
}
