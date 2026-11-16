"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import { notionSelectColor } from "@/lib/notion-select-color";

type LeadReportSolutionCellProps = {
  /** Current solution name ("" when the lead has none). */
  value: string;
  options: string[];
  saving?: boolean;
  /** Saves a single solution name, or "" to clear it on this lead. */
  onSave: (next: string) => void;
  /** Add a new option (and optionally select it). */
  onAddOption?: (name: string) => void;
  /** Remove an option from the dropdown catalog. */
  onRemoveOption?: (name: string) => void;
};

function cleanSolutionName(value: string) {
  return (
    value
      .split(/[,;|]/)
      .map((part) => part.trim())
      .filter(Boolean)[0] ?? ""
  );
}

/**
 * Notion-style select — add/remove options inside the dropdown.
 */
export default function LeadReportSolutionCell({
  value,
  options,
  saving = false,
  onSave,
  onAddOption,
  onRemoveOption,
}: LeadReportSolutionCellProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const current = value.trim();
  const currentColor = notionSelectColor(current || "empty");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = options.length > 0 ? options : current ? [current] : [];
    const unique = Array.from(
      new Set(base.map((item) => item.trim()).filter(Boolean)),
    );
    if (!q) return unique;
    return unique.filter((item) => item.toLowerCase().includes(q));
  }, [options, query, current]);

  const draftName = cleanSolutionName(query);
  const canCreate =
    Boolean(draftName) &&
    !options.some((item) => item.toLowerCase() === draftName.toLowerCase());

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
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
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
      setQuery("");
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function selectValue(next: string) {
    const name = cleanSolutionName(next);
    setOpen(false);
    setQuery("");
    if (name === current) return;
    onSave(name);
  }

  function addOption(selectAfter = true) {
    const name = cleanSolutionName(query);
    if (!name || saving) return;
    onAddOption?.(name);
    setQuery("");
    if (selectAfter) {
      setOpen(false);
      if (name !== current) {
        onSave(name);
      }
    }
  }

  function removeOption(name: string, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (saving || !name) return;
    onRemoveOption?.(name);
  }

  function clearValue(event?: ReactMouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    setOpen(false);
    setQuery("");
    if (!current) return;
    onSave("");
  }

  return (
    <div className="lr-notion-select">
      <button
        ref={triggerRef}
        type="button"
        className={`lr-notion-select-trigger${current ? " has-value" : ""}${open ? " is-open" : ""}`}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (saving) return;
          setOpen((prev) => !prev);
          setQuery("");
        }}
      >
        {current ? (
          <span
            className="lr-notion-select-token is-colored"
            title={current}
            style={{
              background: currentColor.background,
              color: currentColor.color,
            }}
          >
            <span className="lr-notion-select-token-text">{current}</span>
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
              aria-label="Solution"
              style={{
                top: menuPos?.top ?? 0,
                left: menuPos?.left ?? 0,
                width: menuPos?.width ?? 260,
                visibility: menuPos ? "visible" : "hidden",
              }}
            >
              <div className="lr-notion-select-search">
                <input
                  ref={inputRef}
                  value={query}
                  placeholder="Search or type a new solution…"
                  aria-label="Search solutions"
                  disabled={saving}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (canCreate) {
                        addOption(true);
                        return;
                      }
                      if (filtered[0]) {
                        selectValue(filtered[0]);
                      }
                    }
                  }}
                />
              </div>

              <div className="lr-notion-select-options">
                {filtered.length === 0 && !canCreate ? (
                  <div className="lr-notion-select-empty-msg">
                    Type a name, then Add
                  </div>
                ) : null}
                {filtered.map((option) => {
                  const selected =
                    option.toLowerCase() === current.toLowerCase();
                  const color = notionSelectColor(option);
                  return (
                    <div
                      key={option}
                      className={`lr-notion-select-row${selected ? " is-selected" : ""}`}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="lr-notion-select-option"
                        disabled={saving}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectValue(option)}
                      >
                        <span
                          className="lr-notion-select-token is-colored"
                          style={{
                            background: color.background,
                            color: color.color,
                          }}
                        >
                          {option}
                        </span>
                        {selected ? (
                          <Check
                            className="lr-notion-select-check"
                            aria-hidden
                          />
                        ) : null}
                      </button>
                      {onRemoveOption ? (
                        <button
                          type="button"
                          className="lr-notion-select-row-remove"
                          title={`Remove “${option}” from options`}
                          aria-label={`Remove solution option ${option}`}
                          disabled={saving}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => removeOption(option, event)}
                        >
                          <X aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="lr-notion-select-foot is-actions">
                <button
                  type="button"
                  className="lr-notion-select-action is-add"
                  disabled={saving || !canCreate}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addOption(true)}
                >
                  <Plus aria-hidden />
                  {canCreate ? (
                    <>
                      Add{" "}
                      <span
                        className="lr-notion-select-token is-colored"
                        style={{
                          background: notionSelectColor(draftName).background,
                          color: notionSelectColor(draftName).color,
                        }}
                      >
                        {draftName}
                      </span>
                    </>
                  ) : (
                    "Add solution"
                  )}
                </button>
                {current ? (
                  <button
                    type="button"
                    className="lr-notion-select-action is-clear"
                    disabled={saving}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => clearValue()}
                  >
                    Clear from lead
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
