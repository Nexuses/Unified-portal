"use client";

import { useId, useState } from "react";
import { sanitizeEventHtml } from "@/lib/sanitize-event-html";

type EventHtmlEditorProps = {
  label?: string;
  value: string;
  onChange: (nextHtml: string) => void;
  required?: boolean;
  placeholder?: string;
  minRows?: number;
  helpText?: string;
};

function isEmptyHtml(html: string) {
  const trimmed = (html ?? "").trim();
  if (!trimmed) {
    return true;
  }
  return trimmed === "<br>" || trimmed === "<div><br></div>" || trimmed === "<p><br></p>";
}

const previewClassName =
  "mt-3 min-h-[280px] rounded-xl border border-black/10 bg-white px-4 py-4 text-sm text-black [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-black/15 [&_blockquote]:pl-4 [&_blockquote]:italic [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-black/20 [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-black/10 [&_td]:p-2 [&_th]:border [&_th]:border-black/10 [&_th]:bg-black/[0.03] [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6";

export function EventHtmlEditor({
  label,
  value,
  onChange,
  required,
  placeholder,
  minRows = 18,
  helpText,
}: EventHtmlEditorProps) {
  const id = useId();
  const [isPreview, setIsPreview] = useState(false);
  const describedBy = `${id}-help`;
  const rowPx = 24;

  return (
    <div className="mt-2">
      {label ? (
        <label className="block" htmlFor={id}>
          <span className="text-sm text-black/70">{label}</span>
        </label>
      ) : null}

      <div className={`${label ? "mt-2" : ""} flex flex-wrap items-center justify-between gap-2`}>
        <p className="text-xs text-black/50">
          Paste or write HTML — headings, links, lists, images, tables, and inline styles are supported.
        </p>
        <button
          type="button"
          onClick={() => setIsPreview((prev) => !prev)}
          className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-black hover:bg-black/5"
        >
          {isPreview ? "Edit HTML" : "Preview"}
        </button>
      </div>

      {isPreview ? (
        <div
          className={previewClassName}
          dangerouslySetInnerHTML={{ __html: sanitizeEventHtml(value) }}
        />
      ) : (
        <div className="mt-3">
          <textarea
            id={id}
            aria-describedby={describedBy}
            className="w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 py-3 font-mono text-sm text-black outline-none transition focus:border-black/30 focus:bg-white"
            style={{ minHeight: `${Math.max(8, minRows) * rowPx}px` }}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
          />
          <p id={describedBy} className="mt-2 text-xs text-black/50">
            {helpText ??
              "Use HTML tags like <h2>, <p>, <a href=\"…\">, <ul>, <img>, and <table>. Unsafe tags and scripts are removed automatically."}
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
