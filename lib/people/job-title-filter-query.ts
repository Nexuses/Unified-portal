import {
  DEPARTMENT_GROUPS,
  MANAGEMENT_LEVELS,
} from "@/app/components/portal/crm/people/job-title-options";
import type { JobTitleFilter } from "@/lib/people/data-browser/types";
import {
  buildDepartmentSynonymGroups,
  buildJobTitleSynonymGroups,
  type AliasOverrides,
} from "@/lib/people/field-synonyms";
import { seniorityPatternForLevel } from "@/lib/people/seniority-inference";
import {
  buildSynonymMatchRegex,
  type SynonymGroups,
} from "@/lib/people/text-synonyms";
import { expandSearchTitleTerms } from "@/lib/people/title-normalization";

export type JobTitleFilterPayload = JobTitleFilter;

export type JobTitleFilterContext = {
  titles?: string[];
  departments?: string[];
  aliasOverrides?: AliasOverrides;
};

/** Hard cap keeps Mongo `$or`/`$nor` regex sets small and index-friendly. */
const MAX_TITLE_QUERY_TERMS = 48;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DEPARTMENT_GROUP_BY_LABEL = new Map(
  DEPARTMENT_GROUPS.map((group) => [group.label, group])
);

export function resolveDepartmentFilterTerms(
  selected: string[],
  departmentSynonyms?: SynonymGroups
): string[] {
  const terms = new Set<string>();

  for (const value of selected) {
    const expanded = departmentSynonyms
      ? departmentSynonyms.expandAliasesOnly([value])
      : [value];
    expanded.forEach((entry) => terms.add(entry));

    const group = DEPARTMENT_GROUP_BY_LABEL.get(value);
    if (group) {
      for (const child of group.children) {
        terms.add(child);
      }
    }
  }

  return [...terms];
}

function stripQuotes(term: string) {
  const trimmed = term.trim();
  const quoted = /^"(.*)"$/.test(trimmed);
  const core = quoted ? trimmed.replace(/^"(.*)"$/, "$1").trim() : trimmed;
  return { core, quoted };
}

function dedupeTitleQueryTerms(terms: string[]) {
  const byKey = new Map<string, string>();
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, trimmed);
  }
  return [...byKey.values()];
}

/**
 * - exact: entire title equals the term (Manager ≠ HR Manager)
 * - similar: synonym / word-boundary matching + order variations
 * - default (similar off): word-boundary contains (Manager matches Sales Manager)
 */
function titleRegex(term: string, options: { exact: boolean; similar: boolean }) {
  const { core, quoted } = stripQuotes(term);
  if (!core) {
    return { $regex: "", $options: "i" as const };
  }

  const exact = options.exact || quoted;
  if (exact) {
    return {
      $regex: `^\\s*${escapeRegex(core)}\\s*$`,
      $options: "i" as const,
    };
  }

  if (options.similar) {
    return buildSynonymMatchRegex(core);
  }

  return {
    $regex: `\\b${escapeRegex(core)}\\b`,
    $options: "i" as const,
  };
}

function fieldTitleQuery(
  field: string,
  term: string,
  options: { exact: boolean; similar: boolean }
) {
  return { [field]: titleRegex(term, options) };
}

function managementLevelRegex(level: string) {
  const pattern = seniorityPatternForLevel(level);
  return { $regex: pattern, $options: "i" };
}

