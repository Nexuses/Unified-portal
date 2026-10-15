"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Calendar,
  Download,
  ExternalLink,
  Globe,
  Link2,
  Mail,
  MapPin,
  Phone,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { formatStoredRevenue } from "@/app/components/portal/crm/people/revenue-options";
import { EMPTY_COMPANY_FILTER } from "@/lib/people/data-browser/types";
import { splitTechnologies } from "@/lib/people/technologies";
import type { DataRecordRow } from "./data-record-columns";

export type ProfileDetailKind = "person" | "company";

type DataRecordProfileDrawerProps = {
  open: boolean;
  row: DataRecordRow | null;
  kind: ProfileDetailKind;
  onClose: () => void;
  onExport?: () => void;
  exporting?: boolean;
  onOpenPerson?: (row: DataRecordRow) => void;
  onOpenCompany?: (row: DataRecordRow) => void;
};

type TabId = "profile" | "overview" | "employees";

function fullName(row: DataRecordRow) {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
}

function websiteHref(value?: string) {
  if (!value?.trim()) return "";
  return value.startsWith("http") ? value : `https://${value}`;
}

function InitialAvatar({
  label,
  size = "lg",
  rounded = "full",
}: {
  label: string;
  size?: "sm" | "md" | "lg";
  rounded?: "full" | "md";
}) {
  const initial = (label.trim().charAt(0) || "?").toUpperCase();
  const sizeClass =
    size === "lg" ? "h-16 w-16 text-2xl" : size === "md" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-semibold ${sizeClass} ${
        rounded === "full"
          ? "rounded-full bg-slate-200 text-slate-700"
          : "rounded-lg bg-slate-900 text-white"
      }`}
    >
      {initial}
    </span>
  );
}

function ExternalTextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function TagList({ items, empty = "—" }: { items: string[]; empty?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function buildAboutPerson(row: DataRecordRow) {
  const name = fullName(row) || "This contact";
  const title = row.title?.trim();
  const company = row.company_name?.trim();
  const location = row.contact_country?.trim() || row.company_country?.trim();
  const industry = row.industry?.trim();
  const parts: string[] = [];

  if (title && company) {
    parts.push(`${name} is ${title} at ${company}.`);
  } else if (title) {
    parts.push(`${name} works as ${title}.`);
  } else if (company) {
    parts.push(`${name} is associated with ${company}.`);
  } else {
    parts.push(`${name} is a contact in your dataset.`);
  }

  if (location) parts.push(`Based in ${location}.`);
  if (industry) parts.push(`Industry focus: ${industry}.`);
  if (row.seniority?.trim()) parts.push(`Seniority: ${row.seniority.trim()}.`);
  if (row.departments?.trim()) parts.push(`Departments: ${row.departments.trim()}.`);

  return parts.join(" ");
}

function buildAboutCompany(row: DataRecordRow) {
  const company = row.company_name?.trim() || "This company";
  const industry = row.industry?.trim();
  const employees = row.employees?.trim();
  const revenue = row.annual_revenue?.trim()
    ? formatStoredRevenue(row.annual_revenue)
    : "";
  const location =
    row.company_address?.trim() ||
    row.company_country?.trim() ||
    row.contact_country?.trim();
  const parts: string[] = [];

  if (industry) {
    parts.push(`${company} operates in ${industry}.`);
  } else {
    parts.push(`${company} is an organization in your dataset.`);
  }
  if (employees) parts.push(`Employee range: ${employees}.`);
  if (revenue) parts.push(`Annual revenue: ${revenue}.`);
  if (location) parts.push(`Headquarters / location: ${location}.`);
  if (row.website?.trim()) parts.push(`Website: ${row.website.trim()}.`);

  return parts.join(" ");
}

async function fetchCompanyPeople(companyName: string): Promise<DataRecordRow[]> {
  const companyFilter = {
    ...EMPTY_COMPANY_FILTER,
    include: [{ name: companyName }],
  };
  const params = new URLSearchParams({
    page: "1",
    limit: "12",
    view: "people",
    stat: "total",
    filters: "{}",
    companyFilter: JSON.stringify(companyFilter),
  });
  const res = await fetch(`/api/crm/enrich/people?includeFacets=0&includeCounts=0&${params.toString()}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) return [];
  return Array.isArray(data.records) ? (data.records as DataRecordRow[]) : [];
}

