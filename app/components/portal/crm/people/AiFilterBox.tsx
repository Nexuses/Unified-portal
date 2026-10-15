"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { AiSearchFilters } from "@/lib/people/ai-search";
import type { DataView } from "@/lib/people/data-views";

interface AiFilterBoxProps {
  view: DataView;
  facets: Record<string, string[]>;
  onApply: (filters: AiSearchFilters) => void;
}

export default function AiFilterBox({ view, facets, onApply }: AiFilterBoxProps) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isPending) return;

    setError("");
    setSummary("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/crm/enrich/people/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: trimmed,
            view,
            expandOptions: {
              technologies: facets.technologies ?? [],
              industries: facets.industryKeywords ?? [],
              locations: [
                ...(facets.contactLocations ?? facets.location ?? []),
                ...(facets.accountHqLocations ?? []),
              ],
              jobTitles: facets.jobTitles ?? [],
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to build filters");
        }
        const filters = data.filters as AiSearchFilters;
        onApply(filters);
        setSummary(filters.explanation);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to build filters");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-2 rounded-xl border border-violet-100 bg-linear-to-br from-violet-50/80 via-white to-blue-50/60 p-2.5"
    >
      <label
        htmlFor={`ai-filter-${view}`}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-600" />
        Describe who you want
      </label>
      <div className="flex gap-2">
        <input
          id={`ai-filter-${view}`}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            view === "people"
              ? "e.g. VP Sales at SaaS companies in the US"
              : "e.g. Fintech companies with 200+ employees"
          }
          disabled={isPending}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-xs placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-500/15 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={isPending || !query.trim()}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-50 disabled:shadow-none bg-(--purple) text-white hover:bg-[#5b2fd0]"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Apply
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : summary ? (
        <p className="text-xs text-slate-500">Applied: {summary}</p>
      ) : null}
    </form>
  );
}