function departmentRegex(term: string) {
  const parts = term
    .split(/[\s/&,-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(escapeRegex);

  if (parts.length === 0) {
    return buildSynonymMatchRegex(term);
  }

  if (parts.length === 1) {
    return buildSynonymMatchRegex(parts[0]);
  }

  return { $regex: parts.join("[\\s_/&,-]+"), $options: "i" };
}

function expandTermsForMongoQuery(
  terms: string[],
  options: { exact: boolean; similar: boolean },
  titleSynonyms?: SynonymGroups
) {
  let queryTerms = expandSearchTitleTerms(terms, options);

  // Dictionary aliases only (CEO ↔ Chief Executive Officer). Never pull every
  // corpus title that contains "CFO" into the Mongo `$or` — that was the main
  // timeout path on large people datasets.
  if (titleSynonyms) {
    queryTerms = dedupeTitleQueryTerms([
      ...queryTerms,
      ...titleSynonyms.expandAliasesOnly(queryTerms),
    ]);
  } else {
    queryTerms = dedupeTitleQueryTerms(queryTerms);
  }

  return queryTerms.slice(0, MAX_TITLE_QUERY_TERMS);
}

function buildTitleIncludeQuery(
  terms: string[],
  field: string,
  options: { exact: boolean; similar: boolean },
  titleSynonyms?: SynonymGroups
) {
  if (terms.length === 0) return null;

  const queryTerms = expandTermsForMongoQuery(terms, options, titleSynonyms);
  const queries = queryTerms.map((term) => fieldTitleQuery(field, term, options));
  return queries.length === 1 ? queries[0] : { $or: queries };
}

function buildTitleExcludeQuery(
  terms: string[],
  field: string,
  options: { exact: boolean; similar: boolean },
  titleSynonyms?: SynonymGroups
) {
  if (terms.length === 0) return null;

  const queryTerms = expandTermsForMongoQuery(
    terms,
    {
      // Excludes always expand synonyms so Assistants/Interns can't sneak through via aliases
      exact: false,
      similar: true,
    },
    titleSynonyms
  );

  // Exclude uses word-boundary contains (not exact-only) so "Assistant" removes Assistant Manager
  const excludeOptions = { exact: false, similar: false };
  return {
    $nor: queryTerms.map((term) => fieldTitleQuery(field, term, excludeOptions)),
  };
}

export function buildJobTitleFilterQuery(
  filter: JobTitleFilterPayload,
  context: JobTitleFilterContext = {}
) {
  const exact = Boolean(filter.exactMatch);
  const similar = Boolean(filter.includeSimilar) && !exact;
  const matchOptions = { exact, similar };
  const aliases = context.aliasOverrides;

  // Empty corpus on purpose: Mongo matching uses alias dictionary + regex similar,
  // not thousands of distinct title/department strings.
  const titleSynonyms = buildJobTitleSynonymGroups([], aliases);
  const departmentSynonyms = buildDepartmentSynonymGroups([], aliases);
  const andFilters: Record<string, unknown>[] = [];

  const currentInclude = buildTitleIncludeQuery(
    filter.include,
    "title",
    matchOptions,
    titleSynonyms
  );
  if (currentInclude) andFilters.push(currentInclude);

  const pastInclude = buildTitleIncludeQuery(
    filter.pastTitlesInclude,
    "job_change",
    matchOptions,
    titleSynonyms
  );
  if (pastInclude) andFilters.push(pastInclude);

  const currentExclude = buildTitleExcludeQuery(
    filter.exclude,
    "title",
    matchOptions,
    titleSynonyms
  );
  if (currentExclude) andFilters.push(currentExclude);

  const pastExclude = buildTitleExcludeQuery(
    filter.pastTitlesExclude,
    "job_change",
    matchOptions,
    titleSynonyms
  );
  if (pastExclude) andFilters.push(pastExclude);

  // Match seniority field OR infer from current title (never fabricates data)
  if (filter.managementLevel.length > 0) {
    andFilters.push({
      $or: filter.managementLevel.flatMap((level) => [
        { seniority: managementLevelRegex(level) },
        { title: managementLevelRegex(level) },
      ]),
    });
  }

  const departmentTerms = resolveDepartmentFilterTerms(
    filter.departments,
    departmentSynonyms
  ).slice(0, MAX_TITLE_QUERY_TERMS);
  if (departmentTerms.length > 0) {
    andFilters.push({
      $or: departmentTerms.map((dept) => ({
        departments: departmentRegex(dept),
      })),
    });
  }

  if (andFilters.length === 0) return {};
  return { $and: andFilters };
}

/** Counts for facet UI — matches seniority string OR title inference patterns. */
export function managementLevelMatchQuery(level: string) {
  const regex = managementLevelRegex(level);
  return {
    $or: [{ seniority: regex }, { title: regex }],
  };
}

export function departmentMatchQuery(department: string, departments: string[] = []) {
  const departmentSynonyms = buildDepartmentSynonymGroups(departments);
  const terms = resolveDepartmentFilterTerms([department], departmentSynonyms);
  return {
    $or: terms.map((term) => ({
      departments: departmentRegex(term),
    })),
  };
}

export { MANAGEMENT_LEVELS };
