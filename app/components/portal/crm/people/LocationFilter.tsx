"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, User, X } from "lucide-react";
import {
  getLocationSuggestions,
  mergeLocationOptions,
} from "@/app/components/portal/crm/people/location-options";
import type { LocationFilter, LocationFilterTab } from "@/lib/people/data-browser/types";
import type { DataView } from "@/lib/people/data-views";
import { useFilterSuggest } from "@/lib/people/use-filter-suggest";

interface LocationFilterPanelProps {
  value: LocationFilter;
  onChange: (next: LocationFilter) => void;
  contactOptions?: string[];
  accountHqOptions?: string[];
  view: DataView;
}

function LocationTagInput({
  label,
  values,
  options,
  field,
  view,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  options: string[];
  field: "contactLocation" | "accountHq";
  view: DataView;
  placeholder: string;
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
  const mergedOptions = useMemo(
    () => mergeLocationOptions(options, remoteOptions),
    [options, remoteOptions]
  );
  const query = draft.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      mergedOptions
        .filter(
          (option) =>
            !values.some((entry) => entry.toLowerCase() === option.toLowerCase()) &&
            (query.length === 0 || option.toLowerCase().includes(query))
        )
        .slice(0, 50),
    [mergedOptions, query, values]
  );

  function addValue(next: string) {
    const trimmed = next.trim();
    if (!trimmed) return;
    if (values.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...values, trimmed]);
    setDraft("");
    setOpen(false);
  }

  function removeValue(value: string) {
    onChange(values.filter((entry) => entry !== value));
  }

  return (
    <div ref={ref}>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
            >
              {value}
              <button
                type="button"
                onClick={() => removeValue(value)}
                className="text-blue-500 hover:text-blue-700"
                aria-label={`Remove ${value}`}
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
                  addValue(draft);
                } else if (filteredOptions.length > 0) {
                  addValue(filteredOptions[0]);
                }
              } else if (event.key === "Escape") {
                setOpen(false);
              } else if (event.key === "Backspace" && draft.length === 0 && values.length > 0) {
                removeValue(values[values.length - 1]);
              }
            }}
            placeholder={values.length === 0 ? placeholder : ""}
            className="min-w-[6rem] flex-1 border-none bg-transparent pr-6 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label="Toggle location suggestions"
          >
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        {open && filteredOptions.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
            {filteredOptions.slice(0, 50).map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addValue(option)}
                className="block w-full truncate px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LocationFilterPanel({
  value,
  onChange,
  contactOptions = [],
  accountHqOptions = [],
  view,
}: LocationFilterPanelProps) {
  const [excludeOpen, setExcludeOpen] = useState(value.exclude.length > 0);
  const activeTab = value.tab;
  const dataOptions = activeTab === "contact" ? contactOptions : accountHqOptions;
  const locationOptions = useMemo(
    () => mergeLocationOptions(getLocationSuggestions(), dataOptions),
    [dataOptions]
  );

  function setTab(tab: LocationFilterTab) {
    if (tab === value.tab) return;
    onChange({ ...value, tab, include: [], exclude: [] });
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <div className="flex border-b border-slate-200">
        {[
          { key: "contact" as const, label: "Contact", icon: User },
          { key: "account_hq" as const, label: "Account HQ", icon: Building2 },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-medium transition ${
                isActive
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-slate-200 p-2.5">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="location-mode"
            checked={value.mode === "select_region"}
            onChange={() => onChange({ ...value, mode: "select_region" })}
            className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="min-w-0 flex-1 space-y-3">
            <span className="block text-xs font-medium text-slate-700">Select region</span>
            {value.mode === "select_region" && (
              <>
                <LocationTagInput
                  label="City / State / Country / ZIP"
                  values={value.include}
                  options={locationOptions}
                  field={activeTab === "contact" ? "contactLocation" : "accountHq"}
                  view={view}
                  placeholder="Enter locations..."
                  onChange={(include) => onChange({ ...value, include })}
                />

                <div>
                  <button
                    type="button"
                    onClick={() => setExcludeOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    Exclude locations
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition ${excludeOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {excludeOpen && (
                    <div className="mt-2">
                      <LocationTagInput
                        label="City / State / Country to exclude:"
                        values={value.exclude}
                        options={locationOptions}
                        field={activeTab === "contact" ? "contactLocation" : "accountHq"}
                        view={view}
                        placeholder="Enter locations to exclude..."
                        onChange={(exclude) => onChange({ ...value, exclude })}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </span>
        </label>
      </div>
    </div>
  );
}
