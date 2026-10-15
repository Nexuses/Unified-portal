"use client";

import { useEffect, useState } from "react";
import {
  EMPLOYEE_RANGES,
  formatEmployeeCount,
} from "@/app/components/portal/crm/people/employees-options";
import type { EmployeesFilter } from "@/lib/people/data-browser/types";

interface EmployeesFilterPanelProps {
  value: EmployeesFilter;
  onChange: (next: EmployeesFilter) => void;
  rangeCounts?: Record<string, number>;
}

function CustomRangeInput({
  min,
  max,
  onChange,
}: {
  min: string;
  max: string;
  onChange: (next: { min: string; max: string }) => void;
}) {
  const [minDraft, setMinDraft] = useState(min);
  const [maxDraft, setMaxDraft] = useState(max);

  useEffect(() => {
    setMinDraft(min);
    setMaxDraft(max);
  }, [min, max]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (minDraft !== min || maxDraft !== max) {
        onChange({ min: minDraft.trim(), max: maxDraft.trim() });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [minDraft, maxDraft, min, max, onChange]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        value={minDraft}
        onChange={(event) => setMinDraft(event.target.value.replace(/[^\d]/g, ""))}
        placeholder="Min"
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      <span className="text-xs text-slate-400">–</span>
      <input
        type="text"
        inputMode="numeric"
        value={maxDraft}
        onChange={(event) => setMaxDraft(event.target.value.replace(/[^\d]/g, ""))}
        placeholder="Max"
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  );
}

export default function EmployeesFilterPanel({
  value,
  onChange,
  rangeCounts = {},
}: EmployeesFilterPanelProps) {
  function toggleRange(rangeId: string) {
    const next = value.predefinedRanges.includes(rangeId)
      ? value.predefinedRanges.filter((entry) => entry !== rangeId)
      : [...value.predefinedRanges, rangeId];
    onChange({ ...value, predefinedRanges: next });
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2.5 hover:bg-slate-50">
        <input
          type="radio"
          name="employees-mode"
          checked={value.mode === "predefined"}
          onChange={() => onChange({ ...value, mode: "predefined" })}
          className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-slate-700">Predefined Range</span>
          {value.mode === "predefined" && (
            <div className="mt-2 space-y-0.5">
              {EMPLOYEE_RANGES.map((range) => (
                <label
                  key={range.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={value.predefinedRanges.includes(range.id)}
                    onChange={() => toggleRange(range.id)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex-1">{range.label}</span>
                  <span className="text-slate-400">
                    {formatEmployeeCount(rangeCounts[range.id] ?? 0)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2.5 hover:bg-slate-50">
        <input
          type="radio"
          name="employees-mode"
          checked={value.mode === "custom"}
          onChange={() => onChange({ ...value, mode: "custom" })}
          className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-slate-700">Custom Range</span>
          {value.mode === "custom" && (
            <CustomRangeInput
              min={value.customMin}
              max={value.customMax}
              onChange={({ min, max }) => onChange({ ...value, customMin: min, customMax: max })}
            />
          )}
        </span>
      </label>
    </div>
  );
}
