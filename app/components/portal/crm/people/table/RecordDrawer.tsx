"use client";

import { Download, X } from "lucide-react";
import type { DetailSection } from "./types";

type RecordDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  sections: DetailSection[];
  onClose: () => void;
  onExport?: () => void;
  exporting?: boolean;
  exportButtonLabel?: string;
};

export default function RecordDrawer({
  open,
  title,
  subtitle,
  sections,
  onClose,
  onExport,
  exporting,
  exportButtonLabel = "Export this record",
}: RecordDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/30"
        aria-label="Close record details"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle ? (
              <p className="mt-1 truncate text-sm text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {section.title}
              </h3>
              <dl className="space-y-3">
                {section.fields.map((field) => (
                  <div key={`${section.title}-${field.label}`}>
                    <dt className="text-xs text-slate-500">{field.label}</dt>
                    <dd className="mt-0.5 break-words text-sm text-slate-900">
                      {field.value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        {onExport ? (
          <div className="border-t border-slate-200 px-5 py-4">
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-(--purple) text-white hover:bg-[#5b2fd0] disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Downloading..." : exportButtonLabel}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
