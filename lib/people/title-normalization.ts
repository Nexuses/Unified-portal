/**
 * Job-title normalization and controlled variation expansion.
 * Used for search matching — never overwrites original stored titles.
 */

const ROLE_WORDS = [
  "director",
  "manager",
  "head",
  "lead",
  "vp",
  "vice president",
  "svp",
  "senior vice president",
  "evp",
  "executive vice president",
  "avp",
  "assistant vice president",
  "chief",
  "officer",
  "specialist",
  "analyst",
  "engineer",
  "architect",
  "consultant",
] as const;

/** Normalize a job title for internal matching (does not mutate stored data). */
export function normalizeJobTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, "-") // unicode dashes → hyphen
    .replace(/\./g, "") // C.F.O. → CFO
    .replace(/,/g, " ")
    .replace(/&/g, " and ")
    .replace(/[+]/g, " and ")
    .replace(/[_/|]+/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate order / punctuation variations for role+function titles.
 * e.g. "Finance Director" ↔ "Director of Finance" ↔ "Director, Finance"
 * Does NOT invent unrelated roles (Finance Manager from Finance Director).
 */
export function expandTitleOrderVariations(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const variations = new Set<string>([trimmed]);
  const normalized = normalizeJobTitle(trimmed);
  if (normalized && normalized !== trimmed.toLowerCase()) {
    variations.add(normalized);
  }

  const ofMatch = normalized.match(/^(.+?)\s+of\s+(.+)$/);
  if (ofMatch) {
    const role = ofMatch[1].trim();
    const domain = ofMatch[2].trim();
    variations.add(`${domain} ${role}`);
    variations.add(`${role} ${domain}`);
    variations.add(`${role}, ${domain}`);
    variations.add(`${role} – ${domain}`);
  }

  for (const role of ROLE_WORDS) {
    const roleRe = escapeRegex(role);
    const domainThenRole = normalized.match(new RegExp(`^(.+?)\\s+${roleRe}$`));
    if (domainThenRole) {
      const domain = domainThenRole[1].trim();
      if (domain && !ROLE_WORDS.some((r) => domain === r)) {
        variations.add(`${role} of ${domain}`);
        variations.add(`${role} ${domain}`);
        variations.add(`${role}, ${domain}`);
        variations.add(`${role} – ${domain}`);
      }
    }

    const roleThenDomain = normalized.match(new RegExp(`^${roleRe}\\s+(.+)$`));
    if (roleThenDomain) {
      let domain = roleThenDomain[1].trim();
      if (domain.startsWith("of ")) domain = domain.slice(3).trim();
      if (domain) {
        variations.add(`${domain} ${role}`);
        variations.add(`${role} of ${domain}`);
        variations.add(`${role}, ${domain}`);
      }
    }
  }

  // Head of X ↔ X Head
  const headOf = normalized.match(/^head\s+of\s+(.+)$/);
  if (headOf) {
    variations.add(`${headOf[1]} head`);
    variations.add(`head ${headOf[1]}`);
  }
  const headSuffix = normalized.match(/^(.+?)\s+head$/);
  if (headSuffix && headSuffix[1] !== "of") {
    variations.add(`head of ${headSuffix[1]}`);
  }

  // Financial ↔ Finance (controlled, title-context only)
  const financeSwap = normalized
    .replace(/\bfinancial\b/g, "finance")
    .replace(/\bfinance\b/g, "financial");
  if (financeSwap !== normalized) {
    variations.add(financeSwap);
    for (const v of expandTitleOrderVariationsShallow(financeSwap)) {
      variations.add(v);
    }
  }

  return [...variations].filter(Boolean);
}

/** One-level variation expand to avoid recursion on finance↔financial. */
function expandTitleOrderVariationsShallow(normalized: string): string[] {
  const out: string[] = [normalized];
  const ofMatch = normalized.match(/^(.+?)\s+of\s+(.+)$/);
  if (ofMatch) {
    out.push(`${ofMatch[2]} ${ofMatch[1]}`);
  }
  for (const role of ["director", "manager", "head", "vp", "vice president"]) {
    const m = normalized.match(new RegExp(`^(.+?)\\s+${escapeRegex(role)}$`));
    if (m) {
      out.push(`${role} of ${m[1]}`);
      out.push(`${role} ${m[1]}`);
    }
  }
  return out;
}

/**
 * Expand search terms with order variations when similar matching is on.
 * Exact/strict mode still gets punctuation-normalized forms only.
 */
export function expandSearchTitleTerms(
  terms: string[],
  options: { similar: boolean; exact: boolean }
): string[] {
  const byKey = new Map<string, string>();

  const add = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const key = normalizeJobTitle(trimmed);
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing || trimmed.length > existing.length) {
      byKey.set(key, trimmed);
    }
  };

  for (const term of terms) {
    add(term);
    add(normalizeJobTitle(term));

    if (options.similar && !options.exact) {
      for (const variation of expandTitleOrderVariations(term)) {
        add(variation);
      }
    }
  }

  return [...byKey.values()];
}
