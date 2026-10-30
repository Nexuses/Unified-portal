"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, ListPlus, Trash2, X } from "lucide-react";

export type BulkListOption = {
  id: string;
  name: string;
  recordCount: number;
};

type BulkToolbarProps = {
  selectedCount: number;
  enableExport?: boolean;
  exporting?: boolean;
  onExport?: () => void;
  enableDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
  onCopyIds: () => void;
  onCopyEmails?: () => void;
  onCopyPhones?: () => void;
  onCopyCompanies?: () => void;
  onClear: () => void;
  lists?: BulkListOption[];
  listsLoading?: boolean;
  listActionBusy?: boolean;
  onAddToList?: (listId: string) => void | Promise<void>;
  onCreateList?: (name: string) => void | Promise<void>;
  /** Save selection (or current matches) into a new CRM list — label has no count. */
  onSaveToList?: () => void;
  saveToListBusy?: boolean;
  /** When set, the bar is centered over this element (table/content) instead of the full screen. */
  contentAnchorRef?: RefObject<HTMLElement | null>;
};

export default function BulkToolbar({
  selectedCount,
  enableExport,
  exporting,
  onExport,
  enableDelete,
  deleting,
  onDelete,
  onCopyIds,
  onCopyEmails,
  onCopyPhones,
  onCopyCompanies,
  onClear,
  lists = [],
  listsLoading = false,
  listActionBusy = false,
  onAddToList,
  onCreateList,
  onSaveToList,
  saveToListBusy = false,
  contentAnchorRef,
}: BulkToolbarProps) {
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const [contentBounds, setContentBounds] = useState<{ left: number; width: number } | null>(
    null,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (listMenuOpen) {
          setListMenuOpen(false);
          setCreating(false);
          setNewListName("");
          return;
        }
        onClear();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClear, listMenuOpen]);

  useEffect(() => {
    if (!listMenuOpen) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target || !menuRef.current?.contains(target)) {
        setListMenuOpen(false);
        setCreating(false);
        setNewListName("");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [listMenuOpen]);

  useEffect(() => {
    if (selectedCount === 0) {
      setContentBounds(null);
      return;
    }
    const el = contentAnchorRef?.current;
    if (!el) {
      setContentBounds(null);
      return;
    }

    const update = () => {
      const rect = el.getBoundingClientRect();
      setContentBounds({ left: rect.left, width: rect.width });
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [contentAnchorRef, selectedCount]);

  if (selectedCount === 0) return null;

  const showListActions = Boolean(onAddToList || onCreateList);

  async function handleCreateList() {
    const trimmed = newListName.trim();
    if (!trimmed || !onCreateList || listActionBusy) return;
    await onCreateList(trimmed);
    setNewListName("");
    setCreating(false);
    setListMenuOpen(false);
  }

  return (
    <div
      className="pointer-events-none fixed bottom-6 z-40 flex justify-center px-4"
      style={
        contentBounds
          ? {
              left: contentBounds.left,
              width: contentBounds.width,
              right: "auto",
            }
          : { insetInline: 0 }
      }
    >
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border-2 border-(--purple) bg-white px-3 py-2 shadow-lg">
        <span className="px-2 text-sm font-medium text-slate-700">
          {selectedCount} selected
        </span>
        {onSaveToList ? (
          <button
            type="button"
            onClick={onSaveToList}
            disabled={saveToListBusy || deleting || exporting}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-(--purple) text-white hover:bg-[#5b2fd0] disabled:opacity-60"
          >
            {saveToListBusy ? "Preparing..." : "Save to list"}
          </button>
        ) : null}
        {enableExport && onExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting || deleting}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-(--purple) text-white hover:bg-[#5b2fd0] disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting..." : "Export Selected"}
          </button>
        ) : null}

        {enableDelete && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting || exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting
              ? "Deleting..."
              : selectedCount === 1
                ? "Delete contact"
                : `Delete ${selectedCount}`}
          </button>
        ) : null}

        {showListActions ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => {
                setListMenuOpen((open) => !open);
                setCreating(false);
                setNewListName("");
              }}
              disabled={listActionBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60"
            >
              <ListPlus className="h-3.5 w-3.5" />
              {listActionBusy ? "Updating..." : "Add to list"}
            </button>
            {listMenuOpen ? (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Choose a list
                </p>
                {listsLoading ? (
                  <p className="px-2 py-3 text-xs text-slate-500">Loading lists...</p>
                ) : lists.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-slate-500">
                    No lists yet for this view.
                  </p>
                ) : (
                  <ul className="max-h-44 space-y-0.5 overflow-y-auto">
                    {lists.map((list) => (
                      <li key={list.id}>
                        <button
                          type="button"
                          disabled={listActionBusy || !onAddToList}
                          onClick={() => {
                            void (async () => {
                              await onAddToList?.(list.id);
                              setListMenuOpen(false);
                            })();
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span className="truncate">{list.name}</span>
                          <span className="ml-2 shrink-0 text-[11px] text-slate-400">
                            {list.recordCount}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-2 border-t border-slate-100 pt-2">
                  {creating ? (
                    <div className="space-y-2 px-1">
                      <input
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="New list name"
                        maxLength={120}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateList();
                          }
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleCreateList()}
                          disabled={listActionBusy || !newListName.trim()}
                          className="flex-1 rounded-lg bg-slate-900 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Create & add
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCreating(false);
                            setNewListName("");
                          }}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!onCreateList || listActionBusy}
                      onClick={() => setCreating(true)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                    >
                      <ListPlus className="h-3.5 w-3.5" />
                      Create new list…
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onCopyIds}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Copy IDs
        </button>
        {onCopyEmails ? (
          <button
            type="button"
            onClick={onCopyEmails}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy Emails
          </button>
        ) : null}
        {onCopyPhones ? (
          <button
            type="button"
            onClick={onCopyPhones}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy Phones
          </button>
        ) : null}
        {onCopyCompanies ? (
          <button
            type="button"
            onClick={onCopyCompanies}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy Companies
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}
