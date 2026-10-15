"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";
import {
  createFilterPreset,
  loadFilterPresets,
  saveFilterPresets,
  type FilterPreset,
  type FilterPresetPayload,
} from "@/lib/people/filter-presets";
import type { DataView } from "@/lib/people/data-views";

type FilterPresetsMenuProps = {
  view: DataView;
  getPayload: () => FilterPresetPayload;
  onApply: (payload: FilterPresetPayload) => void;
};

export default function FilterPresetsMenu({
  view,
  getPayload,
  onApply,
}: FilterPresetsMenuProps) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPresets(loadFilterPresets(view));
  }, [view]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target || !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function persist(next: FilterPreset[]) {
    setPresets(next);
    saveFilterPresets(view, next);
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [createFilterPreset(view, trimmed, getPayload()), ...presets];
    persist(next);
    setName("");
  }

  function handleDelete(id: string) {
    persist(presets.filter((preset) => preset.id !== id));
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bookmark className="h-4 w-4" />
        Presets
        {presets.length > 0 ? (
          <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">
            {presets.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          role="dialog"
          aria-label="Saved filter presets"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Saved filter presets
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Saves sidebar filters, search, stat tab, and table column filters.
            Does not remove any filter sections.
          </p>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Preset name"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
          {presets.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              No presets yet for this view.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {presets.map((preset) => (
                <li
                  key={preset.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onApply(preset.payload);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 hover:text-blue-700"
                    title={preset.name}
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(preset.id)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete preset ${preset.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
