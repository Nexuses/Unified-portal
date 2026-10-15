import type { LucideIcon } from "lucide-react";
import { formatRevenueInputLabel } from "@/app/components/portal/crm/people/revenue-options";

export type StatTab = "total" | "net_new" | "saved";

export type FilterKey =
  | "name"
  | "jobTitles"
  | "peopleLookalikes"
  | "company"
  | "companyLookalikes"
  | "location"
  | "employees"
  | "industryKeywords"
  | "emailStatus"
  | "personalPhone"
  | "companyPhone"
  | "technologies"
  | "revenue";

export type FilterSection = {
  key: FilterKey;
  label: string;
  icon: LucideIcon;
  type?: "checkbox" | "search";
  placeholder?: string;
};

export type ActiveFilterTag = {
  key: FilterKey;
  value: string;
  label?: string;
};

export type JobTitleFilter = {
  include: string[];
  includeSimilar: boolean;
  /** When true, title must equal the term exactly (e.g. "Manager" ≠ "HR Manager"). */
  exactMatch: boolean;
  exclude: string[];
  pastTitlesInclude: string[];
  pastTitlesExclude: string[];
  managementLevel: string[];
  departments: string[];
};

export const EMPTY_JOB_TITLE_FILTER: JobTitleFilter = {
  include: [],
  includeSimilar: true,
  exactMatch: false,
  exclude: [],
  pastTitlesInclude: [],
  pastTitlesExclude: [],
  managementLevel: [],
  departments: [],
};

export function jobTitleFilterCount(filter: JobTitleFilter): number {
  return (
    filter.include.length +
    filter.exclude.length +
    filter.pastTitlesInclude.length +
    filter.pastTitlesExclude.length +
    filter.managementLevel.length +
    filter.departments.length
  );
}

export function isJobTitleFilterEmpty(filter: JobTitleFilter): boolean {
  return jobTitleFilterCount(filter) === 0;
}

export type JobTitleFilterTagField =
  | "include"
  | "exclude"
  | "pastTitlesInclude"
  | "pastTitlesExclude"
  | "managementLevel"
  | "departments";

export type JobTitleFilterTag = {
  field: JobTitleFilterTagField;
  value: string;
  label: string;
};

const JOB_TITLE_TAG_LABELS: Record<JobTitleFilterTagField, string> = {
  include: "Include",
  exclude: "Exclude",
  pastTitlesInclude: "Past include",
  pastTitlesExclude: "Past exclude",
  managementLevel: "Level",
  departments: "Dept",
};

export function jobTitleActiveTags(filter: JobTitleFilter): JobTitleFilterTag[] {
  const fields: JobTitleFilterTagField[] = [
    "include",
    "exclude",
    "pastTitlesInclude",
    "pastTitlesExclude",
    "managementLevel",
    "departments",
  ];

  return fields.flatMap((field) =>
    filter[field].map((value) => ({
      field,
      value,
      label: `${JOB_TITLE_TAG_LABELS[field]}: ${value}`,
    }))
  );
}

export type PeopleLookalikeReference = {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  industry?: string;
  linkedInUrl?: string;
};

export type PeopleLookalikesFilter = {
  query: string;
  workUrls: string;
  lookalikeOf?: PeopleLookalikeReference;
};

export const EMPTY_PEOPLE_LOOKALIKES_FILTER: PeopleLookalikesFilter = {
  query: "",
  workUrls: "",
};

export function peopleLookalikesFilterCount(filter: PeopleLookalikesFilter): number {
  let count = 0;
  if (filter.lookalikeOf || filter.query.trim()) count += 1;
  if (filter.workUrls.trim()) count += 1;
  return count;
}

export function isPeopleLookalikesFilterEmpty(filter: PeopleLookalikesFilter): boolean {
  return peopleLookalikesFilterCount(filter) === 0;
}

export type PeopleLookalikesFilterTag = {
  field: "query" | "workUrls";
  value: string;
  label: string;
};

export function peopleLookalikesActiveTags(
  filter: PeopleLookalikesFilter
): PeopleLookalikesFilterTag[] {
  const tags: PeopleLookalikesFilterTag[] = [];

  if (filter.lookalikeOf) {
    const name = `${filter.lookalikeOf.firstName} ${filter.lookalikeOf.lastName}`.trim();
    tags.push({
      field: "query",
      value: name,
      label: `Lookalike: ${name}`,
    });
  } else if (filter.query.trim()) {
    tags.push({
      field: "query",
      value: filter.query.trim(),
      label: `Lookalike: ${filter.query.trim()}`,
    });
  }

  if (filter.workUrls.trim()) {
    tags.push({
      field: "workUrls",
      value: filter.workUrls.trim(),
      label: "Work URLs",
    });
  }

  return tags;
}

