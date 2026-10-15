"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, X } from "lucide-react";
import {
  buildAiSearchQueryParams,
  buildAiSearchRemovableChips,
  removeAiSearchFilterChip,
  type AiSearchFilterChip,
  type AiSearchFilters,
} from "@/lib/people/ai-search";
import type { AssistantPeopleSearchCard } from "@/lib/assistant";
import { ENRICH_PEOPLE_ROUTE, queueEnrichFilters } from "@/lib/people/enrich-people";

const PREVIEW_ROWS = 10;
const COLLAPSED_CHIPS = 8;

type PreviewRow = Record<string, string>;

type RowsState =
  | { status: "loading" }
  | { status: "ready"; rows: PreviewRow[]; total: number }
  | { status: "error"; message: string };

async function fetchRows(filters: AiSearchFilters, signal: AbortSignal) {
  const params = buildAiSearchQueryParams(filters, { page: 1, limit: PREVIEW_ROWS });
  params.set("includeFacets", "0");
  const res = await fetch(`/api/crm/enrich/people?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load people");
  const rows: PreviewRow[] = Array.isArray(data.records) ? data.records : [];
  return { rows, total: Number(data.total ?? rows.length) };
}

function personName(row: PreviewRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "—";
}

export default function PortalPeopleSearchCard({
  card,
  onOpen,
}: {
  card: AssistantPeopleSearchCard;
  onOpen?: () => void;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(card.filters);
  const [edited, setEdited] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);
  const [preview, setPreview] = useState<RowsState>({ status: "loading" });
  const chips = buildAiSearchRemovableChips(filters).filter((chip) => chip.kind !== "view");
  const total = preview.status === "ready" ? preview.total : card.total;
  // Exact-title expansions go last so the user's own terms stay visible when collapsed.
  const orderedChips = [
    ...chips.filter((chip) => chip.kind !== "jobTitle"),
    ...chips.filter((chip) => chip.kind === "jobTitle"),
  ];
  const visibleChips = showAllChips ? orderedChips : orderedChips.slice(0, COLLAPSED_CHIPS);
  const hiddenChips = orderedChips.length - visibleChips.length;

  useEffect(() => {
    const controller = new AbortController();
    fetchRows(filters, controller.signal)
      .then((result) => setPreview({ status: "ready", ...result }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setPreview({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load people",
        });
      });
    return () => controller.abort();
  }, [filters]);

  function removeChip(chip: AiSearchFilterChip) {
    if (!chip.removable) return;
    setPreview({ status: "loading" });
    setFilters(removeAiSearchFilterChip(filters, chip));
    setEdited(true);
  }

  function openInEnrich() {
    queueEnrichFilters(filters);
    router.push(ENRICH_PEOPLE_ROUTE);
    onOpen?.();
  }

  return (
    <div className="pa-people-card mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          People · {total.toLocaleString()} match{total === 1 ? "" : "es"}
        </p>
        <button
          type="button"
          onClick={openInEnrich}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Open in Enrich
        </button>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 py-2">
          {visibleChips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800"
            >
              <span className="truncate">{chip.label}</span>
              {chip.removable ? (
                <button
                  type="button"
                  onClick={() => removeChip(chip)}
                  className="rounded-full p-0.5 text-violet-500 transition hover:bg-violet-100 hover:text-violet-800"
                  aria-label={`Remove ${chip.label}`}
                  title="Remove filter"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
          {hiddenChips > 0 || showAllChips ? (
            <button
              type="button"
              onClick={() => setShowAllChips((value) => !value)}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
            >
              {showAllChips ? "Show less" : `+${hiddenChips} more`}
            </button>
          ) : null}
        </div>
      ) : null}

      {preview.status === "loading" ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading matching people…
        </div>
      ) : preview.status === "error" ? (
        <p className="m-0 px-3 py-3 text-xs text-red-600">{preview.message}</p>
      ) : preview.rows.length === 0 ? (
        <p className="m-0 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          No matching people. Remove a filter or ask me to broaden the search.
        </p>
      ) : (
        <>
          <div className="max-h-64 overflow-auto">
            <table className="min-w-full border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-white">
                <tr>
                  {["Name", "Title", "Company", "Country"].map((label) => (
                    <th
                      key={label}
                      className="whitespace-nowrap border-b border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={row.id ?? index} className="odd:bg-white even:bg-slate-50/60">
                    {[personName(row), row.title, row.company_name, row.contact_country].map(
                      (value, cell) => (
                        <td
                          key={cell}
                          title={value || ""}
                          className="max-w-[160px] truncate border-b border-slate-100 px-2.5 py-1.5 text-slate-700"
                        >
                          {value || "—"}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.total > preview.rows.length ? (
            <p className="m-0 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
              Showing {preview.rows.length} of {preview.total.toLocaleString()}. Open in Enrich to see
              everyone and save them to a list.
            </p>
          ) : null}
        </>
      )}

      <div className="flex flex-col gap-1.5 border-t border-slate-100 px-3 py-2.5">
        <button
          type="button"
          onClick={openInEnrich}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Open in Enrich with these filters
        </button>
        {edited ? (
          <p className="m-0 text-[11px] leading-snug text-slate-500">
            Filters edited. The preview and Enrich use the remaining filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
