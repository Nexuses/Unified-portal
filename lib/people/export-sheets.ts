import { formatStoredRevenue } from "@/app/components/portal/crm/people/revenue-options";
import {
  DATA_HEADER_LABELS,
  DATA_HEADERS,
  type DataHeader,
} from "@/lib/people/data-headers";

export type ExportSheetType = "internal" | "client";

export const EXPORT_SHEET_TYPES: ExportSheetType[] = ["internal", "client"];

export function isExportSheetType(value: unknown): value is ExportSheetType {
  return value === "internal" || value === "client";
}

/** Client-facing columns in display order (exact header labels). */
export const CLIENT_EXPORT_HEADERS = [
  "Company Name",
  "First Name",
  "Last Name",
  "Title",
  "Email",
  "# Employees",
  "Industry",
  "Person Linkedin Url",
  "Website",
  "Company Linkedin Url",
  "City",
  "Country",
  "Annual Revenue",
] as const;

export type ClientExportHeader = (typeof CLIENT_EXPORT_HEADERS)[number];

export type ExportRecordLike = Partial<Record<DataHeader, string | undefined>> & {
  company_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  employees?: string;
  industry?: string;
  person_linkedin_url?: string;
  website?: string;
  company_linkedin_url?: string;
  company_address?: string;
  company_country?: string;
  contact_country?: string;
  annual_revenue?: string;
};

function cleanCell(value: string | undefined | null): string {
  return (value ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value: string): string {
  const trimmed = cleanCell(value);
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.|linkedin\.com)/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function deriveCity(address: string, country: string): string {
  const parts = cleanCell(address)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const countryLower = country.trim().toLowerCase();
  if (parts.length === 1) {
    if (countryLower && parts[0].toLowerCase() === countryLower) return "";
    return parts[0];
  }

  const last = parts[parts.length - 1];
  if (countryLower && last.toLowerCase().includes(countryLower)) {
    return parts[parts.length - 2] || "";
  }

  // Prefer a middle segment over a long street line when possible
  if (parts.length >= 3) {
    return parts[parts.length - 2];
  }
  return parts[0];
}

function deriveCountry(record: ExportRecordLike): string {
  return (
    cleanCell(record.company_country) ||
    cleanCell(record.contact_country) ||
    ""
  );
}

export function buildInternalExportRows(
  records: ExportRecordLike[]
): { headers: string[]; rows: Record<string, string>[] } {
  const headers = DATA_HEADERS.map((header) => DATA_HEADER_LABELS[header]);
  const rows = records.map((record) => {
    const row: Record<string, string> = {};
    for (const header of DATA_HEADERS) {
      const label = DATA_HEADER_LABELS[header];
      let value = cleanCell(record[header]);
      if (header === "annual_revenue" && value) {
        value = formatStoredRevenue(value);
      }
      if (
        (header === "website" ||
          header === "person_linkedin_url" ||
          header === "company_linkedin_url") &&
        value
      ) {
        value = normalizeUrl(value);
      }
      row[label] = value;
    }
    return row;
  });
  return { headers, rows };
}

export function buildClientExportRows(
  records: ExportRecordLike[]
): { headers: string[]; rows: Record<string, string>[] } {
  const headers = [...CLIENT_EXPORT_HEADERS];
  const rows = records.map((record) => {
    const country = deriveCountry(record);
    const city = deriveCity(cleanCell(record.company_address), country);
    const revenue = cleanCell(record.annual_revenue);
    return {
      "Company Name": cleanCell(record.company_name),
      "First Name": cleanCell(record.first_name),
      "Last Name": cleanCell(record.last_name),
      Title: cleanCell(record.title),
      Email: cleanCell(record.email).toLowerCase(),
      "# Employees": cleanCell(record.employees),
      Industry: cleanCell(record.industry),
      "Person Linkedin Url": normalizeUrl(record.person_linkedin_url ?? ""),
      Website: normalizeUrl(record.website ?? ""),
      "Company Linkedin Url": normalizeUrl(record.company_linkedin_url ?? ""),
      City: city,
      Country: country,
      "Annual Revenue": revenue ? formatStoredRevenue(revenue) : "",
    } satisfies Record<ClientExportHeader, string>;
  });
  return { headers, rows };
}

export function buildExportSheet(
  sheetType: ExportSheetType,
  records: ExportRecordLike[]
) {
  return sheetType === "client"
    ? buildClientExportRows(records)
    : buildInternalExportRows(records);
}

export function exportFilename(
  sheetType: ExportSheetType,
  date = new Date()
): string {
  const stamp = date.toISOString().slice(0, 10);
  return sheetType === "client"
    ? `nexuses-client-export-${stamp}.csv`
    : `nexuses-internal-export-${stamp}.csv`;
}
