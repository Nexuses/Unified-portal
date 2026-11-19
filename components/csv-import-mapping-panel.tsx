"use client";

import { useMemo } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
import {
  guessCsvColumnMapping,
  mapCsvToRegistrants,
  type CsvColumnMapping,
  type ParsedCsvFile,
} from "@/lib/csv-registrants";

type CsvImportMappingPanelProps = {
  fileName: string;
  parsed: ParsedCsvFile;
  mapping: CsvColumnMapping;
  isImporting: boolean;
  onMappingChange: (mapping: CsvColumnMapping) => void;
  onCancel: () => void;
  onImport: () => void;
};

type MappingCardProps = {
  label: string;
  hint: string;
  value: number;
  options: Array<{ value: number; label: string }>;
  onChange: (value: number) => void;
};

function MappingCard({ label, hint, value, options, onChange }: MappingCardProps) {
  return (
    <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/50 p-4">
      <p className="text-xs font-semibold tracking-wide text-emerald-900 uppercase">{label}</p>
      <p className="mt-1 text-[11px] text-emerald-800/70">{hint}</p>
      <select
        className="mt-3 h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 text-sm text-black outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CsvImportMappingPanel({
  fileName,
  parsed,
  mapping,
  isImporting,
  onMappingChange,
  onCancel,
  onImport,
}: CsvImportMappingPanelProps) {
  const mappedRows = useMemo(
    () => mapCsvToRegistrants(parsed.rows, mapping),
    [parsed.rows, mapping]
  );
  const previewRow = mappedRows[0];
  const columnOptions = parsed.headers.map((header, index) => ({
    value: index,
    label: header.trim().replace(/^\uFEFF/, "") || `Column ${index + 1}`,
  }));

  const companyOptions = [{ value: -1, label: "— None —" }, ...columnOptions];

  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-black">Map columns</p>
          <p className="mt-1 text-xs text-black/50">
            {fileName} · {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
            {parsed.hasHeaderRow ? " · header detected" : ""}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MappingCard
          label="Name"
          hint="Required"
          value={mapping.nameColumn}
          options={columnOptions}
          onChange={(nameColumn) => onMappingChange({ ...mapping, nameColumn })}
        />
        <MappingCard
          label="Email"
          hint="Required"
          value={mapping.emailColumn}
          options={columnOptions}
          onChange={(emailColumn) => onMappingChange({ ...mapping, emailColumn })}
        />
        <MappingCard
          label="Company Name"
          hint="Optional"
          value={mapping.companyNameColumn ?? -1}
          options={companyOptions}
          onChange={(next) =>
            onMappingChange({
              ...mapping,
              companyNameColumn: next < 0 ? null : next,
            })
          }
        />
      </div>

      <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2.5">
        {mappedRows.length > 0 ? (
          <p className="text-xs text-emerald-900">
            <span className="font-semibold">
              {mappedRows.length} contact{mappedRows.length === 1 ? "" : "s"} ready
            </span>
            {previewRow ? (
              <span className="text-emerald-800/80">
                {" "}
                · {previewRow.name} · {previewRow.email}
                {previewRow.companyName ? ` · ${previewRow.companyName}` : ""}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-xs text-red-600">
            No valid rows with this mapping. Pick columns that contain name and email.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isImporting}
          className="rounded-full border border-black/10 px-4 py-2 text-xs font-medium text-black/65 hover:bg-black/5 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={isImporting || mappedRows.length === 0}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-black px-5 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-60"
        >
          <ButtonLoadingContent loading={isImporting} loadingText="Importing...">
            Import
          </ButtonLoadingContent>
        </button>
      </div>
    </div>
  );
}

export function createInitialCsvMapping(parsed: ParsedCsvFile): CsvColumnMapping {
  return guessCsvColumnMapping(parsed.headers);
}
