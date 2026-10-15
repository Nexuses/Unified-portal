import type { DataHeader } from "@/lib/people/data-headers";

export type DataView = "people" | "companies";

export const PEOPLE_COLUMNS = [
  "first_name",
  "last_name",
  "title",
  "company_name",
  "email",
  "email_status",
  "seniority",
  "departments",
  "personal_phone",
  "company_phone",
  "employees",
  "industry",
  "person_linkedin_url",
  "contact_country",
  "website",
  "technologies",
  "company_address",
  "company_linkedin_url",
  "company_country",
  "annual_revenue",
  "data_date",
] as const satisfies readonly DataHeader[];

export const COMPANIES_COLUMNS = [
  "company_name",
  "company_phone",
  "employees",
  "industry",
  "website",
  "technologies",
  "company_address",
  "company_linkedin_url",
  "company_country",
  "annual_revenue",
  "data_date",
] as const satisfies readonly DataHeader[];

export const VIEW_COLUMNS: Record<DataView, readonly DataHeader[]> = {
  people: PEOPLE_COLUMNS,
  companies: COMPANIES_COLUMNS,
};

export const VIEW_SEARCH_FIELDS: Record<DataView, readonly DataHeader[]> = {
  people: ["first_name", "last_name", "email", "title", "departments"],
  companies: [
    "company_name",
    "industry",
    "website",
    "company_country",
    "technologies",
  ],
};

export const VIEW_LABELS: Record<DataView, string> = {
  people: "People",
  companies: "Companies",
};

export const VIEW_SEARCH_PLACEHOLDERS: Record<DataView, string> = {
  people: "Search name, email, title...",
  companies: "Search company, industry, website...",
};

export const VIEW_EMPTY_MESSAGES: Record<DataView, string> = {
  people: "No people records yet. Upload data from the admin panel.",
  companies:
    "No company records yet. Upload people or company data with company fields filled in.",
};

export const PEOPLE_UPLOAD_HEADERS = [
  "first_name",
  "last_name",
  "title",
  "company_name",
  "email",
  "email_status",
  "seniority",
  "departments",
  "personal_phone",
  "company_phone",
  "employees",
  "industry",
  "person_linkedin_url",
  "contact_country",
  "website",
  "technologies",
  "company_address",
  "company_linkedin_url",
  "company_country",
  "annual_revenue",
  "data_date",
] as const satisfies readonly DataHeader[];

export const COMPANIES_UPLOAD_HEADERS = [
  "company_name",
  "company_phone",
  "employees",
  "industry",
  "website",
  "technologies",
  "company_address",
  "company_linkedin_url",
  "company_country",
  "annual_revenue",
  "data_date",
] as const satisfies readonly DataHeader[];

export const VIEW_UPLOAD_HEADERS: Record<DataView, readonly DataHeader[]> = {
  people: PEOPLE_UPLOAD_HEADERS,
  companies: COMPANIES_UPLOAD_HEADERS,
};

export function recordTypeFilter(view: DataView) {
  if (view === "people") {
    return {
      $or: [{ recordType: "people" }, { recordType: { $exists: false } }],
    };
  }

  return {
    company_name: { $ne: "" },
    $or: [
      { recordType: "companies" },
      { recordType: "people" },
      { recordType: { $exists: false } },
    ],
  };
}
