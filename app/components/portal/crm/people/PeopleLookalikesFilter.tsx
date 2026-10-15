"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  formatPeopleLookalikeQuery,
  mergePeopleSuggestions,
  suggestionToReference,
  type PeopleLookalikeSuggestion,
  type PeopleSuggestionRecord,
} from "@/app/components/portal/crm/people/people-lookalike-suggestions";
import PeopleLookalikeAvatar from "@/app/components/portal/crm/people/PeopleLookalikeAvatar";
import type { PeopleLookalikesFilter } from "@/lib/people/data-browser/types";

interface PeopleLookalikesFilterProps {
  value: PeopleLookalikesFilter;
  onChange: (next: PeopleLookalikesFilter) => void;
  suggestions?: PeopleSuggestionRecord[];
}

export default function PeopleLookalikesFilterPanel({
  value,
  onChange,
  suggestions = [],
}: PeopleLookalikesFilterProps) {
  const [queryDraft, setQueryDraft] = useState(value.query);
  const [urlsDraft, setUrlsDraft] = useState(value.workUrls);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const allSuggestions = useMemo(
    () => mergePeopleSuggestions(suggestions),
    [suggestions]
  );

  useEffect(() => {
    setQueryDraft(value.query);
    setUrlsDraft(value.workUrls);
  }, [value.query, value.workUrls]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const query = queryDraft.trim().toLowerCase();
  const filteredSuggestions = allSuggestions.filter((person) => {
    if (query.length === 0) return true;
    const haystack = `${person.name} ${person.title} ${person.company}`.toLowerCase();
    return haystack.includes(query);
  });

  function applyFilter(next: PeopleLookalikesFilter) {
    onChange({
      query: next.query.trim(),
      workUrls: next.workUrls.trim(),
      lookalikeOf: next.lookalikeOf,
    });
  }

  function handleSearch() {
    applyFilter({
      query: queryDraft,
      workUrls: urlsDraft,
    });
  }

  function selectSuggestion(person: PeopleLookalikeSuggestion) {
    const nextQuery = formatPeopleLookalikeQuery(person);
    setQueryDraft(nextQuery);
    setOpen(false);
    applyFilter({
      query: nextQuery,
      workUrls: urlsDraft,
      lookalikeOf: suggestionToReference(person),
    });
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      <div ref={ref}>
        <div className="relative">
          <input
            type="text"
            value={queryDraft}
            onChange={(event) => {
              setQueryDraft(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearch();
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Ex: Tim Zheng Apollo.io"
            className="w-full rounded-md border border-slate-300 py-1.5 pl-2.5 pr-8 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label="Toggle people suggestions"
          >
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>

        {open && filteredSuggestions.length > 0 && (
          <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
            {filteredSuggestions.map((person) => (
              <button
                key={person.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(person)}
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-slate-50"
              >
                <PeopleLookalikeAvatar person={person} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-800">
                    {person.name}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">{person.title}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-1 text-[11px] text-slate-400">
          You can refine your search by adding a person&apos;s company name or job title
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Work URLs</label>
        <textarea
          value={urlsDraft}
          onChange={(event) => setUrlsDraft(event.target.value)}
          placeholder="e.g. https://www.linkedin.com/in/john-doe-1234567890/"
          rows={4}
          className="w-full resize-none rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          Use a comma to separate multiple url&apos;s
        </p>
      </div>

      <button
        type="button"
        onClick={handleSearch}
        className="w-full rounded-md bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-amber-500"
      >
        Search
      </button>
    </div>
  );
}
