"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, HelpCircle, X } from "lucide-react";
import {
  getIndustrySuggestions,
  mergeIndustryOptions,
} from "@/app/components/portal/crm/people/industry-options";
import { getKeywordSuggestions } from "@/app/components/portal/crm/people/keyword-options";
import type {
  IndustryAdvancedMode,
  IndustryKeywordsFilter,
} from "@/lib/people/data-browser/types";
import { buildIndustrySynonymGroups } from "@/lib/people/field-synonyms";
import type { SynonymGroups } from "@/lib/people/text-synonyms";
import type { DataView } from "@/lib/people/data-views";
import { useFilterSuggest } from "@/lib/people/use-filter-suggest";

interface IndustryKeywordsFilterPanelProps {
  value: IndustryKeywordsFilter;
  onChange: (next: IndustryKeywordsFilter) => void;
  industryOptions?: string[];
  view: DataView;
}

function TagInput({
  values,
  options,
  synonymGroups,
  enableSuggest,
  view,
  placeholder,
  onChange,
}: {
  values: string[];
  options: string[];
  synonymGroups?: SynonymGroups;
  enableSuggest?: boolean;
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

  const remoteOptions = useFilterSuggest("industry", draft, view, enableSuggest === true);
  const query = draft.trim();
  const filteredOptions = useMemo(() => {
    const merged = enableSuggest
      ? Array.from(new Set([...options, ...remoteOptions]))
      : options;
    const available = merged.filter(
      (option) => !values.some((entry) => entry.toLowerCase() === option.toLowerCase())
    );
    if (!query) return available.slice(0, 30);
    if (synonymGroups) {
      const suggested = synonymGroups
        .matchSuggestions(query, 30)
        .filter(
          (option) => !values.some((entry) => entry.toLowerCase() === option.toLowerCase())
        );
      const extras = remoteOptions.filter(
        (option) =>
          !values.some((entry) => entry.toLowerCase() === option.toLowerCase()) &&
          !suggested.some((entry) => entry.toLowerCase() === option.toLowerCase())
      );
      return [...suggested, ...extras].slice(0, 30);
    }
    const normalized = query.toLowerCase();
    return available
      .filter((option) => option.toLowerCase().includes(normalized))
      .slice(0, 30);
  }, [enableSuggest, options, query, remoteOptions, synonymGroups, values]);

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
        <div className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
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
  );
}

function KeywordTypeHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-400 hover:text-slate-600"
        aria-label={text}
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </span>
      {open && (
        <span
          onClick={(event) => event.stopPropagation()}
          className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-3 text-left text-[11px] font-normal leading-relaxed text-slate-700 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

const ADVANCED_MODES: Array<{ key: IndustryAdvancedMode; label: string }> = [
  { key: "is_not_any_of", label: "Is not any of" },
  { key: "is_known", label: "Is known" },
  { key: "is_unknown", label: "Is unknown" },
];

export default function IndustryKeywordsFilterPanel({
  value,
  onChange,
  industryOptions = [],
  view,
}: IndustryKeywordsFilterPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(
    value.advancedMode !== null || value.excludeIndustries.length > 0
  );
  const [keywordTypesOpen, setKeywordTypesOpen] = useState(true);
  const [companyKeywordsOpen, setCompanyKeywordsOpen] = useState(true);
  const [keywordsHintOpen, setKeywordsHintOpen] = useState(false);
  const [descWarningOpen, setDescWarningOpen] = useState(false);

  const industryChoices = useMemo(
    () => mergeIndustryOptions(getIndustrySuggestions(), industryOptions),
    [industryOptions]
  );
  const [industrySynonyms, setIndustrySynonyms] = useState<
    ReturnType<typeof buildIndustrySynonymGroups> | undefined
  >();
  const keywordChoices = useMemo(() => getKeywordSuggestions(), []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setIndustrySynonyms(buildIndustrySynonymGroups(industryOptions));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [industryOptions]);

  function setAdvancedMode(mode: IndustryAdvancedMode) {
    onChange({
      ...value,
      advancedMode: value.advancedMode === mode ? null : mode,
    });
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <TagInput
        values={value.industries}
        options={industryChoices}
        synonymGroups={industrySynonyms}
        enableSuggest
        view={view}
        placeholder="Search industries..."
        onChange={(industries) => onChange({ ...value, industries })}
      />

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          {advancedOpen ? "Hide advanced settings" : "Show advanced settings"}
          <ChevronDown className={`h-3.5 w-3.5 transition ${advancedOpen ? "rotate-180" : ""}`} />
        </button>

        {advancedOpen && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1">
              {ADVANCED_MODES.map((mode) => {
                const isActive = value.advancedMode === mode.key;
                return (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setAdvancedMode(mode.key)}
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      isActive
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>

            <TagInput
              values={value.excludeIndustries}
              options={industryChoices}
              synonymGroups={industrySynonyms}
              enableSuggest
              view={view}
              placeholder="Search industries to exclude..."
              onChange={(excludeIndustries) => onChange({ ...value, excludeIndustries })}
            />
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-2">
        <button
          type="button"
          onClick={() => setCompanyKeywordsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between py-1 text-xs font-medium text-slate-700"
        >
          <span className="inline-flex items-center gap-1">
            Company Keywords
            <span
              className="relative inline-flex"
              onMouseEnter={() => setKeywordsHintOpen(true)}
              onMouseLeave={() => setKeywordsHintOpen(false)}
            >
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  setKeywordsHintOpen((prev) => !prev);
                }}
                onFocus={() => setKeywordsHintOpen(true)}
                onBlur={() => setKeywordsHintOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Difference between Industry and Keywords"
              >
                <HelpCircle className="h-4 w-4" aria-hidden />
              </span>
              {keywordsHintOpen && (
                <span
                  onClick={(event) => event.stopPropagation()}
                  className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-[11px] font-normal leading-relaxed text-slate-700 shadow-lg"
                >
                  <span className="mb-1 block font-semibold text-slate-800">
                    What&apos;s the difference between Industry and Keywords?
                  </span>
                  Use <em>Industry</em> to find companies by their core business category.
                  Use <em>Keywords</em> for more specific targeting based on how companies
                  describe themselves online—pulled from websites, social media, and other
                  sources using Apollo AI.
                </span>
              )}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition ${companyKeywordsOpen ? "rotate-180" : ""}`}
          />
        </button>

        {companyKeywordsOpen && (
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={value.includeKeywordsEnabled}
                onChange={(event) =>
                  onChange({ ...value, includeKeywordsEnabled: event.target.checked })
                }
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="min-w-0 flex-1 space-y-2">
                <span className="block text-xs font-medium text-slate-700">Include keywords</span>
                {value.includeKeywordsEnabled && (
                  <>
                    <TagInput
                      values={value.keywords}
                      options={keywordChoices}
                      synonymGroups={industrySynonyms}
                      view={view}
                      placeholder="e.g. Cloud, IT"
                      onChange={(keywords) => onChange({ ...value, keywords })}
                    />

                    <div>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setKeywordTypesOpen((prev) => !prev)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                        >
                          Type of Keywords
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition ${keywordTypesOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {!keywordTypesOpen && (
                          <span
                            className="relative inline-flex"
                            onMouseEnter={() => setDescWarningOpen(true)}
                            onMouseLeave={() => setDescWarningOpen(false)}
                          >
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => setDescWarningOpen((prev) => !prev)}
                              onFocus={() => setDescWarningOpen(true)}
                              onBlur={() => setDescWarningOpen(false)}
                              className="text-slate-400 hover:text-slate-600"
                              aria-label="Company description keyword warning"
                            >
                              <AlertTriangle className="h-4 w-4" aria-hidden />
                            </span>
                            {descWarningOpen && (
                              <span className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-[11px] font-normal leading-relaxed text-slate-700 shadow-lg">
                                By default, company description is not included because it can
                                be inaccurate. For example a company that mentioned
                                &ldquo;Marketing&rdquo; in its descriptions is not necessarily
                                a Marketing company.
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      {keywordTypesOpen && (
                        <div className="mt-2 space-y-1.5">
                          <p className="text-[11px] text-slate-500">
                            What kind of keywords would you like to search for?
                          </p>
                          {[
                            { key: "searchName" as const, label: "Name" },
                            {
                              key: "searchKeywords" as const,
                              label: "Keywords",
                              hint: "Keywords curated from company websites, social media, and other sources using Apollo AI.",
                            },
                            {
                              key: "searchCompanyDescription" as const,
                              label: "Company description",
                              hint: "Company description curated from multiple trusted sources such as social media description, SEO description.",
                            },
                          ].map((option) => (
                            <label
                              key={option.key}
                              className="flex items-center gap-2 text-xs text-slate-600"
                            >
                              <input
                                type="checkbox"
                                checked={value[option.key]}
                                onChange={(event) =>
                                  onChange({ ...value, [option.key]: event.target.checked })
                                }
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="flex-1">{option.label}</span>
                              {option.hint ? <KeywordTypeHint text={option.hint} /> : null}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </span>
            </label>

            <div className="rounded-md border border-slate-200 p-2.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.includeAllKeywords}
                  onChange={(event) =>
                    onChange({ ...value, includeAllKeywords: event.target.checked })
                  }
                  disabled={!value.includeKeywordsEnabled}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                <span className="text-xs font-medium text-slate-700">Include ALL</span>
              </label>
            </div>

            <div className="rounded-md border border-slate-200 p-2.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.excludeKeywordsEnabled}
                  onChange={(event) =>
                    onChange({ ...value, excludeKeywordsEnabled: event.target.checked })
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">Exclude keywords</span>
              </label>
              {value.excludeKeywordsEnabled && (
                <div className="mt-2">
                  <TagInput
                    values={value.excludeKeywords}
                    options={keywordChoices}
                    view={view}
                    placeholder="Enter keywords to exclude..."
                    onChange={(excludeKeywords) => onChange({ ...value, excludeKeywords })}
                  />
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-400">
              Keywords filters may slow down your search.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
