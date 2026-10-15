const STOP_WORDS = new Set([
  "of",
  "the",
  "and",
  "a",
  "an",
  "for",
  "in",
  "at",
  "to",
  "on",
  "&",
]);

export type SynonymGroups = {
  expand: (term: string) => string[];
  expandAll: (terms: string[]) => string[];
  /** Alias dictionary forms only — never pulls corpus titles into Mongo `$or` clauses. */
  expandAliasesOnly: (terms: string[]) => string[];
  getDisplayLabel: (term: string) => string;
  matchSuggestions: (query: string, limit?: number) => string[];
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[.]+/g, "").replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return value
    .split(/[\s/&,+-]+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((part) => part.length > 0);
}

export function acronymFromPhrase(phrase: string): string {
  const acronyms = generateAcronyms(phrase);
  return acronyms.length > 0 ? acronyms[acronyms.length - 1] : "";
}

export function generateAcronyms(phrase: string): string[] {
  const words = tokenize(phrase).filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  if (words.length < 2) return [];

  const acronyms: string[] = [];
  for (let end = 2; end <= words.length; end += 1) {
    acronyms.push(words.slice(0, end).map((word) => word[0]).join("").toUpperCase());
  }
  return acronyms;
}

const SMALL_TITLE_WORDS = new Set(["of", "and", "the", "for", "in", "at", "to", "or"]);

