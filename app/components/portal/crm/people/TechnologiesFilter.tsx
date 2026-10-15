"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, HelpCircle, X } from "lucide-react";
import {
  getTechnologyCategory,
  getTechnologySuggestions,
  mergeTechnologyOptions,
} from "@/app/components/portal/crm/people/technology-options";
import type { TechnologiesFilter } from "@/lib/people/data-browser/types";

interface TechnologiesFilterPanelProps {
  value: TechnologiesFilter;
  onChange: (next: TechnologiesFilter) => void;
  technologyOptions?: string[];
  technologyCounts?: Record<string, number>;
}

function TagInput({
  values,
  options,
  optionCounts = {},
  placeholder,
  onChange,
}: {
  values: string[];
  options: string[];
  optionCounts?: Record<string, number>;
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

  const query = draft.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      options
        .filter(
          (option) =>
            !values.some((entry) => entry.toLowerCase() === option.toLowerCase()) &&
            (query.length === 0 || option.toLowerCase().includes(query))
        )
        .slice(0, 50),
    [options, query, values]
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
    <div ref={ref} className="relative">
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
          aria-label="Toggle suggestions"
        >
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && filteredOptions.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
          {filteredOptions.slice(0, 100).map((option) => {
            const category = getTechnologyCategory(option);
            const count = optionCounts[option];
            return (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addValue(option)}
                className="block w-full px-2.5 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-slate-700">{option}</span>
                  {typeof count === "number" && count > 0 && (
                    <span className="shrink-0 text-[11px] text-slate-400">{count}</span>
                  )}
                </span>
                {category && (
                  <span className="block truncate text-[11px] text-slate-400">{category}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TechnologiesFilterPanel({
  value,
  onChange,
  technologyOptions = [],
  technologyCounts = {},
}: TechnologiesFilterPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(
    value.includeAll.length > 0 || value.exclude.length > 0
  );

  const technologyChoices = useMemo(
    () => mergeTechnologyOptions(getTechnologySuggestions(), technologyOptions),
    [technologyOptions]
  );

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <TagInput
        values={value.include}
        options={technologyChoices}
        optionCounts={technologyCounts}
        placeholder="Include technologies..."
        onChange={(include) => onChange({ ...value, include })}
      />

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          {advancedOpen ? "Hide advanced" : "Show advanced"}
          <ChevronDown className={`h-3.5 w-3.5 transition ${advancedOpen ? "rotate-180" : ""}`} />
        </button>

        {advancedOpen && (
          <div className="mt-2 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Include ALL</p>
              <TagInput
                values={value.includeAll}
                options={technologyChoices}
                optionCounts={technologyCounts}
                placeholder="Include all technologies..."
                onChange={(includeAll) => onChange({ ...value, includeAll })}
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Exclude</p>
              <TagInput
                values={value.exclude}
                options={technologyChoices}
                optionCounts={technologyCounts}
                placeholder="Exclude technologies..."
                onChange={(exclude) => onChange({ ...value, exclude })}
              />
            </div>

            <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <p className="text-[11px] leading-relaxed text-slate-500">
                Excluding technologies can include entries for companies with incomplete technology data.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
