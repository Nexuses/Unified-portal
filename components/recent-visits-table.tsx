"use client";

import { useMemo, useState } from "react";

const PAGE_SIZE = 20;

export type RecentVisitRow = {
  id: string;
  createdAt: string;
  device: string;
  browser: string;
  os: string;
  referrerHost: string;
  country: string;
  region: string;
  city: string;
  timezone: string;
  path: string;
};

type RecentVisitsTableProps = {
  views: RecentVisitRow[];
};

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecentVisitsTable({ views }: RecentVisitsTableProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(views.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return views.slice(start, start + PAGE_SIZE);
  }, [views, currentPage]);

  const rangeStart = views.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, views.length);

  if (views.length === 0) {
    return (
      <p className="mt-4 text-sm text-black/55">
        No visits recorded yet. Open the public page to generate the first analytics event.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-[11px] font-semibold tracking-wide text-black/50 uppercase">
              <th className="px-2 py-2 font-semibold">When</th>
              <th className="px-2 py-2 font-semibold">Device</th>
              <th className="px-2 py-2 font-semibold">Browser</th>
              <th className="px-2 py-2 font-semibold">OS</th>
              <th className="px-2 py-2 font-semibold">Referrer</th>
              <th className="px-2 py-2 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((view) => (
              <tr key={view.id} className="border-b border-black/6 text-black/75 last:border-b-0">
                <td className="whitespace-nowrap px-2 py-2.5 text-xs">{formatWhen(view.createdAt)}</td>
                <td className="px-2 py-2.5 capitalize">{view.device}</td>
                <td className="px-2 py-2.5">{view.browser}</td>
                <td className="px-2 py-2.5">{view.os}</td>
                <td className="px-2 py-2.5">{view.referrerHost || "Direct"}</td>
                <td className="px-2 py-2.5">
                  {[view.city, view.region, view.country].filter(Boolean).join(", ") ||
                    view.timezone ||
                    "Unknown"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/8 pt-4">
        <p className="text-xs text-black/55">
          Showing {rangeStart}-{rangeEnd} of {views.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1}
            className="inline-flex h-8 items-center rounded-lg border border-black/15 px-3 text-xs font-medium text-black/75 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs font-medium text-black/60">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages}
            className="inline-flex h-8 items-center rounded-lg border border-black/15 px-3 text-xs font-medium text-black/75 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
