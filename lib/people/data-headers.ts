export const DATA_HEADERS = [
  "job_change",
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
] as const;

export type DataHeader = (typeof DATA_HEADERS)[number];

export const DATA_HEADER_LABELS: Record<DataHeader, string> = {
  job_change: "Job Change",
  first_name: "First Name",
  last_name: "Last Name",
  title: "Title",
  company_name: "Company Name",
  email: "Email",
  email_status: "Email Status",
  seniority: "Seniority",
  departments: "Departments",
  personal_phone: "Personal Phone",
  company_phone: "Company Phone",
  employees: "Employees",
  industry: "Industry",
  person_linkedin_url: "Person LinkedIn URL",
  contact_country: "Contact Country",
  website: "Website",
  technologies: "Technologies",
  company_address: "Company Address",
  company_linkedin_url: "Company LinkedIn URL",
  company_country: "Company Country",
  annual_revenue: "Annual Revenue",
  data_date: "Date",
};

export type HeaderMapping = Record<DataHeader, string | null>;

export type DataRecordFields = Record<DataHeader, string>;

export function emptyDataRecord(): DataRecordFields {
  return Object.fromEntries(DATA_HEADERS.map((h) => [h, ""])) as DataRecordFields;
}

export function normalizeHeaderName(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[#@]+/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const HEADER_ALIASES: Partial<Record<DataHeader, readonly string[]>> = {
  first_name: ["firstname", "first", "fname", "given_name", "givenname"],
  last_name: ["lastname", "last", "lname", "surname", "family_name"],
  title: ["job_title", "jobtitle", "position", "role", "job"],
  company_name: [
    "company",
    "organization",
    "organisation",
    "account",
    "account_name",
    "employer",
  ],
  email: ["work_email", "email_address", "e_mail", "mail"],
  email_status: ["email_verification", "email_quality", "verification_status"],
  seniority: ["management_level", "level", "seniority_level"],
  departments: ["department", "dept", "function"],
  personal_phone: [
    "mobile",
    "mobile_phone",
    "cell",
    "cellphone",
    "direct_phone",
    "phone",
  ],
  company_phone: ["hq_phone", "office_phone", "company_tel", "main_phone"],
  employees: [
    "employee_count",
    "headcount",
    "company_size",
    "num_employees",
    "number_of_employees",
    "size",
  ],
  industry: ["industries", "sector", "vertical"],
  person_linkedin_url: [
    "linkedin",
    "linkedin_url",
    "person_linkedin",
    "profile_linkedin",
  ],
  contact_country: ["country", "person_country", "location_country"],
  website: ["domain", "company_website", "url", "web"],
  technologies: ["tech", "tech_stack", "technology", "keywords"],
  company_address: ["address", "hq_address", "street_address", "location"],
  company_linkedin_url: ["company_linkedin", "org_linkedin"],
  company_country: ["hq_country", "account_country", "org_country"],
  annual_revenue: ["revenue", "company_revenue", "arr", "turnover"],
  data_date: ["date", "as_of", "export_date", "snapshot_date"],
  job_change: ["job_change_detected", "recent_job_change"],
};

export function suggestHeaderMapping(fileHeaders: string[]): HeaderMapping {
  const mapping = {} as HeaderMapping;
  const used = new Set<string>();
  const normalizedFiles = fileHeaders.map((fileHeader) => ({
    original: fileHeader,
    normalized: normalizeHeaderName(fileHeader),
  }));

  for (const fixed of DATA_HEADERS) {
    const normalizedFixed = normalizeHeaderName(fixed);
    const aliases = new Set([
      normalizedFixed,
      normalizedFixed.replace(/_/g, ""),
      ...(HEADER_ALIASES[fixed] ?? []).map((alias) => normalizeHeaderName(alias)),
    ]);

    const match = normalizedFiles.find((entry) => {
      if (used.has(entry.original)) return false;
      return (
        aliases.has(entry.normalized) ||
        aliases.has(entry.normalized.replace(/_/g, ""))
      );
    });

    mapping[fixed] = match?.original ?? null;
    if (match) used.add(match.original);
  }

  return mapping;
}

export function applyHeaderMapping(
  fileHeaders: string[],
  rows: string[][],
  mapping: HeaderMapping
): DataRecordFields[] {
  const headerIndex = new Map(fileHeaders.map((header, index) => [header, index]));

  return rows.map((row) => {
    const record = emptyDataRecord();

    for (const fixed of DATA_HEADERS) {
      const sourceHeader = mapping[fixed];
      if (!sourceHeader) continue;

      const index = headerIndex.get(sourceHeader);
      if (index === undefined) continue;

      record[fixed] = (row[index] ?? "").trim();
    }

    return record;
  });
}
