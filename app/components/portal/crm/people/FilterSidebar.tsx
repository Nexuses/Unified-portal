"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { getFilterSectionsForView } from "@/app/components/portal/crm/people/filter-sections";
import { isPhoneFilterActive } from "@/app/components/portal/crm/people/PhoneFilter";

const JobTitlesFilter = dynamic(() => import("@/app/components/portal/crm/people/JobTitlesFilter"), {
  loading: () => null,
});
const CompanyFilterPanel = dynamic(() => import("@/app/components/portal/crm/people/CompanyFilter"), {
  loading: () => null,
});
const LocationFilterPanel = dynamic(() => import("@/app/components/portal/crm/people/LocationFilter"), {
  loading: () => null,
});
const EmployeesFilterPanel = dynamic(() => import("@/app/components/portal/crm/people/EmployeesFilter"), {
  loading: () => null,
});
const IndustryKeywordsFilterPanel = dynamic(
  () => import("@/app/components/portal/crm/people/IndustryKeywordsFilter"),
  { loading: () => null }
);
const TechnologiesFilterPanel = dynamic(
  () => import("@/app/components/portal/crm/people/TechnologiesFilter"),
  { loading: () => null }
);
const RevenueFilterPanel = dynamic(() => import("@/app/components/portal/crm/people/RevenueFilter"), {
  loading: () => null,
});
const EmailStatusFilterPanel = dynamic(
  () => import("@/app/components/portal/crm/people/EmailStatusFilter"),
  { loading: () => null }
);
const PhoneFilterPanel = dynamic(() => import("@/app/components/portal/crm/people/PhoneFilter"), {
  loading: () => null,
});
const PeopleLookalikesFilterPanel = dynamic(
  () => import("@/app/components/portal/crm/people/PeopleLookalikesFilter"),
  { loading: () => null }
);
import {
  companyFilterCount,
  employeesFilterCount,
  industryKeywordsFilterCount,
  technologiesFilterCount,
  revenueFilterCount,
  jobTitleFilterCount,
  locationFilterCount,
  peopleLookalikesFilterCount,
  type ActiveFilterTag,
  type CompanyFilter,
  type CompanyFilterTag,
  type CompanyFilterTagField,
  type EmployeesFilter,
  type EmployeesFilterTag,
  type EmployeesFilterTagField,
  type IndustryKeywordsFilter,
  type IndustryKeywordsFilterTag,
  type IndustryKeywordsFilterTagField,
  type TechnologiesFilter,
  type TechnologiesFilterTag,
  type TechnologiesFilterTagField,
  type RevenueFilter,
  type RevenueFilterTag,
  type RevenueFilterTagField,
  type FilterKey,
  type JobTitleFilter,
  type JobTitleFilterTag,
  type JobTitleFilterTagField,
  type LocationFilter,
  type LocationFilterTag,
  type LocationFilterTagField,
  type PeopleLookalikesFilter,
  type PeopleLookalikesFilterTag,
  type StatTab,
} from "@/lib/people/data-browser/types";
import type { PeopleSuggestionRecord } from "@/app/components/portal/crm/people/people-lookalike-suggestions";
import type { DataView } from "@/lib/people/data-views";

