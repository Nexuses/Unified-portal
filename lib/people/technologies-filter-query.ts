import type { TechnologiesFilter } from "@/lib/people/data-browser/types";
import { buildTechnologyMatchRegex } from "@/lib/people/technologies";

export type TechnologiesFilterPayload = TechnologiesFilter;

function buildTechnologyMatchQuery(technology: string): Record<string, unknown> | null {
  const trimmed = technology.trim();
  if (!trimmed) return null;

  return {
    technologies: {
      $regex: buildTechnologyMatchRegex(trimmed),
      $options: "i",
    },
  };
}

function combineOr(queries: Record<string, unknown>[]) {
  if (queries.length === 0) return null;
  return queries.length === 1 ? queries[0] : { $or: queries };
}

function buildIncludeQuery(technologies: string[]) {
  const queries = technologies
    .map((technology) => buildTechnologyMatchQuery(technology))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  return combineOr(queries);
}

function buildIncludeAllQuery(technologies: string[]) {
  const queries = technologies
    .map((technology) => buildTechnologyMatchQuery(technology))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (queries.length === 0) return null;
  return queries.length === 1 ? queries[0] : { $and: queries };
}

function buildExcludeQuery(technologies: string[]) {
  const queries = technologies
    .map((technology) => buildTechnologyMatchQuery(technology))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (queries.length === 0) return null;
  const combined = combineOr(queries);
  if (!combined) return null;

  return {
    $or: [
      { technologies: { $exists: false } },
      { technologies: "" },
      { technologies: { $regex: /^\s*$/ } },
      { $nor: [combined] },
    ],
  };
}

export function buildTechnologiesFilterQuery(filter: TechnologiesFilter) {
  const andFilters: Record<string, unknown>[] = [];

  const includeQuery = buildIncludeQuery(filter.include);
  if (includeQuery) andFilters.push(includeQuery);

  const includeAllQuery = buildIncludeAllQuery(filter.includeAll);
  if (includeAllQuery) andFilters.push(includeAllQuery);

  const excludeQuery = buildExcludeQuery(filter.exclude);
  if (excludeQuery) andFilters.push(excludeQuery);

  if (andFilters.length === 0) return {};
  return andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
}
