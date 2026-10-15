"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectionMenuMode = "count" | "page" | "all";

export type SelectionMenuApplyPayload = {
  mode: SelectionMenuMode;
  count: number;
  maxPerCompany: number | null;
};

type SelectionMenuProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  entityLabel: string;
  pageCount: number;
  totalCount: number;
  selecting?: boolean;
  showMaxPerCompany?: boolean;
  onApply: (payload: SelectionMenuApplyPayload) => void | Promise<void>;
};

export default function SelectionMenu({
  open,
  onClose,
  anchorRef,
  entityLabel,
  pageCount,
  totalCount,
  selecting = false,
  showMaxPerCompany = false,
  onApply,
}: SelectionMenuProps) {
  const [mode, setMode] = useState<SelectionMenuMode>("count");
  const [count, setCount] = useState(String(Math.max(totalCount, 0) || 0));
  const [maxPerCompanyEnabled, setMaxPerCompanyEnabled] = useState(false);
  const [maxPerCompany, setMaxPerCompany] = useState("2");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setMode("count");
    setCount(String(Math.max(totalCount, 0)));
    setMaxPerCompanyEnabled(false);
    setMaxPerCompany("2");
  }, [open, totalCount]);

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const anchor = anchorRef.current;
      const menu = rootRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const menuWidth = menu?.offsetWidth || 352;
      const menuHeight = menu?.offsetHeight || 320;
      const gap = 6;

      let left = rect.left;
      let top = rect.bottom + gap;

      // Keep fully inside the viewport
      left = Math.min(left, window.innerWidth - menuWidth - 12);
      left = Math.max(12, left);

      if (top + menuHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - menuHeight - gap);
      }

      setPosition({ top, left });
    }

    updatePosition();
    // Re-measure after first paint so we have real menu size
    const raf = requestAnimationFrame(updatePosition);

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  const parsedCount = Math.max(0, Math.floor(Number(count) || 0));
  const parsedMaxPerCompany = Math.max(1, Math.floor(Number(maxPerCompany) || 1));
  const canApply =
    !selecting &&
    (mode !== "count" || (parsedCount > 0 && parsedCount <= totalCount));

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Select ${entityLabel}`}
      className="fixed z-[200] w-[22rem] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="radio"
            name="selection-mode"
            checked={mode === "count"}
            onChange={() => setMode("count")}
            className="mt-1 h-4 w-4 shrink-0 accent-slate-900"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-800">
              Select number of {entityLabel}
            </span>
            <input
              type="number"
              min={1}
              max={Math.max(totalCount, 1)}
              value={count}
              disabled={mode !== "count"}
              onChange={(e) => {
                setMode("count");
                setCount(e.target.value);
              }}
              onFocus={() => setMode("count")}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            {showMaxPerCompany ? (
              <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={maxPerCompanyEnabled}
                  disabled={mode !== "count"}
                  onChange={(e) => {
                    setMode("count");
                    setMaxPerCompanyEnabled(e.target.checked);
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-900"
                />
                <span className="text-sm text-slate-700">Max people per company</span>
                <input
                  type="number"
                  min={1}
                  value={maxPerCompany}
                  disabled={mode !== "count" || !maxPerCompanyEnabled}
                  onChange={(e) => setMaxPerCompany(e.target.value)}
                  className="ml-auto w-14 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
              </label>
            ) : null}
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="radio"
            name="selection-mode"
            checked={mode === "page"}
            onChange={() => setMode("page")}
            className="h-4 w-4 shrink-0 accent-slate-900"
          />
          <span className="flex-1 text-sm font-medium text-slate-800">
            Select this page
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {pageCount.toLocaleString()}
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="radio"
            name="selection-mode"
            checked={mode === "all"}
            onChange={() => setMode("all")}
            className="h-4 w-4 shrink-0 accent-slate-900"
          />
          <span className="flex-1 text-sm font-medium text-slate-800">Select all</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {totalCount.toLocaleString()}
          </span>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={selecting}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            void onApply({
              mode,
              count: parsedCount,
              maxPerCompany:
                mode === "count" && showMaxPerCompany && maxPerCompanyEnabled
                  ? parsedMaxPerCompany
                  : null,
            });
          }}
          className="rounded-lg px-4 py-1.5 text-sm font-semibold bg-(--purple) text-white hover:bg-[#5b2fd0] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selecting ? "Applying..." : "Apply"}
        </button>
      </div>
    </div>,
    document.body
  );
}
