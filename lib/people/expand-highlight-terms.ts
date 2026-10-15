import type { IndustryKeywordsFilter, JobTitleFilter } from "@/lib/people/data-browser/types";
import {
  buildDepartmentSynonymGroups,
  buildIndustrySynonymGroups,
  buildJobTitleSynonymGroups,
} from "@/lib/people/field-synonyms";

export interface ExpandedHighlights {
  title: string[];
  departments: string[];
  industry: string[];
}

export function buildExpandedHighlights(params: {
  jobTitleFilter: JobTitleFilter | null;
  industryKeywordsFilter: IndustryKeywordsFilter | null;
  titleCorpus: string[];
  departmentCorpus: string[];
  industryCorpus: string[];
  aliasOverrides?: {
    jobTitle?: Record<string, string[]>;
    department?: Record<string, string[]>;
    industry?: Record<string, string[]>;
  };
}): ExpandedHighlights {
  const titleTerms = [
    ...(params.jobTitleFilter?.include ?? []),
    ...(params.jobTitleFilter?.pastTitlesInclude ?? []),
  ];
  const departmentTerms = params.jobTitleFilter?.departments ?? [];
  const industryTerms = [
    ...(params.industryKeywordsFilter?.industries ?? []),
    ...(params.industryKeywordsFilter?.includeKeywordsEnabled
      ? (params.industryKeywordsFilter?.keywords ?? [])
      : []),
  ];

  const titleGroups = buildJobTitleSynonymGroups(
    params.titleCorpus,
    params.aliasOverrides
  );
  const departmentGroups = buildDepartmentSynonymGroups(
    params.departmentCorpus,
    params.aliasOverrides
  );
  const industryGroups = buildIndustrySynonymGroups(
    params.industryCorpus,
    params.aliasOverrides
  );

  return {
    title:
      params.jobTitleFilter?.exactMatch || !params.jobTitleFilter?.includeSimilar
        ? titleTerms
        : titleGroups.expandAliasesOnly(titleTerms),
    departments: departmentGroups.expandAliasesOnly(departmentTerms),
    industry: industryGroups.expandAliasesOnly(industryTerms),
  };
}