export type CompanyFilterMode = "is_any_of" | "is_known" | "is_unknown";

export type CompanyFilterSelection = {
  name: string;
  domain?: string;
};

export type CompanyFilter = {
  mode: CompanyFilterMode;
  include: CompanyFilterSelection[];
  isNotAnyOf: boolean;
  includePastCompany: boolean;
  excludePastCompany: boolean;
  domainExists: boolean;
  includeList: string;
  excludeList: string;
  includeListNamesOnly: boolean;
  excludeListNamesOnly: boolean;
};

export const EMPTY_COMPANY_FILTER: CompanyFilter = {
  mode: "is_any_of",
  include: [],
  isNotAnyOf: false,
  includePastCompany: false,
  excludePastCompany: false,
  domainExists: false,
  includeList: "",
  excludeList: "",
  includeListNamesOnly: false,
  excludeListNamesOnly: false,
};

export function companyFilterCount(filter: CompanyFilter): number {
  let count = 0;
  if (filter.mode === "is_known" || filter.mode === "is_unknown") {
    count += 1;
  } else {
    if (filter.isNotAnyOf && filter.include.length > 0) count += 1;
    count += filter.include.length;
    if (filter.domainExists) count += 1;
    if (filter.includePastCompany && filter.include.length > 0) count += 1;
    if (filter.excludePastCompany && filter.include.length > 0) count += 1;
  }
  if (filter.includeList.trim()) count += 1;
  if (filter.excludeList.trim()) count += 1;
  return count;
}

export function isCompanyFilterEmpty(filter: CompanyFilter): boolean {
  return companyFilterCount(filter) === 0;
}

export function isCompanyFilterActive(filter: CompanyFilter): boolean {
  return !isCompanyFilterEmpty(filter);
}

export type CompanyFilterTagField =
  | "include"
  | "mode"
  | "isNotAnyOf"
  | "domainExists"
  | "includePastCompany"
  | "excludePastCompany"
  | "includeList"
  | "excludeList";

export type CompanyFilterTag = {
  field: CompanyFilterTagField;
  value: string;
  label: string;
};

export function companyActiveTags(filter: CompanyFilter): CompanyFilterTag[] {
  const tags: CompanyFilterTag[] = [];

  if (filter.mode === "is_known") {
    tags.push({ field: "mode", value: "is_known", label: "Company: Is known" });
  } else if (filter.mode === "is_unknown") {
    tags.push({ field: "mode", value: "is_unknown", label: "Company: Is unknown" });
  } else {
    if (filter.isNotAnyOf && filter.include.length > 0) {
      tags.push({ field: "isNotAnyOf", value: "true", label: "Is not any of" });
    }
    filter.include.forEach((selection) => {
      tags.push({
        field: "include",
        value: selection.name,
        label: `Company: ${selection.name}`,
      });
    });
    if (filter.domainExists) {
      tags.push({ field: "domainExists", value: "true", label: "Domain exists" });
    }
    if (filter.includePastCompany && filter.include.length > 0) {
      tags.push({ field: "includePastCompany", value: "true", label: "Include past company" });
    }
    if (filter.excludePastCompany && filter.include.length > 0) {
      tags.push({ field: "excludePastCompany", value: "true", label: "Exclude past company" });
    }
  }

  if (filter.includeList.trim()) {
    tags.push({ field: "includeList", value: filter.includeList.trim(), label: "Include list" });
  }
  if (filter.excludeList.trim()) {
    tags.push({ field: "excludeList", value: filter.excludeList.trim(), label: "Exclude list" });
  }

  return tags;
}

export type LocationFilterTab = "contact" | "account_hq";

export type LocationFilter = {
  tab: LocationFilterTab;
  mode: "select_region";
  include: string[];
  exclude: string[];
};

export const EMPTY_LOCATION_FILTER: LocationFilter = {
  tab: "contact",
  mode: "select_region",
  include: [],
  exclude: [],
};

export function locationFilterCount(filter: LocationFilter): number {
  return filter.include.length + filter.exclude.length;
}

export function isLocationFilterEmpty(filter: LocationFilter): boolean {
  return locationFilterCount(filter) === 0;
}

export type LocationFilterTagField = "include" | "exclude";

export type LocationFilterTag = {
  field: LocationFilterTagField;
  value: string;
  label: string;
};

const LOCATION_TAB_LABELS: Record<LocationFilterTab, string> = {
  contact: "Contact",
  account_hq: "Account HQ",
};

