"use client";

import { useId, useLayoutEffect, useRef, useState, type ClipboardEvent } from "react";
import { sanitizeBasicHtml } from "@/lib/sanitize-basic-html";

type RichTextEditorProps = {
  label: string;
  value: string;
  onChange: (nextHtml: string) => void;
  required?: boolean;
  placeholder?: string;
  minRows?: number;
  /** Adds “Header” (H2) and “Divider” (horizontal rule) to the toolbar. */
  showHeadingAndDivider?: boolean;
  helpText?: string;
};

function isEmptyHtml(html: string) {
  const trimmed = (html ?? "").trim();
  if (!trimmed) return true;
  return trimmed === "<br>" || trimmed === "<div><br></div>" || trimmed === "<p><br></p>";
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function RichTextEditor({
  label,
  value,
  onChange,
  required,
  placeholder,
  minRows = 4,
  showHeadingAndDivider = false,
  helpText,
}: RichTextEditorProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);

  const rowPx = minRows >= 12 ? 28 : 24;

  // Re-sync when `value` changes, and when leaving Preview (contenteditable remounts empty if `value` is unchanged).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (el.innerHTML !== (value ?? "")) {
      el.innerHTML = value ?? "";
    }
  }, [value, isPreview]);

  function flushChange() {
    const el = ref.current;
    if (!el) return;
    onChange(el.innerHTML);
  }

  function exec(command: "italic" | "bold" | "removeFormat") {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand(command);
    flushChange();
  }

  function applyHeading() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand("formatBlock", false, "h2");
    flushChange();
  }

  function insertDivider() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const ok = document.execCommand("insertHorizontalRule", false);
    if (!ok) {
      document.execCommand("insertHTML", false, "<hr>");
    }
    flushChange();
  }

  /** Wraps the current non-collapsed selection in a relative font-size span (sanitizer allows only these). */
  function adjustSelectionFontSize(direction: "larger" | "smaller") {
    const editor = ref.current;
    if (!editor) {
      return;
    }
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      return;
    }
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    const em = direction === "larger" ? "1.125" : "0.889";
    const span = document.createElement("span");
    span.setAttribute("style", `font-size:${em}em`);

    try {
      const fragment = range.extractContents();
      if (!fragment.textContent?.trim()) {
        range.insertNode(fragment);
        flushChange();
        return;
      }
      span.appendChild(fragment);
      range.insertNode(span);
      sel.removeAllRanges();
      const next = document.createRange();
      next.selectNodeContents(span);
      next.collapse(false);
      sel.addRange(next);
    } catch {
      return;
    }
    flushChange();
  }

  function togglePreview() {
    const el = ref.current;
    if (!isPreview && el) {
      onChange(el.innerHTML);
    }
    setIsPreview((prev) => !prev);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;

    event.preventDefault();

    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");

    if (html) {
      const cleaned = sanitizeBasicHtml(html);
      document.execCommand("insertHTML", false, cleaned);
      flushChange();
      return;
    }

    const escaped = escapeHtml(text || "");
    const withBreaks = escaped.replace(/\r?\n/g, "<br>");
    document.execCommand("insertHTML", false, withBreaks);
    flushChange();
  }

  const describedBy = `${id}-help`;
  const defaultHelp = showHeadingAndDivider
    ? "Select text first: Larger / Smaller change size; Header and Divider structure the page."
    : "Select text first, then Bold, Italic, or Larger / Smaller for font size.";

  return (
    <div className="mt-2">
      {label ? (
        <label className="block" htmlFor={id}>
          <span className="text-sm text-black/70">{label}</span>
        </label>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exec("removeFormat")}
            className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
          >
            Normal
          </button>
          <button
            type="button"
            onClick={() => exec("italic")}
            className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
          >
            Italic
          </button>
          <button
            type="button"
            onClick={() => exec("bold")}
            className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
          >
            Bold
          </button>
          <button
            type="button"
            title="Increase font size for selected text"
            onClick={() => adjustSelectionFontSize("larger")}
            className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-black hover:bg-black/5"
          >
            A+
          </button>
          <button
            type="button"
            title="Decrease font size for selected text"
            onClick={() => adjustSelectionFontSize("smaller")}
            className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-black hover:bg-black/5"
          >
            A-
          </button>
          {showHeadingAndDivider ? (
            <>
              <button
                type="button"
                onClick={applyHeading}
                className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
              >
                Header
              </button>
              <button
                type="button"
                onClick={insertDivider}
                className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
              >
                Divider
              </button>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={togglePreview}
          className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
        >
          {isPreview ? "Edit" : "Preview"}
        </button>
      </div>

      {isPreview ? (
        <div
          className="mt-3 min-h-[140px] rounded-xl border border-black/10 bg-white px-3 py-3 text-sm text-black [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-black/20"
          dangerouslySetInnerHTML={{ __html: sanitizeBasicHtml(value) }}
        />
      ) : (
        <div className="mt-3">
          <div className="relative">
            {!hasFocus && isEmptyHtml(value) && placeholder ? (
              <div className="pointer-events-none absolute left-3 top-3 text-sm text-black/35">
                {placeholder}
              </div>
            ) : null}
            <div
              id={id}
              ref={ref}
              role="textbox"
              aria-multiline="true"
              aria-describedby={describedBy}
              contentEditable
              className="w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 py-3 text-sm text-black outline-none transition focus:border-black/30 focus:bg-white [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-black/20"
              style={{ minHeight: `${Math.max(3, minRows) * rowPx}px` }}
              onFocus={() => setHasFocus(true)}
              onBlur={() => setHasFocus(false)}
              onInput={(event) => onChange((event.currentTarget as HTMLDivElement).innerHTML)}
              onPaste={handlePaste}
              suppressContentEditableWarning
            />
          </div>

          <p id={describedBy} className="mt-2 text-xs text-black/50">
            {helpText ?? defaultHelp}
          </p>

          {required ? (
            <input
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute h-0 w-0 opacity-0"
              required
              value={isEmptyHtml(value) ? "" : "ok"}
              onChange={() => {}}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
