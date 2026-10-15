import { buildSynonymGroups, type SynonymGroups } from "@/lib/people/text-synonyms";
import {
  DEPARTMENT_STATIC_ALIASES,
  INDUSTRY_STATIC_ALIASES,
  JOB_TITLE_STATIC_ALIASES,
} from "@/lib/people/alias-pool";

export type AliasOverrides = {
  jobTitle?: Record<string, string[]>;
  department?: Record<string, string[]>;
  industry?: Record<string, string[]>;
};

export function buildJobTitleSynonymGroups(
  titles: string[],
  overrides?: AliasOverrides
): SynonymGroups {
  return buildSynonymGroups(titles, overrides?.jobTitle ?? JOB_TITLE_STATIC_ALIASES);
}

export function buildIndustrySynonymGroups(
  industries: string[],
  overrides?: AliasOverrides
): SynonymGroups {
  return buildSynonymGroups(industries, overrides?.industry ?? INDUSTRY_STATIC_ALIASES);
}

export function buildDepartmentSynonymGroups(
  departments: string[],
  overrides?: AliasOverrides
): SynonymGroups {
  return buildSynonymGroups(departments, overrides?.department ?? DEPARTMENT_STATIC_ALIASES);
}

export function mergeOptionLists(baseOptions: string[], corpus: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  const add = (option: string) => {
    const key = option.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(option.trim());
  };

  corpus.forEach(add);
  baseOptions.forEach(add);
  return merged;
}
