"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus } from "lucide-react";
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  LEAD_STATUS_UI,
  getLeadStatusLabel,
  normalizeLeadStatus,
  type LeadStatus,
} from "@/lib/lead-status";

type LeadReportStageCellProps = {
  value?: string;
  saving?: boolean;
  onSave: (nextLabel: string) => void;
};

export default function LeadReportStageCell({
  value,
  saving = false,
  onSave,
}: LeadReportStageCellProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const hasValue = Boolean(String(value || "").trim());
  const status: LeadStatus | null = hasValue
    ? normalizeLeadStatus(value)
    : null;
  const label = status ? getLeadStatusLabel(status) : "";

  function placeMenu() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(240, Math.min(300, Math.max(rect.width, 220)));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }
    setMenuPos({
      top: rect.bottom + 4,
      left,
      width,
    });
  }

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function selectStatus(next: LeadStatus) {
    const nextLabel = LEAD_STATUS_LABELS[next];
    setOpen(false);
    if (nextLabel === label) return;
    onSave(nextLabel);
  }

  function clearStage() {
    setOpen(false);
    if (!hasValue) return;
    onSave("");
  }

  return (
    <div className="lr-notion-select">
      <button
        ref={triggerRef}
        type="button"
        className={`lr-notion-select-trigger${hasValue ? " has-value" : ""}${open ? " is-open" : ""}`}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (saving) return;
          setOpen((prev) => !prev);
        }}
      >
        {status ? (
          <span className={`lr-notion-stage-token ${LEAD_STATUS_UI[status].badgeClass}`}>
            {label}
          </span>
        ) : (
          <span className="lr-notion-select-empty">
            <Plus aria-hidden="true" />
            Empty
          </span>
        )}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              className="lr-notion-select-menu"
              role="listbox"
              aria-label="Stage"
              style={{
                top: menuPos?.top ?? 0,
                left: menuPos?.left ?? 0,
                width: menuPos?.width ?? 260,
                visibility: menuPos ? "visible" : "hidden",
              }}
            >
              <div className="lr-notion-select-options">
                {LEAD_STATUS_ORDER.map((key) => {
                  const selected = status === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`lr-notion-select-option${selected ? " is-selected" : ""}`}
                      disabled={saving}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectStatus(key)}
                    >
                      <span
                        className={`lr-notion-stage-token ${LEAD_STATUS_UI[key].badgeClass}`}
                      >
                        {LEAD_STATUS_LABELS[key]}
                      </span>
                      {selected ? (
                        <Check className="lr-notion-select-check" aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {hasValue ? (
                <div className="lr-notion-select-foot">
                  <button
                    type="button"
                    className="lr-notion-select-clear"
                    disabled={saving}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={clearStage}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