/** Pretty-print dictionary forms: ceo → CEO, chief executive officer → Chief Executive Officer */
export function formatTitleAlias(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (/^[a-z](?:\.[a-z])+\.?$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (/^[a-z0-9]{2,6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return trimmed
    .split(/\s+/)
    .map((word, index) => {
      if (/^[A-Z]{2,6}$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_TITLE_WORDS.has(lower)) return lower;
      if (/^[a-z](?:\.[a-z])+\.?$/i.test(word)) return word.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function aliasFormMatchesQuery(form: string, query: string): boolean {
  const formKey = normalizeKey(form);
  if (!query || !formKey) return false;
  if (formKey === query) return true;
  if (query.length <= 3) {
    return formKey.startsWith(query);
  }
  return formKey.includes(query);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSynonymMatchRegex(term: string) {
  const trimmed = term.trim();
  if (!trimmed) {
    return { $regex: "", $options: "i" as const };
  }

  const escaped = escapeRegex(trimmed);
  if (trimmed.includes(" ")) {
    return { $regex: escaped, $options: "i" as const };
  }

  return { $regex: `\\b${escaped}\\b`, $options: "i" as const };
}

export function dedupeSynonymQueryTerms(terms: string[]) {
  const byKey = new Map<string, string>();
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const key = normalizeKey(trimmed);
    const existing = byKey.get(key);
    if (!existing || trimmed.length > existing.length) {
      byKey.set(key, trimmed);
    }
  }
  return [...byKey.values()];
}

type AliasGroup = {
  forms: string[];
  keys: Set<string>;
};

/**
 * Build synonym groups from curated alias lists + optional corpus titles.
 *
 * Important: alias groups stay independent. A dual title like "CFO & COO" must
 * NOT merge the CFO and COO concepts (that previously made CFO match COO).
 * Corpus titles are attached as hits for matching forms only.
 */
export function buildSynonymGroups(
  corpus: string[],
  staticAliases: Record<string, string[]> = {}
): SynonymGroups {
  const corpusValues = corpus.map((value) => value.trim()).filter(Boolean);
  const aliasGroups: AliasGroup[] = [];
  const keyToGroupIndexes = new Map<string, number[]>();

  function registerGroup(aliases: string[]) {
    const cleaned = aliases.map((entry) => entry.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    const keys = new Set(cleaned.map((entry) => normalizeKey(entry)));
    const index = aliasGroups.length;
    aliasGroups.push({ forms: cleaned, keys });
    for (const key of keys) {
      const list = keyToGroupIndexes.get(key);
      if (list) list.push(index);
      else keyToGroupIndexes.set(key, [index]);
    }
  }

  Object.values(staticAliases).forEach(registerGroup);

  const valuesByToken = new Map<string, string[]>();
  for (const value of corpusValues) {
    for (const token of tokenize(value)) {
      const key = token.toLowerCase();
      const list = valuesByToken.get(key);
      if (list) list.push(value);
      else valuesByToken.set(key, [value]);
    }
  }

  function corpusHitsForForm(form: string): string[] {
    const key = normalizeKey(form);
    if (!key) return [];

    if (key.includes(" ")) {
      return corpusValues.filter((value) => normalizeKey(value).includes(key));
    }

    return valuesByToken.get(key) ?? [];
  }

  function indexesForTerm(term: string): number[] {
    const key = normalizeKey(term);
    const indexes = new Set<number>(keyToGroupIndexes.get(key) ?? []);

    const acronym = acronymFromPhrase(term);
    if (acronym) {
      for (const index of keyToGroupIndexes.get(normalizeKey(acronym)) ?? []) {
        indexes.add(index);
      }
    }

    return [...indexes];
  }

  function aliasesOnlyForTerm(term: string): Set<string> {
    const trimmed = term.trim();
    if (!trimmed) return new Set();

    const group = new Set<string>([trimmed]);
    for (const index of indexesForTerm(trimmed)) {
      for (const form of aliasGroups[index].forms) {
        group.add(form);
      }
    }
    return group;
  }

  function groupForTerm(term: string): Set<string> {
    const trimmed = term.trim();
    if (!trimmed) return new Set();

    const group = new Set<string>([trimmed]);
    const indexes = indexesForTerm(trimmed);

    if (indexes.length > 0) {
      for (const index of indexes) {
        const aliasGroup = aliasGroups[index];
        for (const form of aliasGroup.forms) {
          group.add(form);
          for (const hit of corpusHitsForForm(form)) {
            group.add(hit);
          }
        }
      }
    } else {
      // Unknown term: keep direct corpus token / phrase hits only (no transitive merge)
      const key = normalizeKey(trimmed);
      if (key.includes(" ")) {
        for (const value of corpusValues) {
          if (normalizeKey(value).includes(key)) group.add(value);
        }
      } else if (key.length >= 2) {
        for (const value of valuesByToken.get(key) ?? []) {
          group.add(value);
        }
      }
    }

    // Short uppercase tokens (CEO, VP, …): also pull corpus titles with that token
    if (trimmed.length <= 6 && trimmed.toUpperCase() === trimmed) {
      for (const value of valuesByToken.get(normalizeKey(trimmed)) ?? []) {
        group.add(value);
      }
    }

    return group;
  }

  function pickDisplayLabel(group: Set<string>, preferred?: string): string {
    const values = [...group].filter(Boolean);
    if (values.length === 0) return preferred ?? "";
    if (preferred && values.includes(preferred)) return preferred;

    const sorted = values.sort((a, b) => {
      const aScore = a.includes(" ") ? a.length : -a.length;
      const bScore = b.includes(" ") ? b.length : -b.length;
      return bScore - aScore || a.localeCompare(b);
    });
    return sorted[0];
  }

  return {
    expand(term: string) {
      return [...groupForTerm(term)];
    },
    expandAll(terms: string[]) {
      const expanded = new Set<string>();
      terms.forEach((term) => groupForTerm(term).forEach((value) => expanded.add(value)));
      return [...expanded];
    },
    expandAliasesOnly(terms: string[]) {
      const expanded = new Set<string>();
      terms.forEach((term) =>
        aliasesOnlyForTerm(term).forEach((value) => expanded.add(value))
      );
      return [...expanded];
    },
    getDisplayLabel(term: string) {
      return formatTitleAlias(term);
    },
    matchSuggestions(query: string, limit = 20) {
      const normalizedQuery = normalizeKey(query);
      if (!normalizedQuery) {
        return corpusValues.slice(0, limit);
      }

      const results: string[] = [];
      const seen = new Set<string>();

      const push = (label: string) => {
        const formatted = formatTitleAlias(label);
        const key = normalizeKey(formatted);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        results.push(formatted);
        return results.length >= limit;
      };

      // Dictionary first: typing "CEO" should surface CEO + Chief Executive Officer
      const matchedAliasGroups = aliasGroups.filter((group) =>
        group.forms.some((form) => aliasFormMatchesQuery(form, normalizedQuery))
      );
      for (const aliasGroup of matchedAliasGroups) {
        const dotted = /^[a-z](?:\.[a-z])+\.?$/i;
        const forms = aliasGroup.forms.filter((form) => !dotted.test(form.trim()));
        const ordered = [...forms].sort((a, b) => {
          const aKey = normalizeKey(a);
          const bKey = normalizeKey(b);
          const aExact = aKey === normalizedQuery ? 0 : 1;
          const bExact = bKey === normalizedQuery ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          const aShort = aKey.includes(" ") ? 1 : 0;
          const bShort = bKey.includes(" ") ? 1 : 0;
          if (aShort !== bShort) return aShort - bShort;
          return a.length - b.length;
        });
        for (const form of ordered) {
          if (push(form)) return results;
        }
      }

      for (const value of corpusValues) {
        const valueKey = normalizeKey(value);
        if (
          valueKey.includes(normalizedQuery) ||
          tokenize(value).some((token) => token.toLowerCase().startsWith(normalizedQuery))
        ) {
          if (push(value)) return results;
        }
      }

      return results;
    },
  };
}

export function textMatchesSynonymGroups(
  value: string,
  terms: string[],
  groups: SynonymGroups
): boolean {
  const normalizedValue = normalizeKey(value);
  const valueTokens = new Set(tokenize(value).map((token) => token.toLowerCase()));

  return terms.some((term) =>
    groups.expand(term).some((candidate) => {
      const normalizedCandidate = normalizeKey(candidate);
      if (normalizedValue === normalizedCandidate) return true;
      if (normalizedCandidate.includes(" ")) {
        return normalizedValue.includes(normalizedCandidate);
      }
      return valueTokens.has(normalizedCandidate);
    })
  );
}