export function locationActiveTags(filter: LocationFilter): LocationFilterTag[] {
  const tabLabel = LOCATION_TAB_LABELS[filter.tab];

  return [
    ...filter.include.map((value) => ({
      field: "include" as const,
      value,
      label: `${tabLabel}: ${value}`,
    })),
    ...filter.exclude.map((value) => ({
      field: "exclude" as const,
      value,
      label: `${tabLabel} exclude: ${value}`,
    })),
  ];
}

export type EmployeesFilterMode = "predefined" | "custom";

export type EmployeesFilter = {
  mode: EmployeesFilterMode;
  predefinedRanges: string[];
  customMin: string;
  customMax: string;
};

export const EMPTY_EMPLOYEES_FILTER: EmployeesFilter = {
  mode: "predefined",
  predefinedRanges: [],
  customMin: "",
  customMax: "",
};

export function employeesFilterCount(filter: EmployeesFilter): number {
  if (filter.mode === "custom") {
    return (filter.customMin.trim() ? 1 : 0) + (filter.customMax.trim() ? 1 : 0);
  }
  return filter.predefinedRanges.length;
}

export function isEmployeesFilterEmpty(filter: EmployeesFilter): boolean {
  return employeesFilterCount(filter) === 0;
}

export type EmployeesFilterTagField = "predefined" | "customMin" | "customMax";

export type EmployeesFilterTag = {
  field: EmployeesFilterTagField;
  value: string;
  label: string;
};

export function employeesActiveTags(filter: EmployeesFilter): EmployeesFilterTag[] {
  if (filter.mode === "custom") {
    const tags: EmployeesFilterTag[] = [];
    if (filter.customMin.trim()) {
      tags.push({
        field: "customMin",
        value: filter.customMin.trim(),
        label: `Employees min: ${filter.customMin.trim()}`,
      });
    }
    if (filter.customMax.trim()) {
      tags.push({
        field: "customMax",
        value: filter.customMax.trim(),
        label: `Employees max: ${filter.customMax.trim()}`,
      });
    }
    return tags;
  }

  return filter.predefinedRanges.map((value) => ({
    field: "predefined" as const,
    value,
    label: `Employees: ${value}`,
  }));
}

export type IndustryAdvancedMode = "is_not_any_of" | "is_known" | "is_unknown";

export type IndustryKeywordsFilter = {
  industries: string[];
  advancedMode: IndustryAdvancedMode | null;
  excludeIndustries: string[];
  includeKeywordsEnabled: boolean;
  keywords: string[];
  searchName: boolean;
  searchKeywords: boolean;
  searchCompanyDescription: boolean;
  includeAllKeywords: boolean;
  excludeKeywordsEnabled: boolean;
  excludeKeywords: string[];
};

export const EMPTY_INDUSTRY_KEYWORDS_FILTER: IndustryKeywordsFilter = {
  industries: [],
  advancedMode: null,
  excludeIndustries: [],
  includeKeywordsEnabled: true,
  keywords: [],
  searchName: true,
  searchKeywords: true,
  searchCompanyDescription: false,
  includeAllKeywords: false,
  excludeKeywordsEnabled: false,
  excludeKeywords: [],
};

export function industryKeywordsFilterCount(filter: IndustryKeywordsFilter): number {
  let count = filter.industries.length;

  if (filter.advancedMode === "is_known" || filter.advancedMode === "is_unknown") {
    count += 1;
  }
  count += filter.excludeIndustries.length;
  if (filter.includeKeywordsEnabled) {
    count += filter.keywords.length;
    if (filter.includeAllKeywords) count += 1;
  }
  if (filter.excludeKeywordsEnabled) {
    count += filter.excludeKeywords.length;
  }

  return count;
}

export function isIndustryKeywordsFilterEmpty(filter: IndustryKeywordsFilter): boolean {
  if (filter.industries.length > 0) return false;
  if (filter.advancedMode === "is_known" || filter.advancedMode === "is_unknown") return false;
  if (filter.excludeIndustries.length > 0) return false;
  if (filter.includeKeywordsEnabled && filter.keywords.length > 0) return false;
  if (filter.excludeKeywordsEnabled && filter.excludeKeywords.length > 0) return false;
  return true;
}

export type IndustryKeywordsFilterTagField =
  | "industries"
  | "excludeIndustries"
  | "advancedMode"
  | "keywords"
  | "excludeKeywords"
  | "includeAllKeywords";

export type IndustryKeywordsFilterTag = {
  field: IndustryKeywordsFilterTagField;
  value: string;
  label: string;
};

const ADVANCED_MODE_LABELS: Record<IndustryAdvancedMode, string> = {
  is_not_any_of: "Industry is not any of",
  is_known: "Industry is known",
  is_unknown: "Industry is unknown",
};

