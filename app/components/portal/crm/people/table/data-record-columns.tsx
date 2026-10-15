"use client";

import { ExternalLink } from "lucide-react";
import { formatStoredRevenue } from "@/app/components/portal/crm/people/revenue-options";
import { DATA_HEADER_LABELS, type DataHeader } from "@/lib/people/data-headers";
import { splitTechnologies } from "@/lib/people/technologies";
import type { DetailSection, EnterpriseColumn } from "./types";

export type DataRecordRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company_name?: string;
  email?: string;
  email_status?: string;
  personal_phone?: string;
  company_phone?: string;
  website?: string;
  person_linkedin_url?: string;
  company_linkedin_url?: string;
  [key: string]: string | undefined;
};

const TECH_BADGE_STYLES = [
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
  "bg-sky-100 text-sky-800",
  "bg-cyan-100 text-cyan-800",
  "bg-emerald-100 text-emerald-800",
  "bg-orange-100 text-orange-800",
  "bg-fuchsia-100 text-fuchsia-800",
  "bg-indigo-100 text-indigo-800",
  "bg-teal-100 text-teal-800",
  "bg-amber-100 text-amber-800",
] as const;

function techBadgeClass(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TECH_BADGE_STYLES[hash % TECH_BADGE_STYLES.length];
}

function CopyableText({ value }: { value: string }) {
  if (!value) return <>—</>;
  return (
    <button
      type="button"
      className="truncate text-left text-blue-700 hover:underline"
      title={`Click to copy: ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value);
      }}
    >
      {value}
    </button>
  );
}

function LinkCell({ value, label }: { value: string; label?: string }) {
  if (!value) return <>—</>;
  const href = value.startsWith("http") ? value : `https://${value}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 truncate text-blue-700 hover:underline"
      onClick={(e) => e.stopPropagation()}
      title={value}
    >
      <span className="truncate">{label || value}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function StatusBadge({ value }: { value: string }) {
  if (!value) return <>—</>;
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
      {value}
    </span>
  );
}

function TechnologiesCell({ value }: { value: string }) {
  const items = splitTechnologies(value);
  if (items.length === 0) return <>—</>;

  const visible = items.slice(0, 2);
  const hidden = items.length - visible.length;

  return (
    <div className="flex min-w-0 items-center gap-1.5" title={items.join(", ")}>
      {visible.map((tech) => (
        <span
          key={tech}
          className={`inline-flex max-w-[9rem] shrink-0 truncate rounded-full px-2.5 py-0.5 text-xs font-medium ${techBadgeClass(tech)}`}
        >
          {tech}
        </span>
      ))}
      {hidden > 0 ? (
        <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
          +{hidden}
        </span>
      ) : null}
    </div>
  );
}

function PersonCell({ row }: { row: DataRecordRow }) {
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "—";
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
        {initial}
      </span>
      <span className="truncate font-medium text-blue-700 hover:underline">
        {name}
      </span>
    </div>
  );
}

function CompanyCell({ value }: { value: string }) {
  if (!value) return <>—</>;
  const initial = value.charAt(0).toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">
        {initial}
      </span>
      <span className="truncate font-medium text-blue-700 hover:underline">
        {value}
      </span>
    </div>
  );
}

export function buildDataRecordColumns(
  headers: readonly DataHeader[]
): EnterpriseColumn<DataRecordRow>[] {
  const hasNamePair =
    headers.includes("first_name") && headers.includes("last_name");

  return headers
    .filter((header) => !(hasNamePair && header === "last_name"))
    .map((header) => {
      const base: EnterpriseColumn<DataRecordRow> = {
        id: header,
        header: DATA_HEADER_LABELS[header],
        accessorFn: (row) => row[header] ?? "",
        size:
          header === "technologies"
            ? 280
            : header === "company_name"
              ? 200
              : 160,
      };

      if (header === "first_name" && hasNamePair) {
        return {
          ...base,
          header: "Person",
          accessorFn: (row) =>
            `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
          cell: (row) => <PersonCell row={row} />,
          size: 220,
          meta: { openDetailOnClick: true, detailKind: "person" },
        };
      }

      if (header === "company_name") {
        return {
          ...base,
          cell: (_row, value) => <CompanyCell value={value} />,
          meta: { copyKind: "company", openDetailOnClick: true, detailKind: "company" },
        };
      }

      if (header === "email") {
        return {
          ...base,
          cell: (_row, value) => <CopyableText value={value} />,
          meta: { copyKind: "email" },
        };
      }

      if (header === "personal_phone" || header === "company_phone") {
        return {
          ...base,
          cell: (_row, value) => <CopyableText value={value} />,
          meta: { copyKind: "phone" },
        };
      }

      if (header === "website") {
        return {
          ...base,
          cell: (_row, value) => <LinkCell value={value} />,
        };
      }

      if (header === "person_linkedin_url" || header === "company_linkedin_url") {
        return {
          ...base,
          cell: (_row, value) => <LinkCell value={value} label="LinkedIn" />,
        };
      }

      if (header === "email_status") {
        return {
          ...base,
          cell: (_row, value) => <StatusBadge value={value} />,
        };
      }

      if (header === "technologies") {
        return {
          ...base,
          cell: (_row, value) => <TechnologiesCell value={value} />,
          meta: { noTruncate: true },
          size: 280,
        };
      }

      if (header === "annual_revenue") {
        return {
          ...base,
          accessorFn: (row) => {
            const raw = row.annual_revenue ?? "";
            return formatStoredRevenue(raw) || raw;
          },
          cell: (row) => {
            const raw = row.annual_revenue ?? "";
            const formatted = formatStoredRevenue(raw) || raw;
            return formatted ? formatted : "—";
          },
        };
      }

      return base;
    });
}

export function dataRecordDetailSections(row: DataRecordRow): DetailSection[] {
  const get = (key: DataHeader) => row[key] ?? "";
  return [
    {
      title: "Contact Information",
      fields: [
        { label: "First Name", value: get("first_name") },
        { label: "Last Name", value: get("last_name") },
        { label: "Title", value: get("title") },
        { label: "Email", value: get("email") },
        { label: "Email Status", value: get("email_status") },
        { label: "Personal Phone", value: get("personal_phone") },
        { label: "Seniority", value: get("seniority") },
        { label: "Departments", value: get("departments") },
      ],
    },
    {
      title: "Company Information",
      fields: [
        { label: "Company", value: get("company_name") },
        { label: "Company Phone", value: get("company_phone") },
        { label: "Industry", value: get("industry") },
        { label: "Employees", value: get("employees") },
        { label: "Annual Revenue", value: (() => {
          const raw = get("annual_revenue");
          return formatStoredRevenue(raw) || raw;
        })() },
        { label: "Website", value: get("website") },
      ],
    },
    {
      title: "Location",
      fields: [
        { label: "Contact Country", value: get("contact_country") },
        { label: "Company Country", value: get("company_country") },
        { label: "Company Address", value: get("company_address") },
      ],
    },
    {
      title: "Technologies",
      fields: [{ label: "Technologies", value: get("technologies") }],
    },
    {
      title: "Social Links",
      fields: [
        { label: "Person LinkedIn", value: get("person_linkedin_url") },
        { label: "Company LinkedIn", value: get("company_linkedin_url") },
      ],
    },
    {
      title: "Additional Metadata",
      fields: [
        { label: "Job Change", value: get("job_change") },
        { label: "Date", value: get("data_date") },
        { label: "Record ID", value: row.id },
      ],
    },
  ];
}
