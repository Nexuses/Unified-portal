import type { LocationFilter, LocationFilterTab } from "@/lib/people/data-browser/types";

export type LocationFilterPayload = LocationFilter;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONTACT_COUNTRY_MISSING = {
  $or: [
    { contact_country: { $exists: false } },
    { contact_country: null },
    { contact_country: { $regex: "^\\s*$" } },
  ],
};

function buildLocationMatchQuery(
  location: string,
  tab: LocationFilterTab
): Record<string, unknown> | null {
  const trimmed = location.trim();
  if (!trimmed) return null;

  const regex = { $regex: escapeRegex(trimmed), $options: "i" };
  const companyLocation = {
    $or: [{ company_country: regex }, { company_address: regex }],
  };

  if (tab === "account_hq") return companyLocation;

  // Company HQ only stands in for the contact's location when the contact country is blank.
  return {
    $or: [{ contact_country: regex }, { $and: [CONTACT_COUNTRY_MISSING, companyLocation] }],
  };
}

function buildIncludeQuery(include: string[], tab: LocationFilterTab) {
  const queries = include
    .map((location) => buildLocationMatchQuery(location, tab))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (queries.length === 0) return null;
  return queries.length === 1 ? queries[0] : { $or: queries };
}

function buildExcludeQuery(exclude: string[], tab: LocationFilterTab) {
  const queries = exclude
    .map((location) => buildLocationMatchQuery(location, tab))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (queries.length === 0) return null;
  const combined = queries.length === 1 ? queries[0] : { $or: queries };
  return { $nor: [combined] };
}

export function buildLocationFilterQuery(filter: LocationFilter) {
  const andFilters: Record<string, unknown>[] = [];

  const includeQuery = buildIncludeQuery(filter.include, filter.tab);
  if (includeQuery) andFilters.push(includeQuery);

  const excludeQuery = buildExcludeQuery(filter.exclude, filter.tab);
  if (excludeQuery) andFilters.push(excludeQuery);

  if (andFilters.length === 0) return {};
  return andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
}
