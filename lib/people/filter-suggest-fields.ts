export const FILTER_SUGGEST_FIELDS = {
  company: "company_name",
  title: "title",
  department: "departments",
  industry: "industry",
  contactLocation: "contact_country",
  accountHq: "company_country",
} as const;

export type FilterSuggestField = keyof typeof FILTER_SUGGEST_FIELDS;