interface FilterSidebarProps {
  view: DataView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeStat: StatTab;
  stats: { total: number; netNew: number; saved: number };
  onStatChange: (stat: StatTab) => void;
  activeTags: ActiveFilterTag[];
  jobTitleTags: JobTitleFilterTag[];
  peopleLookalikesTags: PeopleLookalikesFilterTag[];
  companyFilter: CompanyFilter;
  companyTags: CompanyFilterTag[];
  locationFilter: LocationFilter;
  locationTags: LocationFilterTag[];
  employeesFilter: EmployeesFilter;
  employeesTags: EmployeesFilterTag[];
  industryKeywordsFilter: IndustryKeywordsFilter;
  industryKeywordsTags: IndustryKeywordsFilterTag[];
  technologiesFilter: TechnologiesFilter;
  technologiesTags: TechnologiesFilterTag[];
  revenueFilter: RevenueFilter;
  revenueTags: RevenueFilterTag[];
  employeeRangeCounts: Record<string, number>;
  totalActiveFilters: number;
  facets: Record<string, string[]>;
  facetCounts: Record<string, Record<string, number>>;
  selectedFilters: Partial<Record<FilterKey, string[]>>;
  openSections: Partial<Record<FilterKey, boolean>>;
  onToggleSection: (section: FilterKey) => void;
  onToggleFilterValue: (section: FilterKey, value: string) => void;
  onSetSearchFilter: (section: FilterKey, value: string) => void;
  jobTitleFilter: JobTitleFilter;
  onJobTitleFilterChange: (next: JobTitleFilter) => void;
  onRemoveJobTitleTag: (field: JobTitleFilterTagField, value: string) => void;
  peopleLookalikesFilter: PeopleLookalikesFilter;
  peopleSuggestions?: PeopleSuggestionRecord[];
  onPeopleLookalikesFilterChange: (next: PeopleLookalikesFilter) => void;
  onRemovePeopleLookalikesTag: (field: PeopleLookalikesFilterTag["field"]) => void;
  onCompanyFilterChange: (next: CompanyFilter) => void;
  onRemoveCompanyTag: (field: CompanyFilterTagField, value: string) => void;
  onLocationFilterChange: (next: LocationFilter) => void;
  onRemoveLocationTag: (field: LocationFilterTagField, value: string) => void;
  onEmployeesFilterChange: (next: EmployeesFilter) => void;
  onRemoveEmployeesTag: (field: EmployeesFilterTagField, value: string) => void;
  onIndustryKeywordsFilterChange: (next: IndustryKeywordsFilter) => void;
  onRemoveIndustryKeywordsTag: (field: IndustryKeywordsFilterTagField, value: string) => void;
  onTechnologiesFilterChange: (next: TechnologiesFilter) => void;
  onRemoveTechnologiesTag: (field: TechnologiesFilterTagField, value: string) => void;
  onRevenueFilterChange: (next: RevenueFilter) => void;
  onRemoveRevenueTag: (field: RevenueFilterTagField, value: string) => void;
  onEmailStatusChange: (values: string[]) => void;
  onPersonalPhoneChange: (values: string[]) => void;
  onCompanyPhoneChange: (values: string[]) => void;
  managementLevelCounts: Record<string, number>;
  onClearAll: () => void;
  /** Rendered under the stats tabs when the sidebar is expanded. */
  aiAssist?: ReactNode;
}

function FilterSearchInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (draft.trim() !== value.trim()) {
        onChange(draft.trim());
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [draft, value, onChange]);

  return (
    <input
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder ?? "Filter search"}
      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
    />
  );
}

