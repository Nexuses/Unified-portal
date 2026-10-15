"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Info, Minus, Plus, X } from "lucide-react";
import {
  DEPARTMENT_GROUPS,
  JOB_TITLE_SUGGESTIONS,
  MANAGEMENT_LEVELS,
} from "@/app/components/portal/crm/people/job-title-options";
import type { JobTitleFilter } from "@/lib/people/data-browser/types";
import {
  buildDepartmentSynonymGroups,
  buildJobTitleSynonymGroups,
  mergeOptionLists,
  type AliasOverrides,
} from "@/lib/people/field-synonyms";
import type { SynonymGroups } from "@/lib/people/text-synonyms";
import type { DataView } from "@/lib/people/data-views";
import { useFilterSuggest } from "@/lib/people/use-filter-suggest";

interface JobTitlesFilterProps {
  value: JobTitleFilter;
  onChange: (next: JobTitleFilter) => void;
  managementLevelCounts?: Record<string, number>;
  titleOptions?: string[];
  departmentOptions?: string[];
  view: DataView;
}

function JobTitleTagInput({
  values,
  options,
  synonymGroups,
  field,
  view,
  placeholder,
  hint,
  onChange,
}: {
  values: string[];
  options: string[];
  synonymGroups?: SynonymGroups;
  field: "title" | "department";
  view: DataView;
  placeholder?: string;
  hint?: string;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const remoteOptions = useFilterSuggest(field, draft, view);
  const query = draft.trim();
  const filteredOptions = useMemo(() => {
    const merged = mergeOptionLists(options, remoteOptions);
    const available = merged.filter((option) => !values.includes(option));
    if (!query) return available.slice(0, 30);
    if (synonymGroups) {
      const suggested = synonymGroups
        .matchSuggestions(query, 30)
        .filter((option) => !values.includes(option));
      const extras = remoteOptions.filter(
        (option) =>
          !values.includes(option) &&
          !suggested.some((entry) => entry.toLowerCase() === option.toLowerCase())
      );
      return [...suggested, ...extras].slice(0, 30);
    }
    const normalized = query.toLowerCase();
    return available
      .filter((option) => option.toLowerCase().includes(normalized))
      .slice(0, 30);
  }, [options, query, remoteOptions, synonymGroups, values]);

  function addTag(tag: string) {
    const next = tag.trim();
    if (next && !values.includes(next)) {
      onChange([...values, next]);
    }
    setDraft("");
    setOpen(false);
  }

  function removeTag(tag: string) {
    onChange(values.filter((value) => value !== tag));
  }

  function displayTag(tag: string) {
    return synonymGroups?.getDisplayLabel(tag) ?? tag;
  }

  return (
    <div ref={ref}>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
          {values.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
              title={displayTag(tag)}
            >
              {displayTag(tag)}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-blue-500 hover:text-blue-700"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                if (draft.trim()) {
                  addTag(draft);
                } else if (filteredOptions.length > 0) {
                  addTag(filteredOptions[0]);
                }
              } else if (event.key === "Escape") {
                setOpen(false);
              } else if (event.key === "Backspace" && draft.length === 0 && values.length > 0) {
                removeTag(values[values.length - 1]);
              }
            }}
            placeholder={values.length === 0 ? placeholder : ""}
            className="min-w-[6rem] flex-1 border-none bg-transparent pr-6 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label="Toggle job title suggestions"
          >
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        {open && filteredOptions.length > 0 && (
          <div className="mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
            {filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(option)}
                className="block w-full px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function CheckboxFilterSection({
  label,
  options,
  values,
  counts,
  searchPlaceholder,
  defaultOpen = false,
  onChange,
}: {
  label: string;
  options: string[];
  values: string[];
  counts?: Record<string, number>;
  searchPlaceholder?: string;
  defaultOpen?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(defaultOpen || values.length > 0);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filteredOptions = options.filter(
    (option) => query.length === 0 || option.toLowerCase().includes(query)
  );

  function toggle(option: string) {
    onChange(
      values.includes(option)
        ? values.filter((value) => value !== option)
        : [...values, option]
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50"
      >
        <span className={values.length > 0 ? "text-slate-800" : "text-slate-500"}>
          {values.length > 0 ? `${label} (${values.length})` : label}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1 overflow-hidden rounded-md border border-slate-200 bg-white">
          {searchPlaceholder && (
            <div className="border-b border-slate-100 p-1.5">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}
          <div className="max-h-48 space-y-0.5 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-slate-400">No matches</div>
            ) : (
              filteredOptions.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 rounded px-1 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={values.includes(option)}
                    onChange={() => toggle(option)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex-1">{option}</span>
                  <span className="text-slate-400">({counts?.[option] ?? 0})</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DepartmentFilterSection({
  values,
  searchPlaceholder,
  departmentSynonyms,
  onChange,
}: {
  values: string[];
  searchPlaceholder?: string;
  departmentSynonyms?: SynonymGroups;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(values.length > 0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const query = search.trim();
  const normalizedQuery = query.toLowerCase();

  const synonymMatchKeys = useMemo(() => {
    if (!query || !departmentSynonyms) return null;
    return new Set(
      departmentSynonyms
        .matchSuggestions(query, 100)
        .map((match) => match.toLowerCase())
    );
  }, [departmentSynonyms, query]);

  function matchesDepartment(value: string) {
    if (!query) return true;
    if (value.toLowerCase().includes(normalizedQuery)) return true;
    return synonymMatchKeys?.has(value.toLowerCase()) ?? false;
  }

  const filteredGroups = DEPARTMENT_GROUPS.filter(
    (group) =>
      matchesDepartment(group.label) ||
      group.children.some((child) => matchesDepartment(child))
  );

  function toggle(value: string) {
    onChange(
      values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value]
    );
  }

  function toggleExpand(label: string) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50"
      >
        <span className={values.length > 0 ? "text-slate-800" : "text-slate-500"}>
          {values.length > 0
            ? `Departments & Job Function (${values.length})`
            : "Departments & Job Function"}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1 overflow-hidden rounded-md border border-slate-200 bg-white">
          {searchPlaceholder && (
            <div className="border-b border-slate-100 p-1.5">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}
          <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
            {filteredGroups.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-slate-400">No matches</div>
            ) : (
              filteredGroups.map((group) => {
                const isExpanded = Boolean(expanded[group.label]) || query.length > 0;
                const hasChildren = group.children.length > 0;
                return (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 rounded px-1 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={values.includes(group.label)}
                        onChange={() => toggle(group.label)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex-1">{group.label}</span>
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(group.label)}
                          className="text-blue-500 hover:text-blue-700"
                          aria-label={isExpanded ? `Collapse ${group.label}` : `Expand ${group.label}`}
                        >
                          {isExpanded ? (
                            <Minus className="h-3.5 w-3.5" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    {hasChildren && isExpanded && (
                      <div className="ml-5 space-y-0.5 border-l border-slate-100 pl-2">
                        {group.children
                          .filter(
                            (child) =>
                              matchesDepartment(group.label) || matchesDepartment(child)
                          )
                          .map((child) => (
                            <label
                              key={child}
                              className="flex items-center gap-2 rounded px-1 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                checked={values.includes(child)}
                                onChange={() => toggle(child)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="flex-1">{child}</span>
                            </label>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobTitlesFilter({
  value,
  onChange,
  managementLevelCounts,
  titleOptions = [],
  departmentOptions = [],
  view,
}: JobTitlesFilterProps) {
  const [showPast, setShowPast] = useState(
    value.pastTitlesInclude.length > 0 || value.pastTitlesExclude.length > 0
  );

  const titleChoices = useMemo(
    () => mergeOptionLists(JOB_TITLE_SUGGESTIONS, titleOptions),
    [titleOptions]
  );
  const [titleSynonyms, setTitleSynonyms] = useState<SynonymGroups | undefined>();
  const [departmentSynonyms, setDepartmentSynonyms] = useState<
    SynonymGroups | undefined
  >();

  // Build synonym indexes off the open animation path to avoid a UI hitch/blink
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        let overrides: AliasOverrides | undefined;
        try {
          const res = await fetch("/api/crm/enrich/people/dictionaries");
          if (res.ok) {
            const data = (await res.json()) as AliasOverrides;
            overrides = {
              jobTitle: data.jobTitle,
              department: data.department,
              industry: data.industry,
            };
          }
        } catch {
          // Fall back to built-in dictionary
        }
        if (cancelled) return;
        setTitleSynonyms(buildJobTitleSynonymGroups(titleOptions, overrides));
        setDepartmentSynonyms(buildDepartmentSynonymGroups(departmentOptions, overrides));
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [departmentOptions, titleOptions]);

  function update(patch: Partial<JobTitleFilter>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Include</label>
        <JobTitleTagInput
          values={value.include}
          options={titleChoices}
          synonymGroups={titleSynonyms}
          field="title"
          view={view}
          placeholder="Search for a job title"
          hint={
            value.exactMatch
              ? 'Strict mode — only titles that fully match (e.g. "Finance Director", not "Finance Manager").'
              : 'Similar titles ON by default. CFO matches Chief Financial Officer; Finance Director matches Director of Finance. Use "quotes" for a single exact phrase.'
          }
          onChange={(include) => update({ include })}
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={value.exactMatch}
          onChange={(event) =>
            update({
              exactMatch: event.target.checked,
              includeSimilar: event.target.checked ? false : value.includeSimilar,
            })
          }
          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="flex items-center gap-1">
          Strict title mode
          <span className="group relative inline-flex">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full right-0 z-40 mb-1.5 hidden w-52 rounded-md bg-slate-800 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-white shadow-lg group-hover:block"
            >
              Maximize precision. &quot;Finance Director&quot; matches that title and close punctuation variants, not Finance Manager or VP Finance.
            </span>
          </span>
        </span>
      </label>

      <label
        className={`flex items-center gap-2 text-xs ${
          value.exactMatch ? "cursor-not-allowed text-slate-400" : "text-slate-600"
        }`}
      >
        <input
          type="checkbox"
          checked={value.includeSimilar && !value.exactMatch}
          disabled={value.exactMatch}
          onChange={(event) => update({ includeSimilar: event.target.checked })}
          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
        />
        <span className="flex items-center gap-1">
          Include similar titles
          <span className="group relative inline-flex">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full right-0 z-40 mb-1.5 hidden w-52 rounded-md bg-slate-800 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-white shadow-lg group-hover:block"
            >
              Expand abbreviations and order variations (CFO ↔ Chief Financial Officer, Finance Director ↔ Director of Finance). Stays relevant — not every finance role.
            </span>
          </span>
        </span>
      </label>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Exclude</label>
        <JobTitleTagInput
          values={value.exclude}
          options={titleChoices}
          synonymGroups={titleSynonyms}
          field="title"
          view={view}
          placeholder="Enter titles to exclude"
          onChange={(exclude) => update({ exclude })}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowPast((prev) => !prev)}
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          Past job titles
          <ChevronDown className={`h-3.5 w-3.5 transition ${showPast ? "rotate-180" : ""}`} />
        </button>
        {showPast && (
          <div className="mt-2 space-y-3 overflow-visible">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Include past titles
              </label>
              <JobTitleTagInput
                values={value.pastTitlesInclude}
                options={titleChoices}
                synonymGroups={titleSynonyms}
                field="title"
                view={view}
                placeholder="Enter past titles to include"
                onChange={(pastTitlesInclude) => update({ pastTitlesInclude })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Exclude past titles
              </label>
              <JobTitleTagInput
                values={value.pastTitlesExclude}
                options={titleChoices}
                synonymGroups={titleSynonyms}
                field="title"
                view={view}
                placeholder="Enter past titles to exclude"
                onChange={(pastTitlesExclude) => update({ pastTitlesExclude })}
              />
            </div>
            <div className="border-t border-slate-200" />
          </div>
        )}
      </div>

      <CheckboxFilterSection
        label="Management Level"
        options={MANAGEMENT_LEVELS}
        values={value.managementLevel}
        counts={managementLevelCounts}
        onChange={(managementLevel) => update({ managementLevel })}
      />

      <DepartmentFilterSection
        values={value.departments}
        searchPlaceholder="Search departments (e.g. GRC, IT)"
        departmentSynonyms={departmentSynonyms}
        onChange={(departments) => update({ departments })}
      />
    </div>
  );
}
