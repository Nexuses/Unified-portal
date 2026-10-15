"use client";

import { useEffect, useState } from "react";
import type { DataView } from "@/lib/people/data-views";
import type { FilterSuggestField } from "@/lib/people/filter-suggest-fields";

const SUGGEST_DEBOUNCE_MS = 200;

export function useFilterSuggest(
  field: FilterSuggestField,
  query: string,
  view: DataView,
  enabled = true
) {
  const [options, setOptions] = useState<string[]>([]);
  const trimmed = query.trim();

  useEffect(() => {
    if (!enabled || trimmed.length < 2) {
      setOptions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/crm/enrich/people/suggest?field=${encodeURIComponent(field)}&q=${encodeURIComponent(trimmed)}&view=${view}`,
        { cache: "no-store", signal: controller.signal }
      )
        .then((res) => (res.ok ? res.json() : { options: [] }))
        .then((data) => {
          setOptions(
            Array.isArray(data.options)
              ? data.options.filter((value: unknown): value is string => typeof value === "string")
              : []
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setOptions([]);
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, field, trimmed, view]);

  return options;
}
