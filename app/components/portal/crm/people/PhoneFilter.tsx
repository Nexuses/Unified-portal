"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";

export type PhoneFilterMode = "any" | "is_known" | "is_unknown" | "contains";

export function parsePhoneFilterValues(values: string[] | undefined): {
  mode: PhoneFilterMode;
  query: string;
} {
  const entries = values ?? [];
  const queryEntry = entries.find((entry) => entry.startsWith("q:"));
  if (queryEntry || entries.includes("contains")) {
    return {
      mode: "contains",
      query: queryEntry ? queryEntry.slice(2) : "",
    };
  }
  if (entries.includes("is_unknown")) {
    return { mode: "is_unknown", query: "" };
  }
  if (entries.includes("is_known")) {
    return { mode: "is_known", query: "" };
  }
  return { mode: "any", query: "" };
}

export function serializePhoneFilter(
  mode: PhoneFilterMode,
  query: string
): string[] {
  if (mode === "contains") {
    const trimmed = query.trim();
    // Keep a sentinel so the UI stays on Contains while the input is empty.
    return trimmed ? [`q:${trimmed}`] : ["contains"];
  }
  if (mode === "is_known" || mode === "is_unknown") {
    return [mode];
  }
  return [];
}

export function isPhoneFilterActive(values: string[] | undefined): boolean {
  const { mode, query } = parsePhoneFilterValues(values);
  if (mode === "is_known" || mode === "is_unknown") return true;
  if (mode === "contains") return query.trim().length > 0;
  return false;
}

export function phoneFilterLabel(
  kind: "personal" | "company",
  values: string[] | undefined
): string | undefined {
  const { mode, query } = parsePhoneFilterValues(values);
  const prefix = kind === "personal" ? "Personal phone" : "Company phone";
  if (mode === "is_known") return `${prefix}: is known`;
  if (mode === "is_unknown") return `${prefix}: is unknown`;
  if (mode === "contains" && query.trim()) {
    return `${prefix}: ${query.trim()}`;
  }
  return undefined;
}

interface PhoneFilterPanelProps {
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export default function PhoneFilterPanel({
  label,
  value,
  onChange,
  placeholder = "Enter phone number…",
}: PhoneFilterPanelProps) {
  const { mode, query } = parsePhoneFilterValues(value);
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    if (mode !== "contains") return;
    const trimmed = draft.trim();
    const committed = query.trim();
    if (trimmed === committed) return;

    const timer = window.setTimeout(() => {
      onChange(serializePhoneFilter("contains", draft));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, mode, onChange, query]);

  function setMode(next: PhoneFilterMode) {
    if (next === "contains") {
      onChange(serializePhoneFilter("contains", draft || query));
      return;
    }
    onChange(serializePhoneFilter(next, ""));
  }

  const radioName = `phone-filter-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        <Phone className="h-3 w-3" />
        {label}
      </p>
      <div className="space-y-1.5">
        {(
          [
            { id: "any" as const, title: "Any" },
            { id: "is_known" as const, title: "Is known" },
            { id: "is_unknown" as const, title: "Is unknown" },
            { id: "contains" as const, title: "Contains" },
          ] as const
        ).map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50"
          >
            <input
              type="radio"
              name={radioName}
              checked={mode === option.id}
              onChange={() => setMode(option.id)}
              className="h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-700">{option.title}</span>
          </label>
        ))}
      </div>
      {mode === "contains" ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      ) : null}
    </div>
  );
}
