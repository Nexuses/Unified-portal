"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Info, X } from "lucide-react";
import CompanyAvatar from "@/app/components/portal/crm/people/CompanyAvatar";
import { mergeCompanyOptions } from "@/app/components/portal/crm/people/company-suggestions";
import type { CompanyFilter, CompanyFilterMode, CompanyFilterSelection } from "@/lib/people/data-browser/types";
import type { DataView } from "@/lib/people/data-views";
import { useFilterSuggest } from "@/lib/people/use-filter-suggest";

interface CompanyFilterPanelProps {
  value: CompanyFilter;
  onChange: (next: CompanyFilter) => void;
  companyOptions: string[];
  view: DataView;
}

function CompanyTagInput({
  values,
  options,
  view,
  disabled,
  onChange,
}: {
  values: CompanyFilterSelection[];
  options: string[];
  view: DataView;
  disabled?: boolean;
  onChange: (values: CompanyFilterSelection[]) => void;
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

  const remoteOptions = useFilterSuggest("company", draft, view);
  const optionItems = useMemo(
    () => mergeCompanyOptions([...options, ...remoteOptions]),
    [options, remoteOptions]
  );

  const query = draft.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      optionItems
        .filter(
          (option) =>
            !values.some(
              (selection) => selection.name.toLowerCase() === option.name.toLowerCase()
            ) &&
            (query.length === 0 ||
              option.name.toLowerCase().includes(query) ||
              (option.domain ?? "").toLowerCase().includes(query))
        )
        .slice(0, 50),
    [optionItems, query, values]
  );

  function addTag(selection: CompanyFilterSelection) {
    const name = selection.name.trim();
    if (!name) return;
    if (values.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) return;
    onChange([...values, { name, domain: selection.domain }]);
    setDraft("");
    setOpen(false);
  }

  function removeTag(name: string) {
    onChange(values.filter((selection) => selection.name !== name));
  }

  return (
    <div ref={ref}>
      <div className="relative">
        <div
          className={`flex flex-wrap items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 ${
            disabled ? "bg-slate-50 opacity-60" : ""
          }`}
        >
          {values.map((selection) => (
            <span
              key={selection.name}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
            >
              {selection.name}
              <button
                type="button"
                onClick={() => removeTag(selection.name)}
                disabled={disabled}
                className="text-blue-500 hover:text-blue-700 disabled:opacity-50"
                aria-label={`Remove ${selection.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-controls="company-suggestions-listbox"
            aria-autocomplete="list"
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                if (draft.trim()) {
                  addTag({ name: draft.trim() });
                } else if (filteredOptions.length > 0) {
                  addTag({
                    name: filteredOptions[0].name,
                    domain: filteredOptions[0].domain,
                  });
                }
              } else if (event.key === "Escape") {
                setOpen(false);
              } else if (event.key === "Backspace" && draft.length === 0 && values.length > 0) {
                removeTag(values[values.length - 1].name);
              }
            }}
            placeholder={values.length === 0 ? "Enter companies..." : ""}
            className="min-w-[6rem] flex-1 border-none bg-transparent pr-6 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
            aria-label="Toggle company suggestions"
          >
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        {open && !disabled && filteredOptions.length > 0 && (
          <div
            id="company-suggestions-listbox"
            role="listbox"
            className="mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm"
          >
            {filteredOptions.slice(0, 50).map((option) => (
              <button
                key={option.suggestionId ?? option.name}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  addTag({ name: option.name, domain: option.domain })
                }
                className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-slate-50"
              >
                <CompanyAvatar suggestionId={option.suggestionId} name={option.name} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-800">
                    {option.name}
                  </span>
                  {option.domain && (
                    <span className="block truncate text-[11px] text-slate-500">
                      {option.domain}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CompanyNamesHint({
  namesOnly,
  onNamesOnlyChange,
  align = "left",
}: {
  namesOnly: boolean;
  onNamesOnlyChange: (value: boolean) => void;
  align?: "left" | "right";
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (hintRef.current && !hintRef.current.contains(event.target as Node)) {
        setHintOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={hintRef} className="relative">
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onNamesOnlyChange(!namesOnly)}
          className="text-xs text-blue-600 underline hover:text-blue-700"
        >
          I only have company names
        </button>
        <button
          type="button"
          onMouseEnter={() => setHintOpen(true)}
          onMouseLeave={() => setHintOpen(false)}
          onFocus={() => setHintOpen(true)}
          onBlur={() => setHintOpen(false)}
          onClick={() => setHintOpen((prev) => !prev)}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Company names enrichment info"
        >
          <Info className="h-3 w-3" aria-hidden />
        </button>
        {namesOnly && <span className="text-xs text-slate-500">(active)</span>}
      </div>
      {hintOpen && (
        <div
          className={`absolute bottom-full z-30 mb-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="p-3 text-[11px] leading-relaxed text-slate-800">
            Do you only have the company names? You can enrich them with websites for
            free by uploading them in a CSV file{" "}
            <span className="cursor-pointer text-blue-600 underline">here</span>. Once you
            finish the import, you can find them in the{" "}
            <span className="cursor-pointer text-blue-600 underline">companies tab</span>{" "}
            and export the results (filter by the file name under CSV Import). Please
            allow up to 1-2 hours for the enrichment to complete.
          </div>
          <div className="h-1 bg-amber-400" />
        </div>
      )}
    </div>
  );
}

function BulkListSection({
  title,
  draft,
  namesOnly,
  onDraftChange,
  onNamesOnlyChange,
  onSave,
  hintAlign = "left",
}: {
  title: string;
  draft: string;
  namesOnly: boolean;
  onDraftChange: (value: string) => void;
  onNamesOnlyChange: (value: boolean) => void;
  onSave: () => void;
  hintAlign?: "left" | "right";
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">{title}</label>
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={"e.g. http://cisco.com\nname@example.com\nwww.dell.com salesforce.com"}
        rows={4}
        className="w-full resize-none rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      <button
        type="button"
        onClick={onSave}
        className="w-full rounded-md bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-amber-500"
      >
        Save and Search
      </button>
      <CompanyNamesHint
        namesOnly={namesOnly}
        onNamesOnlyChange={onNamesOnlyChange}
        align={hintAlign}
      />
    </div>
  );
}

export default function CompanyFilterPanel({
  value,
  onChange,
  companyOptions,
  view,
}: CompanyFilterPanelProps) {
  const [includeListDraft, setIncludeListDraft] = useState(value.includeList);
  const [excludeListDraft, setExcludeListDraft] = useState(value.excludeList);
  const [bulkOpen, setBulkOpen] = useState(true);

  useEffect(() => {
    setIncludeListDraft(value.includeList);
    setExcludeListDraft(value.excludeList);
  }, [value.includeList, value.excludeList]);

  function setMode(mode: CompanyFilterMode) {
    onChange({ ...value, mode });
  }

  function applyIncludeList() {
    onChange({ ...value, includeList: includeListDraft.trim() });
  }

  function applyExcludeList() {
    onChange({ ...value, excludeList: excludeListDraft.trim() });
  }

  const isAnyOf = value.mode === "is_any_of";

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2.5 hover:bg-slate-50">
          <input
            type="radio"
            name="company-mode"
            checked={isAnyOf}
            onChange={() => setMode("is_any_of")}
            className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block text-xs font-medium text-slate-700">Is any of</span>
            {isAnyOf && (
              <>
                <CompanyTagInput
                  values={value.include}
                  options={companyOptions}
                  view={view}
                  onChange={(include) => onChange({ ...value, include })}
                />
                <div className="space-y-1.5 pt-1">
                  {[
                    { key: "isNotAnyOf" as const, label: "Is not any of" },
                    { key: "includePastCompany" as const, label: "Include past company" },
                    { key: "excludePastCompany" as const, label: "Exclude past company" },
                    { key: "domainExists" as const, label: "Domain exists" },
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
                      {option.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-slate-700">
          <input
            type="radio"
            name="company-mode"
            checked={value.mode === "is_known"}
            onChange={() => setMode("is_known")}
            className="h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Is known
        </label>

        <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-slate-700">
          <input
            type="radio"
            name="company-mode"
            checked={value.mode === "is_unknown"}
            onChange={() => setMode("is_unknown")}
            className="h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Is unknown
        </label>
      </div>

      <div className="border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={() => setBulkOpen((prev) => !prev)}
          className="flex w-full items-center justify-between py-1 text-xs font-medium text-slate-700"
        >
          Include / exclude list of companies
          <ChevronDown className={`h-4 w-4 transition ${bulkOpen ? "rotate-180" : ""}`} />
        </button>

        {bulkOpen && (
          <div className="mt-2 space-y-4">
            <BulkListSection
              title="Include list of companies"
              draft={includeListDraft}
              namesOnly={value.includeListNamesOnly}
              onDraftChange={setIncludeListDraft}
              onNamesOnlyChange={(includeListNamesOnly) =>
                onChange({ ...value, includeListNamesOnly })
              }
              onSave={applyIncludeList}
            />
            <BulkListSection
              title="Exclude list of companies"
              draft={excludeListDraft}
              namesOnly={value.excludeListNamesOnly}
              onDraftChange={setExcludeListDraft}
              onNamesOnlyChange={(excludeListNamesOnly) =>
                onChange({ ...value, excludeListNamesOnly })
              }
              onSave={applyExcludeList}
              hintAlign="right"
            />
          </div>
        )}
      </div>
    </div>
  );
}
