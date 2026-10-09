"use client";

import { useEffect, useState } from "react";
import type { Contact } from "@/lib/crm";

export const CONTACT_PICKER_PAGE_SIZE = 100;

export async function fetchContactPage(query = "", pageSize = CONTACT_PICKER_PAGE_SIZE) {
  const params = new URLSearchParams({ page: "1", pageSize: String(pageSize) });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  const response = await fetch(`/api/crm/contacts?${params.toString()}`);
  const data = (await response.json().catch(() => ({}))) as { items?: Contact[] };
  if (!response.ok || !Array.isArray(data.items)) {
    throw new Error("Failed to load contacts");
  }
  return data.items;
}

/** Server-side contact search for pickers; returns null while the query is empty. */
export function useContactSearch(query: string, delayMs = 250) {
  const [results, setResults] = useState<{ query: string; items: Contact[] } | null>(null);
  const needle = query.trim();

  useEffect(() => {
    if (!needle) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchContactPage(needle, 50)
        .then((items) => {
          if (!cancelled) {
            setResults({ query: needle, items });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults({ query: needle, items: [] });
          }
        });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, delayMs]);

  if (!needle) {
    return { items: null, searching: false };
  }
  return {
    items: results?.query === needle ? results.items : null,
    searching: results?.query !== needle,
  };
}
