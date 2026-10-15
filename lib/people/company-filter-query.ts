import { companyDomainByName } from "@/app/components/portal/crm/people/company-suggestions";
import type { CompanyFilter, CompanyFilterSelection } from "@/lib/people/data-browser/types";

export type CompanyFilterPayload = CompanyFilter;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexMatch(field: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { [field]: { $regex: escapeRegex(trimmed), $options: "i" } };
}

function parseBulkEntries(raw: string): string[] {
  return raw
    .split(/[\n\r,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // "dell.com salesforce.com" is several domains; "Acme Corp" is one company name.
      const tokens = line.split(/\s+/);
      return tokens.length > 1 && tokens.every(isLikelyDomain) ? tokens : [line];
    });
}

function extractDomain(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) return "";

  if (trimmed.includes("@")) {
    return trimmed.split("@")[1]?.trim() ?? "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return withoutProtocol.split(/[/?#]/)[0]?.trim() ?? "";
}

function isLikelyDomain(entry: string) {
  const domain = extractDomain(entry);
  return Boolean(domain && domain.includes(".") && !domain.includes(" "));
}

function buildBulkEntryQuery(entry: string, namesOnly: boolean) {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  if (namesOnly) {
    return regexMatch("company_name", trimmed);
  }

  const orFilters: Record<string, unknown>[] = [];
  const nameFilter = regexMatch("company_name", trimmed);
  if (nameFilter) orFilters.push(nameFilter);

  const domain = isLikelyDomain(trimmed) ? extractDomain(trimmed) : "";
  if (domain) {
    orFilters.push(
      { website: { $regex: escapeRegex(domain), $options: "i" } },
      { company_linkedin_url: { $regex: escapeRegex(domain), $options: "i" } },
      { email: { $regex: `@${escapeRegex(domain)}$`, $options: "i" } }
    );
  }

  if (orFilters.length === 0) return null;
  return orFilters.length === 1 ? orFilters[0] : { $or: orFilters };
}

function buildBulkListQuery(raw: string, namesOnly: boolean, negate = false) {
  const entries = parseBulkEntries(raw);
  if (entries.length === 0) return null;

  const entryQueries = entries
    .map((entry) => buildBulkEntryQuery(entry, namesOnly))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (entryQueries.length === 0) return null;

  const combined = entryQueries.length === 1 ? entryQueries[0] : { $or: entryQueries };
  return negate ? { $nor: [combined] } : combined;
}

function buildCompanySelectionQuery(selection: CompanyFilterSelection) {
  const name = selection.name.trim();
  if (!name) return null;

  const domain = selection.domain?.trim() || companyDomainByName(name);
  const orFilters: Record<string, unknown>[] = [];

  const nameFilter = regexMatch("company_name", name);
  if (nameFilter) orFilters.push(nameFilter);

  if (domain) {
    orFilters.push(
      { website: { $regex: escapeRegex(domain), $options: "i" } },
      { company_linkedin_url: { $regex: escapeRegex(domain), $options: "i" } },
      { email: { $regex: `@${escapeRegex(domain)}$`, $options: "i" } }
    );
  }

  if (orFilters.length === 0) return null;
  return orFilters.length === 1 ? orFilters[0] : { $or: orFilters };
}

function combineOr(queries: Record<string, unknown>[]) {
  if (queries.length === 0) return null;
  return queries.length === 1 ? queries[0] : { $or: queries };
}

function buildPastCompanyQuery(companies: string[]) {
  const queries = companies
    .map((company) => regexMatch("job_change", company))
    .filter(Boolean) as Record<string, unknown>[];
  return combineOr(queries);
}

function buildCurrentCompaniesQuery(selections: CompanyFilterSelection[]) {
  const queries = selections
    .map((selection) => buildCompanySelectionQuery(selection))
    .filter((query): query is Record<string, unknown> => Boolean(query));
  return combineOr(queries);
}

function buildIsAnyOfCompaniesQuery(filter: CompanyFilter) {
  if (filter.include.length === 0) return null;

  const companyNames = filter.include.map((selection) => selection.name);
  const currentQuery = buildCurrentCompaniesQuery(filter.include);
  const pastQuery = buildPastCompanyQuery(companyNames);

  if (!currentQuery) return null;

  const andFilters: Record<string, unknown>[] = [];

  if (filter.isNotAnyOf) {
    let exclusionQuery: Record<string, unknown> = currentQuery;
    if (filter.includePastCompany && pastQuery) {
      exclusionQuery = combineOr([currentQuery, pastQuery]) ?? currentQuery;
    }
    andFilters.push({ $nor: [exclusionQuery] });

    if (filter.excludePastCompany && pastQuery && !filter.includePastCompany) {
      andFilters.push({ $nor: [pastQuery] });
    }
  } else {
    let inclusionQuery: Record<string, unknown> = currentQuery;
    if (filter.includePastCompany && pastQuery) {
      inclusionQuery = combineOr([currentQuery, pastQuery]) ?? currentQuery;
    }
    andFilters.push(inclusionQuery);

    if (filter.excludePastCompany && pastQuery) {
      andFilters.push({ $nor: [pastQuery] });
    }
  }

  if (andFilters.length === 0) return null;
  return andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
}

function buildKnownCompanyQuery() {
  return {
    company_name: { $exists: true, $regex: /\S/, $options: "" },
  };
}

function buildUnknownCompanyQuery() {
  return {
    $or: [
      { company_name: { $exists: false } },
      { company_name: "" },
      { company_name: { $regex: /^\s*$/ } },
    ],
  };
}

function buildDomainExistsQuery() {
  return {
    website: { $exists: true, $regex: /\S/, $options: "" },
  };
}

export function buildCompanyFilterQuery(filter: CompanyFilter) {
  const andFilters: Record<string, unknown>[] = [];

  if (filter.mode === "is_known") {
    andFilters.push(buildKnownCompanyQuery());
  } else if (filter.mode === "is_unknown") {
    andFilters.push(buildUnknownCompanyQuery());
  } else {
    const companyQuery = buildIsAnyOfCompaniesQuery(filter);
    if (companyQuery) andFilters.push(companyQuery);

    if (filter.domainExists) {
      andFilters.push(buildDomainExistsQuery());
    }
  }

  const includeListQuery = buildBulkListQuery(
    filter.includeList,
    filter.includeListNamesOnly,
    false
  );
  if (includeListQuery) andFilters.push(includeListQuery);

  const excludeListQuery = buildBulkListQuery(
    filter.excludeList,
    filter.excludeListNamesOnly,
    true
  );
  if (excludeListQuery) andFilters.push(excludeListQuery);

  if (andFilters.length === 0) return {};
  return andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
}
