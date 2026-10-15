import type { IndustryKeywordsFilter } from "@/lib/people/data-browser/types";
import {
  buildIndustrySynonymGroups,
  type AliasOverrides,
} from "@/lib/people/field-synonyms";
import {
  buildSynonymMatchRegex,
  dedupeSynonymQueryTerms,
  type SynonymGroups,
} from "@/lib/people/text-synonyms";

export type IndustryKeywordsFilterPayload = IndustryKeywordsFilter;

export type IndustryKeywordsFilterContext = {
  industries?: string[];
  aliasOverrides?: AliasOverrides;
};

function regexMatch(field: string, value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { [field]: buildSynonymMatchRegex(trimmed) };
}

function combineOr(queries: Record<string, unknown>[]) {
  if (queries.length === 0) return null;
  return queries.length === 1 ? queries[0] : { $or: queries };
}

function buildIndustryMatchQuery(industry: string) {
  return regexMatch("industry", industry);
}

function buildIndustriesIncludeQuery(industries: string[], industrySynonyms?: SynonymGroups) {
  const expanded = dedupeSynonymQueryTerms(
    industrySynonyms ? industrySynonyms.expandAliasesOnly(industries) : industries
  ).slice(0, 48);
  const queries = expanded
    .map((industry) => buildIndustryMatchQuery(industry))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (queries.length === 0) return null;
  return combineOr(queries);
}

function buildIndustriesExcludeQuery(industries: string[], industrySynonyms?: SynonymGroups) {
  const expanded = dedupeSynonymQueryTerms(
    industrySynonyms ? industrySynonyms.expandAliasesOnly(industries) : industries
  ).slice(0, 48);
  const queries = expanded
    .map((industry) => buildIndustryMatchQuery(industry))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (queries.length === 0) return null;
  const combined = combineOr(queries);
  return combined ? { $nor: [combined] } : null;
}

function buildKnownIndustryQuery() {
  return { industry: { $exists: true, $regex: /\S/ } };
}

function buildUnknownIndustryQuery() {
  return {
    $or: [{ industry: { $exists: false } }, { industry: "" }, { industry: { $regex: /^\s*$/ } }],
  };
}

function keywordSearchFields(filter: IndustryKeywordsFilter) {
  const fields: string[] = [];
  if (filter.searchName) fields.push("company_name");
  if (filter.searchKeywords) fields.push("technologies", "industry");
  if (filter.searchCompanyDescription) fields.push("technologies", "company_address");
  return fields;
}

function buildKeywordQuery(keyword: string, fields: string[]) {
  const queries = fields
    .map((field) => regexMatch(field, keyword))
    .filter((query): query is Record<string, unknown> => Boolean(query));
  return combineOr(queries);
}

function buildIncludeKeywordsQuery(
  filter: IndustryKeywordsFilter,
  industrySynonyms?: SynonymGroups
) {
  if (!filter.includeKeywordsEnabled || filter.keywords.length === 0) return null;

  const fields = keywordSearchFields(filter);
  if (fields.length === 0) return null;

  const expandedKeywords = dedupeSynonymQueryTerms(
    industrySynonyms ? industrySynonyms.expandAliasesOnly(filter.keywords) : filter.keywords
  ).slice(0, 48);

  const keywordQueries = expandedKeywords
    .map((keyword) => buildKeywordQuery(keyword, fields))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (keywordQueries.length === 0) return null;
  return filter.includeAllKeywords
    ? { $and: keywordQueries }
    : combineOr(keywordQueries);
}

function buildExcludeKeywordsQuery(
  filter: IndustryKeywordsFilter,
  industrySynonyms?: SynonymGroups
) {
  if (!filter.excludeKeywordsEnabled || filter.excludeKeywords.length === 0) return null;

  const fields = keywordSearchFields(filter);
  if (fields.length === 0) return null;

  const expandedKeywords = dedupeSynonymQueryTerms(
    industrySynonyms
      ? industrySynonyms.expandAliasesOnly(filter.excludeKeywords)
      : filter.excludeKeywords
  ).slice(0, 48);

  const keywordQueries = expandedKeywords
    .map((keyword) => buildKeywordQuery(keyword, fields))
    .filter((query): query is Record<string, unknown> => Boolean(query));

  if (keywordQueries.length === 0) return null;
  const combined = combineOr(keywordQueries);
  return combined ? { $nor: [combined] } : null;
}

export function buildIndustryKeywordsFilterQuery(
  filter: IndustryKeywordsFilter,
  context: IndustryKeywordsFilterContext = {}
) {
  const industrySynonyms = buildIndustrySynonymGroups(
    [],
    context.aliasOverrides
  );
  const andFilters: Record<string, unknown>[] = [];

  if (filter.advancedMode === "is_not_any_of") {
    const excludeSelectedQuery = buildIndustriesExcludeQuery(
      filter.industries,
      industrySynonyms
    );
    if (excludeSelectedQuery) andFilters.push(excludeSelectedQuery);
  } else {
    const includeIndustriesQuery = buildIndustriesIncludeQuery(
      filter.industries,
      industrySynonyms
    );
    if (includeIndustriesQuery) andFilters.push(includeIndustriesQuery);
  }

  if (filter.advancedMode === "is_known") {
    andFilters.push(buildKnownIndustryQuery());
  } else if (filter.advancedMode === "is_unknown") {
    andFilters.push(buildUnknownIndustryQuery());
  }

  const excludeQuery = buildIndustriesExcludeQuery(filter.excludeIndustries, industrySynonyms);
  if (excludeQuery) andFilters.push(excludeQuery);

  const includeKeywordsQuery = buildIncludeKeywordsQuery(filter, industrySynonyms);
  if (includeKeywordsQuery) andFilters.push(includeKeywordsQuery);

  const excludeKeywordsQuery = buildExcludeKeywordsQuery(filter, industrySynonyms);
  if (excludeKeywordsQuery) andFilters.push(excludeKeywordsQuery);

  if (andFilters.length === 0) return {};
  return andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
}
