"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  filterRevenueSuggestions,
  formatRevenueInputLabel,
  sanitizeRevenueInput,
} from "@/app/components/portal/crm/people/revenue-options";
import type { RevenueFilter, RevenueFilterMode } from "@/lib/people/data-browser/types";

interface RevenueFilterPanelProps {
  value: RevenueFilter;
  onChange: (next: RevenueFilter) => void;
}

const REVENUE_MODES: Array<{ key: RevenueFilterMode; label: string }> = [
  { key: "is_between", label: "Is between" },
  { key: "is_known", label: "Is known" },
  { key: "is_unknown", label: "Is unknown" },
];

function RevenueAmountInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (draft !== value) {
        onChangeRef.current(draft.trim());
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [draft, value]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const suggestions = useMemo(() => filterRevenueSuggestions(draft), [draft]);

  function selectSuggestion(option: string) {
    setDraft(option);
    onChangeRef.current(option);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <span className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-xs text-slate-400">
        $
      </span>
      <input
        type="text"
        inputMode="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={draft}
        onChange={(event) => {
          setDraft(sanitizeRevenueInput(event.target.value));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "Enter" && suggestions.length > 0) {
            event.preventDefault();
            selectSuggestion(suggestions[0]);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-300 py-1.5 pl-5 pr-2.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      {open && suggestions.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-md"
        >
          {suggestions.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={draft === option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(option)}
              className={`flex w-full px-2.5 py-1.5 text-left text-xs hover:bg-slate-50 ${
                draft === option
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "text-slate-700"
              }`}
            >
              {formatRevenueInputLabel(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RangeInput({
  min,
  max,
  onChange,
}: {
  min: string;
  max: string;
  onChange: (next: { min: string; max: string }) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <RevenueAmountInput
          value={min}
          placeholder="Min"
          onChange={(nextMin) => onChange({ min: nextMin, max })}
        />
        <span className="text-xs text-slate-400">–</span>
        <RevenueAmountInput
          value={max}
          placeholder="Max"
          onChange={(nextMax) => onChange({ min, max: nextMax })}
        />
      </div>
      <p className="text-[11px] text-slate-400">
        Amounts in $. Pick a suggestion or type K / M / B (e.g. 0.5M, 10M, 1B).
      </p>
    </div>
  );
}

export default function RevenueFilterPanel({ value, onChange }: RevenueFilterPanelProps) {
  const handleRangeChange = useCallback(
    ({ min, max }: { min: string; max: string }) => {
      onChange({ ...value, min, max });
    },
    [onChange, value]
  );

  function setMode(mode: RevenueFilterMode) {
    onChange({
      ...value,
      mode,
      min: mode === "is_between" ? value.min : "",
      max: mode === "is_between" ? value.max : "",
    });
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <div className="flex flex-wrap gap-1">
        {REVENUE_MODES.map((mode) => {
          const isActive = value.mode === mode.key;
          return (
            <button
              key={mode.key}
              type="button"
              onClick={() => setMode(mode.key)}
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

      {value.mode === "is_between" && (
        <RangeInput min={value.min} max={value.max} onChange={handleRangeChange} />
      )}
    </div>
  );
}