function ContactProfileBody({
  row,
  onOpenCompany,
  onExport,
  exporting,
}: {
  row: DataRecordRow;
  onOpenCompany?: (row: DataRecordRow) => void;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const name = fullName(row) || "Unknown contact";
  const website = websiteHref(row.website);
  const linkedIn = websiteHref(row.person_linkedin_url);
  const companyLinkedIn = websiteHref(row.company_linkedin_url);
  const location =
    [row.contact_country, row.company_country].filter(Boolean).join(" · ") ||
    row.company_address ||
    "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4 border-b border-slate-200 pb-5">
        <InitialAvatar label={name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-slate-900">{name}</h2>
          {row.title ? (
            <p className="mt-1 text-sm text-slate-600">{row.title}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {row.company_name ? (
              <button
                type="button"
                onClick={() => onOpenCompany?.(row)}
                className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:underline"
              >
                <InitialAvatar label={row.company_name} size="sm" rounded="md" />
                {row.company_name}
              </button>
            ) : null}
            {linkedIn ? (
              <ExternalTextLink href={linkedIn}>
                <Link2 className="h-3.5 w-3.5" />
                LinkedIn
              </ExternalTextLink>
            ) : null}
            {companyLinkedIn ? (
              <ExternalTextLink href={companyLinkedIn}>
                <Link2 className="h-3.5 w-3.5" />
                Company LinkedIn
              </ExternalTextLink>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
            {website ? (
              <ExternalTextLink href={website}>
                <Globe className="h-3.5 w-3.5" />
                {row.website}
              </ExternalTextLink>
            ) : null}
            {location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {location}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Emails &amp; phone numbers
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="font-medium text-slate-800">
                  {row.email?.trim() || "No email on file"}
                </p>
                {row.email_status ? (
                  <p className="text-xs capitalize text-slate-500">
                    Status: {row.email_status}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="text-xs text-slate-500">Personal phone</p>
                <p className="font-medium text-slate-800">
                  {row.personal_phone?.trim() || "Not available"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="text-xs text-slate-500">Company phone (HQ)</p>
                <p className="font-medium text-slate-800">
                  {row.company_phone?.trim() || "Not available"}
                </p>
              </div>
            </div>
          </div>
          {onExport ? (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-(--purple) text-white hover:bg-[#5b2fd0] disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export"}
            </button>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Location</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="text-xs text-slate-500">Contact</p>
                <p className="text-slate-800">
                  {row.contact_country?.trim() || "—"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="text-xs text-slate-500">HQ</p>
                <p className="text-slate-800">
                  {row.company_address?.trim() ||
                    row.company_country?.trim() ||
                    "—"}
                </p>
              </div>
            </div>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">About</h3>
          <p className="text-sm leading-relaxed text-slate-600">
            {buildAboutPerson(row)}
          </p>
        </section>
      </div>
    </div>
  );
}

function CompanyProfileBody({
  row,
  tab,
  people,
  peopleLoading,
  onOpenPerson,
  onExport,
  exporting,
}: {
  row: DataRecordRow;
  tab: TabId;
  people: DataRecordRow[];
  peopleLoading: boolean;
  onOpenPerson?: (row: DataRecordRow) => void;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const company = row.company_name?.trim() || "Unknown company";
  const website = websiteHref(row.website);
  const linkedIn = websiteHref(row.company_linkedin_url);
  const industries = row.industry
    ? row.industry.split(/[,|;]/).map((part) => part.trim()).filter(Boolean)
    : [];
  const products = splitTechnologies(row.technologies ?? "");
  const location =
    row.company_address?.trim() ||
    row.company_country?.trim() ||
    row.contact_country?.trim() ||
    "";
  const revenue = row.annual_revenue?.trim()
    ? formatStoredRevenue(row.annual_revenue)
    : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4 border-b border-slate-200 pb-5">
        <InitialAvatar label={company} rounded="md" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-slate-900">{company}</h2>
          {website ? (
            <div className="mt-1">
              <ExternalTextLink href={website}>{row.website}</ExternalTextLink>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
            {linkedIn ? (
              <ExternalTextLink href={linkedIn}>
                <Link2 className="h-3.5 w-3.5" />
                LinkedIn
              </ExternalTextLink>
            ) : null}
            {location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {location}
              </span>
            ) : null}
            {row.industry ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {row.industry}
              </span>
            ) : null}
            {row.employees ? (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {row.employees}
              </span>
            ) : null}
            {revenue ? (
              <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                {revenue}
              </span>
            ) : null}
          </div>
        </div>
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export"}
          </button>
        ) : null}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Company details
            </h3>
            <p className="mb-4 text-sm leading-relaxed text-slate-600">
              {buildAboutCompany(row)}
            </p>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <Phone className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-500">HQ phone</p>
                  <p className="font-medium text-slate-800">
                    {row.company_phone?.trim() || "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Globe className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-500">Website</p>
                  <p className="font-medium text-slate-800">
                    {row.website?.trim() || "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-500">Date</p>
                  <p className="font-medium text-slate-800">
                    {row.data_date?.trim() || "—"}
                  </p>
                </div>
              </div>
            </div>

            <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-900">
              Industries
            </h4>
            <TagList items={industries} empty="No industry listed" />

            <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-900">
              Products &amp; technologies
            </h4>
            <TagList items={products} empty="No technologies listed" />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Top executives
            </h3>
            {peopleLoading ? (
              <p className="text-sm text-slate-500">Loading people…</p>
            ) : people.length === 0 ? (
              <p className="text-sm text-slate-500">
                No people found for this company in your data.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {people.slice(0, 8).map((person) => {
                  const personName = fullName(person) || "Unknown";
                  return (
                    <li
                      key={person.id}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <InitialAvatar label={personName} size="md" />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenPerson?.(person)}
                          className="truncate text-sm font-medium text-blue-700 hover:underline"
                        >
                          {personName}
                        </button>
                        <p className="truncate text-xs text-slate-500">
                          {person.title || "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-slate-400">
                        {person.email ? (
                          <span title={person.email}>
                            <Mail className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                        {person.company_phone || person.personal_phone ? (
                          <Phone className="h-3.5 w-3.5" />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {tab === "employees" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Employees</h3>
          {peopleLoading ? (
            <p className="text-sm text-slate-500">Loading people…</p>
          ) : people.length === 0 ? (
            <p className="text-sm text-slate-500">
              No employees found for this company in your data.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {people.map((person) => {
                const personName = fullName(person) || "Unknown";
                return (
                  <li
                    key={person.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <InitialAvatar label={personName} size="md" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenPerson?.(person)}
                        className="truncate text-sm font-medium text-blue-700 hover:underline"
                      >
                        {personName}
                      </button>
                      <p className="truncate text-xs text-slate-500">
                        {[person.title, person.email].filter(Boolean).join(" · ") ||
                          "—"}
                      </p>
                    </div>
                    <div className="hidden text-right text-xs text-slate-500 sm:block">
                      {person.contact_country || person.seniority || ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default function DataRecordProfileDrawer({
  open,
  row,
  kind,
  onClose,
  onExport,
  exporting,
  onOpenPerson,
  onOpenCompany,
}: DataRecordProfileDrawerProps) {
  const [tab, setTab] = useState<TabId>(
    kind === "company" ? "overview" : "profile"
  );
  const [people, setPeople] = useState<DataRecordRow[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  useEffect(() => {
    setTab(kind === "company" ? "overview" : "profile");
  }, [kind, row?.id]);

  useEffect(() => {
    if (!open || !row || kind !== "company") {
      setPeople([]);
      return;
    }
    const companyName = row.company_name?.trim();
    if (!companyName) {
      setPeople([]);
      return;
    }

    let cancelled = false;
    setPeopleLoading(true);
    void fetchCompanyPeople(companyName)
      .then((records) => {
        if (!cancelled) setPeople(records);
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, kind, row?.id, row?.company_name]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const companyTabs: Array<{ id: TabId; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "employees", label: "Employees" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/35"
        aria-label="Close profile"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-4xl flex-col bg-[#f4f5f7] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <p className="text-sm font-semibold text-slate-800">
            {kind === "company" ? "Company profile" : "Contact profile"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {kind === "company" ? (
          <div className="border-b border-slate-200 bg-white px-5">
            <div className="flex gap-4">
              {companyTabs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`border-b-2 px-1 py-3 text-sm font-medium transition ${
                    tab === entry.id
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-b border-slate-200 bg-white px-5">
            <div className="border-b-2 border-blue-600 px-1 py-3 text-sm font-medium text-blue-700">
              Contact Profile
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {kind === "person" ? (
            <ContactProfileBody
              row={row}
              onOpenCompany={onOpenCompany}
              onExport={onExport}
              exporting={exporting}
            />
          ) : (
            <CompanyProfileBody
              row={row}
              tab={tab === "profile" ? "overview" : tab}
              people={people}
              peopleLoading={peopleLoading}
              onOpenPerson={onOpenPerson}
              onExport={onExport}
              exporting={exporting}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
