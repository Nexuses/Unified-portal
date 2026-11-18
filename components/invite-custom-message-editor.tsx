"use client";

import { useEffect, useRef } from "react";
import { isInviteMessageHtmlEmpty } from "@/lib/sanitize-invite-message-html";

type InviteCustomMessageEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  editorKey?: string;
};

function normalizeEditorHtml(html: string) {
  if (isInviteMessageHtmlEmpty(html)) {
    return "";
  }
  return html;
}

export function InviteCustomMessageEditor({
  value,
  onChange,
  placeholder = "Edit the reminder message sent in the email.",
  editorKey = "default",
}: InviteCustomMessageEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (editor.innerHTML !== value) {
      editor.innerHTML = value;
    }
  }, [editorKey, value]);

  function syncValue() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    onChange(normalizeEditorHtml(editor.innerHTML));
  }

  function applyBold() {
    editorRef.current?.focus();
    document.execCommand("bold");
    syncValue();
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-black/15 bg-white">
      <div className="flex items-center gap-1 border-b border-black/10 bg-[#fafaf8] px-2 py-1.5">
        <button
          type="button"
          onClick={applyBold}
          className="inline-flex h-7 min-w-7 items-center justify-center rounded border border-black/15 bg-white px-2 text-xs font-bold text-black hover:bg-black/5"
          title="Bold"
          aria-label="Bold"
        >
          B
        </button>
        <span className="text-[10px] text-black/45">Enter for new line</span>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncValue}
        onBlur={syncValue}
        data-placeholder={placeholder}
        className="min-h-[112px] px-3 py-2 text-sm leading-relaxed text-black outline-none [&:empty]:before:pointer-events-none [&:empty]:before:text-black/35 [&:empty]:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