export default function FilterSidebar({
  view,
  collapsed,
  onToggleCollapsed,
  activeStat,
  stats,
  onStatChange,
  activeTags,
  jobTitleTags,
  peopleLookalikesTags,
  companyFilter,
  companyTags,
  locationFilter,
  locationTags,
  employeesFilter,
  employeesTags,
  industryKeywordsFilter,
  industryKeywordsTags,
  technologiesFilter,
  technologiesTags,
  revenueFilter,
  revenueTags,
  employeeRangeCounts,
  totalActiveFilters,
  facets,
  facetCounts,
  selectedFilters,
  openSections,
  onToggleSection,
  onToggleFilterValue,
  onSetSearchFilter,
  jobTitleFilter,
  onJobTitleFilterChange,
  onRemoveJobTitleTag,
  peopleLookalikesFilter,
  peopleSuggestions = [],
  onPeopleLookalikesFilterChange,
  onRemovePeopleLookalikesTag,
  onCompanyFilterChange,
  onRemoveCompanyTag,
  onLocationFilterChange,
  onRemoveLocationTag,
  onEmployeesFilterChange,
  onRemoveEmployeesTag,
  onIndustryKeywordsFilterChange,
  onRemoveIndustryKeywordsTag,
  onTechnologiesFilterChange,
  onRemoveTechnologiesTag,
  onRevenueFilterChange,
  onRemoveRevenueTag,
  onEmailStatusChange,
  onPersonalPhoneChange,
  onCompanyPhoneChange,
  managementLevelCounts,
  onClearAll,
  aiAssist,
}: FilterSidebarProps) {
  return (
    <aside
      className={`sticky top-6 z-20 flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-[width] duration-200 ease-in-out ${
        collapsed ? "w-14" : "w-80"
      }`}
    >
      <div className="shrink-0 border-b border-slate-100 bg-linear-to-b from-slate-50/80 to-white p-3">
        <div className="mb-3 flex items-center justify-between">
          {!collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="inline-flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm font-semibold text-slate-800 transition hover:text-slate-950"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                <Filter className="h-3.5 w-3.5" />
              </span>
              Hide Filters
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                  totalActiveFilters > 0
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {totalActiveFilters}
              </span>
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={collapsed ? "Expand filters" : "Collapse filters"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
        {!collapsed && (
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Record stats">
            {[
              { label: "Total", key: "total" as StatTab, value: stats.total },
              { label: "Net New", key: "net_new" as StatTab, value: stats.netNew },
              { label: "Saved", key: "saved" as StatTab, value: stats.saved },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeStat === tab.key}
                onClick={() => onStatChange(tab.key)}
                className={`rounded-xl border px-2.5 py-2 text-left text-xs transition ${
                  activeStat === tab.key
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-500/20"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="font-medium">{tab.label}</div>
                <div
                  className={`mt-0.5 text-sm font-semibold tabular-nums ${
                    activeStat === tab.key ? "text-indigo-900" : "text-slate-900"
                  }`}
                >
                  {tab.value.toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
        {!collapsed ? aiAssist : null}
      </div>

      {!collapsed && totalActiveFilters > 0 && (
        <div className="shrink-0 border-b border-slate-100 px-3 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {activeTags.map((tag) => (
              <button
                key={`${tag.key}-${tag.value}`}
                type="button"
                onClick={() => onToggleFilterValue(tag.key, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label ?? tag.value} ×
              </button>
            ))}
            {jobTitleTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveJobTitleTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {peopleLookalikesTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemovePeopleLookalikesTag(tag.field)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {companyTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveCompanyTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {locationTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveLocationTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {employeesTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveEmployeesTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {industryKeywordsTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveIndustryKeywordsTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {technologiesTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveTechnologiesTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
            {revenueTags.map((tag) => (
              <button
                key={`${tag.field}-${tag.value}`}
                type="button"
                onClick={() => onRemoveRevenueTag(tag.field, tag.value)}
                className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                {tag.label} ×
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 overflow-y-auto ${
          collapsed ? "px-1 py-2" : "px-2 py-2 pb-6"
        }`}
      >
        {getFilterSectionsForView(view).map((section) => {
          const options = (facets[section.key] ?? []).filter(Boolean);
          const Icon = section.icon;
          const isJobTitles = section.key === "jobTitles";
          const isPeopleLookalikes = section.key === "peopleLookalikes";
          const isCompany = section.key === "company";
          const isLocation = section.key === "location";
          const isEmployees = section.key === "employees";
          const isIndustryKeywords = section.key === "industryKeywords";
          const isEmailStatus = section.key === "emailStatus";
          const isPersonalPhone = section.key === "personalPhone";
          const isCompanyPhone = section.key === "companyPhone";
          const isTechnologies = section.key === "technologies";
          const isRevenue = section.key === "revenue";
          const selectedCount = isJobTitles
            ? jobTitleFilterCount(jobTitleFilter)
            : isPeopleLookalikes
              ? peopleLookalikesFilterCount(peopleLookalikesFilter)
              : isCompany
                ? companyFilterCount(companyFilter)
                : isLocation
                    ? locationFilterCount(locationFilter)
                    : isEmployees
                      ? employeesFilterCount(employeesFilter)
                      : isIndustryKeywords
                        ? industryKeywordsFilterCount(industryKeywordsFilter)
                        : isTechnologies
                          ? technologiesFilterCount(technologiesFilter)
                          : isRevenue
                            ? revenueFilterCount(revenueFilter)
                            : isPersonalPhone || isCompanyPhone
                              ? isPhoneFilterActive(selectedFilters[section.key])
                                ? 1
                                : 0
                              : (selectedFilters[section.key] ?? []).length;

          if (collapsed) {
            return (
              <button
                key={section.key}
                type="button"
                title={section.label}
                className={`mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-xl transition ${
                  selectedCount > 0
                    ? "bg-indigo-50 text-indigo-600"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          }

          const isOpen = Boolean(openSections[section.key]);

          return (
            <div key={section.key} className="border-b border-slate-100/80 py-0.5 last:border-b-0">
              <button
                type="button"
                onClick={() => onToggleSection(section.key)}
                className={`group flex w-full items-center justify-between rounded-lg px-2 py-2 transition ${
                  isOpen ? "bg-slate-50" : "hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex items-center gap-2.5 text-sm ${
                    selectedCount > 0 ? "font-medium text-slate-900" : "text-slate-700"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 transition ${
                      selectedCount > 0
                        ? "text-indigo-600"
                        : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  />
                  {section.label}
                </span>
                <span className="flex items-center gap-2">
                  {selectedCount > 0 && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-indigo-700 ring-1 ring-indigo-100">
                      {selectedCount}
                    </span>
                  )}
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {isOpen && isJobTitles && (
                <JobTitlesFilter
                  value={jobTitleFilter}
                  onChange={onJobTitleFilterChange}
                  managementLevelCounts={managementLevelCounts}
                  titleOptions={facets.jobTitles ?? []}
                  departmentOptions={facets.departments ?? []}
                  view={view}
                />
              )}
              {isOpen && isPeopleLookalikes && (
                <PeopleLookalikesFilterPanel
                  value={peopleLookalikesFilter}
                  onChange={onPeopleLookalikesFilterChange}
                  suggestions={peopleSuggestions}
                />
              )}
              {isOpen && isCompany && (
                <CompanyFilterPanel
                  value={companyFilter}
                  onChange={onCompanyFilterChange}
                  companyOptions={facets.company ?? options}
                  view={view}
                />
              )}
              {isOpen && isLocation && (
                <LocationFilterPanel
                  value={locationFilter}
                  onChange={onLocationFilterChange}
                  contactOptions={facets.contactLocations ?? facets.location ?? []}
                  accountHqOptions={facets.accountHqLocations ?? facets.location ?? []}
                  view={view}
                />
              )}
              {isOpen && isEmployees && (
                <EmployeesFilterPanel
                  value={employeesFilter}
                  onChange={onEmployeesFilterChange}
                  rangeCounts={employeeRangeCounts}
                />
              )}
              {isOpen && isIndustryKeywords && (
                <IndustryKeywordsFilterPanel
                  value={industryKeywordsFilter}
                  onChange={onIndustryKeywordsFilterChange}
                  industryOptions={facets.industryKeywords ?? []}
                  view={view}
                />
              )}
              {isOpen && isEmailStatus && (
                <EmailStatusFilterPanel
                  value={selectedFilters.emailStatus ?? []}
                  onChange={onEmailStatusChange}
                  statusCounts={facetCounts.emailStatus ?? {}}
                />
              )}
              {isOpen && isPersonalPhone && (
                <PhoneFilterPanel
                  label="Personal phone"
                  value={selectedFilters.personalPhone ?? []}
                  onChange={onPersonalPhoneChange}
                  placeholder="e.g. 555 or +1…"
                />
              )}
              {isOpen && isCompanyPhone && (
                <PhoneFilterPanel
                  label="Company phone"
                  value={selectedFilters.companyPhone ?? []}
                  onChange={onCompanyPhoneChange}
                  placeholder="e.g. 555 or +1…"
                />
              )}
              {isOpen && isTechnologies && (
                <TechnologiesFilterPanel
                  value={technologiesFilter}
                  onChange={onTechnologiesFilterChange}
                  technologyOptions={facets.technologies ?? []}
                  technologyCounts={facetCounts.technologies ?? {}}
                />
              )}
              {isOpen && isRevenue && (
                <RevenueFilterPanel
                  value={revenueFilter}
                  onChange={onRevenueFilterChange}
                />
              )}
              {isOpen && !isJobTitles && !isPeopleLookalikes && !isCompany && !isLocation && !isEmployees && !isIndustryKeywords && !isEmailStatus && !isPersonalPhone && !isCompanyPhone && !isTechnologies && !isRevenue && section.type === "search" && (
                <div className="px-2 pb-2 pt-1">
                  <FilterSearchInput
                    value={(selectedFilters[section.key] ?? [])[0] ?? ""}
                    placeholder={section.placeholder}
                    onChange={(value) => onSetSearchFilter(section.key, value)}
                  />
                </div>
              )}
              {isOpen &&
                !isJobTitles &&
                !isPeopleLookalikes &&
                !isCompany &&
                !isLocation &&
                !isEmployees &&
                !isIndustryKeywords &&
                !isEmailStatus &&
                !isPersonalPhone &&
                !isCompanyPhone &&
                !isTechnologies &&
                !isRevenue &&
                section.type !== "search" && (
                <div className="max-h-36 overflow-y-auto overscroll-contain px-2 pb-2">
                  <div className="space-y-1">
                    {options.length === 0 ? (
                      <div className="text-xs text-slate-400">No options</div>
                    ) : (
                      options.map((value) => (
                        <label
                          key={value}
                          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                        >
                          <input
                            type="checkbox"
                            checked={(selectedFilters[section.key] ?? []).includes(value)}
                            onChange={() => onToggleFilterValue(section.key, value)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>
                            {value} ({facetCounts[section.key]?.[value] ?? 0})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 p-3">
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-white hover:text-slate-900 hover:shadow-xs"
          title={collapsed ? "Clear all filters" : undefined}
        >
          {collapsed
            ? "×"
            : `Clear all${totalActiveFilters > 0 ? ` ${totalActiveFilters}` : ""}`}
        </button>
      </div>
    </aside>
  );
}