export function industryKeywordsActiveTags(
  filter: IndustryKeywordsFilter
): IndustryKeywordsFilterTag[] {
  const tags: IndustryKeywordsFilterTag[] = [];

  filter.industries.forEach((value) => {
    tags.push({ field: "industries", value, label: `Industry: ${value}` });
  });

  if (filter.advancedMode === "is_known" || filter.advancedMode === "is_unknown") {
    tags.push({
      field: "advancedMode",
      value: filter.advancedMode,
      label: ADVANCED_MODE_LABELS[filter.advancedMode],
    });
  }

  filter.excludeIndustries.forEach((value) => {
    tags.push({
      field: "excludeIndustries",
      value,
      label: `Exclude industry: ${value}`,
    });
  });

  filter.keywords.forEach((value) => {
    tags.push({ field: "keywords", value, label: `Keyword: ${value}` });
  });

  if (filter.includeAllKeywords && filter.keywords.length > 0) {
    tags.push({
      field: "includeAllKeywords",
      value: "all",
      label: "Include ALL keywords",
    });
  }

  filter.excludeKeywords.forEach((value) => {
    tags.push({
      field: "excludeKeywords",
      value,
      label: `Exclude keyword: ${value}`,
    });
  });

  return tags;
}

export type TechnologiesFilter = {
  include: string[];
  includeAll: string[];
  exclude: string[];
};

export const EMPTY_TECHNOLOGIES_FILTER: TechnologiesFilter = {
  include: [],
  includeAll: [],
  exclude: [],
};

export function technologiesFilterCount(filter: TechnologiesFilter): number {
  return filter.include.length + filter.includeAll.length + filter.exclude.length;
}

export function isTechnologiesFilterEmpty(filter: TechnologiesFilter): boolean {
  return technologiesFilterCount(filter) === 0;
}

export type TechnologiesFilterTagField = "include" | "includeAll" | "exclude";

export type TechnologiesFilterTag = {
  field: TechnologiesFilterTagField;
  value: string;
  label: string;
};

const TECHNOLOGIES_TAG_LABELS: Record<TechnologiesFilterTagField, string> = {
  include: "Technology",
  includeAll: "Include ALL",
  exclude: "Exclude technology",
};

export function technologiesActiveTags(filter: TechnologiesFilter): TechnologiesFilterTag[] {
  const fields: TechnologiesFilterTagField[] = ["include", "includeAll", "exclude"];

  return fields.flatMap((field) =>
    filter[field].map((value) => ({
      field,
      value,
      label: `${TECHNOLOGIES_TAG_LABELS[field]}: ${value}`,
    }))
  );
}

export type RevenueFilterMode = "is_between" | "is_known" | "is_unknown";

export type RevenueFilter = {
  mode: RevenueFilterMode;
  min: string;
  max: string;
};

export const EMPTY_REVENUE_FILTER: RevenueFilter = {
  mode: "is_between",
  min: "",
  max: "",
};

export function revenueFilterCount(filter: RevenueFilter): number {
  if (filter.mode === "is_between") {
    return (filter.min.trim() ? 1 : 0) + (filter.max.trim() ? 1 : 0);
  }
  if (filter.mode === "is_known" || filter.mode === "is_unknown") {
    return 1;
  }
  return 0;
}

export function isRevenueFilterEmpty(filter: RevenueFilter): boolean {
  return revenueFilterCount(filter) === 0;
}

export type RevenueFilterTagField = "mode" | "min" | "max";

export type RevenueFilterTag = {
  field: RevenueFilterTagField;
  value: string;
  label: string;
};

const REVENUE_MODE_LABELS: Record<RevenueFilterMode, string> = {
  is_between: "Revenue between",
  is_known: "Revenue is known",
  is_unknown: "Revenue is unknown",
};

export function revenueActiveTags(filter: RevenueFilter): RevenueFilterTag[] {
  const tags: RevenueFilterTag[] = [];

  if (filter.mode === "is_known" || filter.mode === "is_unknown") {
    tags.push({
      field: "mode",
      value: filter.mode,
      label: REVENUE_MODE_LABELS[filter.mode],
    });
  }

  if (filter.mode === "is_between") {
    if (filter.min.trim()) {
      tags.push({
        field: "min",
        value: filter.min.trim(),
        label: `Revenue min: ${formatRevenueInputLabel(filter.min.trim())}`,
      });
    }
    if (filter.max.trim()) {
      tags.push({
        field: "max",
        value: filter.max.trim(),
        label: `Revenue max: ${formatRevenueInputLabel(filter.max.trim())}`,
      });
    }
  }

  return tags;
}
