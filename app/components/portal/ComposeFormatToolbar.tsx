"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useSpeechInput } from "@/lib/use-speech-input";

const TEXT_COLORS = [
  "#111827",
  "#374151",
  "#6b7280",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];

const BG_COLORS = [
  "transparent",
  "#fef08a",
  "#bbf7d0",
  "#bfdbfe",
  "#e9d5ff",
  "#fecaca",
  "#fed7aa",
  "#e5e7eb",
];

/** Quick picks (px). Users can also type any size in the number field. */
const FONT_SIZE_PRESETS_PX = [12, 14, 16, 18, 20, 24, 28, 32];
const DEFAULT_FONT_SIZE_PX = 14;
const MIN_FONT_SIZE_PX = 8;
const MAX_FONT_SIZE_PX = 96;

function IconBold() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M7 5h6.2c2.4 0 4.1 1.5 4.1 3.6 0 1.5-.9 2.7-2.3 3.2v.1c1.8.5 3 1.9 3 3.7C18 18.4 16 20 13.3 20H7V5zm3.1 5.8h2.7c1.1 0 1.8-.6 1.8-1.5s-.7-1.4-1.8-1.4h-2.7v2.9zm0 6.3h3.1c1.2 0 2-.7 2-1.7s-.8-1.6-2.1-1.6h-3v3.3z"
      />
    </svg>
  );
}

function IconItalic() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M10 5h9v2.2h-3.2l-3.4 9.6H16V19H7v-2.2h3.1L13.5 7.2H10V5z"
      />
    </svg>
  );
}

function IconUnderline() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M7 4h2.4v8.2c0 2.2 1.4 3.5 3.6 3.5s3.6-1.3 3.6-3.5V4H19v8.3c0 3.5-2.4 5.7-6 5.7s-6-2.2-6-5.7V4zM6 20h12v2H6v-2z"
      />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M10.5 13.5a4.5 4.5 0 0 0 6.4.2l2.1-2.1a4.5 4.5 0 1 0-6.4-6.4l-1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M13.5 10.5a4.5 4.5 0 0 0-6.4-.2l-2.1 2.1a4.5 4.5 0 1 0 6.4 6.4l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBulletList() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <circle cx="5" cy="7" r="1.5" fill="currentColor" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="5" cy="17" r="1.5" fill="currentColor" />
      <path
        fill="currentColor"
        d="M9 6h11v2H9V6zm0 5h11v2H9v-2zm0 5h11v2H9v-2z"
      />
    </svg>
  );
}

function IconNumberList() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h1.6v4.2H4.4V7.8H3.2V6.6h1.2V5zm-.8 7.4h2.6v1.1L4 16.4h2v1.1H3v-1.2l1.8-2.8H3.2v-1.1zM9 6h11v2H9V6zm0 5h11v2H9v-2zm0 5h11v2H9v-2z"
      />
    </svg>
  );
}

function IconAlignLeft() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm0 4h10v2H4V9zm0 4h16v2H4v-2zm0 4h12v2H4v-2z"
      />
    </svg>
  );
}

function IconAlignCenter() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm3 4h10v2H7V9zm-3 4h16v2H4v-2zm2 4h12v2H6v-2z"
      />
    </svg>
  );
}

function IconAlignRight() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm6 4h10v2H10V9zm-6 4h16v2H4v-2zm4 4h12v2H8v-2z"
      />
    </svg>
  );
}

function IconIndent() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm8 4h8v2h-8V9zm0 4h8v2h-8v-2zM4 17h16v2H4v-2zm1.2-7.3 3.3 2.3-3.3 2.3V9.7z"
      />
    </svg>
  );
}

function IconOutdent() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm8 4h8v2h-8V9zm0 4h8v2h-8v-2zM4 17h16v2H4v-2zm7.1-4.7-3.3-2.3v4.6l3.3-2.3z"
      />
    </svg>
  );
}

function IconQuote() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M8.2 17.5c-2.2 0-3.7-1.6-3.7-3.9 0-2.6 1.9-5.2 5-7.1l.9 1.3c-2.1 1.3-3.2 2.8-3.2 4.5 0 .4.1.7.2 1 .6-.4 1.3-.6 2.1-.6 1.5 0 2.6 1 2.6 2.5s-1.2 2.3-2.9 2.3zm9.1 0c-2.2 0-3.7-1.6-3.7-3.9 0-2.6 1.9-5.2 5-7.1l.9 1.3c-2.1 1.3-3.2 2.8-3.2 4.5 0 .4.1.7.2 1 .6-.4 1.3-.6 2.1-.6 1.5 0 2.6 1 2.6 2.5s-1.2 2.3-2.9 2.3z"
      />
    </svg>
  );
}

function IconTextStyle() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M5 5h14v2.2h-5.4V19h-3.2V7.2H5V5zm2 15h10v2H7v-2z"
      />
    </svg>
  );
}

function IconTextColor() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M5 4h14v2.2h-5.4V16h-3.2V6.2H5V4zm1 16h12v2H6v-2z"
      />
    </svg>
  );
}

function IconBgColor() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M16.6 3.4 9.2 10.8l4 4 7.4-7.4-4-4zM8.1 12.5 4 18.8c-.6.9.1 2.2 1.2 2.2h5.3l3.2-4.5-5.6-4z"
      />
    </svg>
  );
}

function IconFontSize() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M3 6h10v2.1H9.7V18H7.3V8.1H3V6zm12.2 4H21v1.8h-2.2V18h-2.1v-6.2H14v-1.8h1.2z"
      />
    </svg>
  );
}

function IconClear() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M5.5 4h9.2l1.5 1.5-7.4 7.4L5.5 9.6V4zm9.8 2.1L18 9.8l-7.4 7.4-2.7-2.7 7.4-7.4zM4 19h16v2H4v-2z"
      />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
      <path
        d="M3 4.5 6 7.5 9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type MenuId = "align" | "style" | "fontSize" | null;

type Props = {
  disabled?: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  onChange: () => void;
  campaignName?: string;
  /** Insert AI-written plain text into the editor. */
  onApplyAiText: (text: string) => void;
};

function IconSparkle() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
      <path
        d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMic() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

export default function ComposeFormatToolbar({
  disabled = false,
  editorRef,
  onChange,
  campaignName = "",
  onApplyAiText,
}: Props) {
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const [styleSub, setStyleSub] = useState<"color" | "bg" | "size" | null>(
    null,
  );
  const [fontSizePx, setFontSizePx] = useState(String(DEFAULT_FONT_SIZE_PX));
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const aiSpeech = useSpeechInput({
    value: aiPrompt,
    onChange: setAiPrompt,
  });

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      savedSelectionRef.current = null;
      return;
    }
    const range = selection.getRangeAt(0);
    const editor = editorRef.current;
    if (!editor || !editor.contains(range.commonAncestorContainer)) {
      savedSelectionRef.current = null;
      return;
    }
    savedSelectionRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const range = savedSelectionRef.current;
    const editor = editorRef.current;
    if (!range || !editor) {
      ensureCaretInEditor();
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
        setStyleSub(null);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openMenu]);

  function focusEditor() {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    el.focus();
  }

  function ensureCaretInEditor() {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    el.focus();
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    // Empty editor: seed a paragraph so list commands have a block to wrap.
    if (!el.innerHTML.trim() || el.innerHTML === "<br>") {
      el.innerHTML = "<p><br></p>";
    }
    if (selection.rangeCount === 0 || !el.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function runCommand(command: string, value?: string) {
    if (disabled) {
      return;
    }
    ensureCaretInEditor();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* ignore unsupported command */
    }
    onChange();
  }

  function applyList(ordered: boolean) {
    if (disabled) {
      return;
    }
    ensureCaretInEditor();
    const command = ordered ? "insertOrderedList" : "insertUnorderedList";
    let ok = false;
    try {
      ok = document.execCommand(command, false);
    } catch {
      ok = false;
    }
    // Fallback when the browser refuses to toggle a list on the current block.
    if (!ok) {
      const el = editorRef.current;
      if (el) {
        const tag = ordered ? "ol" : "ul";
        const selected = window.getSelection()?.toString().trim();
        const itemText = selected || "List item";
        document.execCommand(
          "insertHTML",
          false,
          `<${tag}><li>${itemText}</li></${tag}><p><br></p>`,
        );
      }
    }
    onChange();
  }

  function applyLink() {
    if (disabled) {
      return;
    }
    ensureCaretInEditor();
    const existing = document.queryCommandValue("createLink") || "https://";
    const url = window.prompt("Link URL", existing.startsWith("http") ? existing : "https://");
    if (!url) {
      return;
    }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    runCommand("createLink", href);
  }

  function applyFontSizePx(raw: string | number) {
    if (disabled) {
      return;
    }
    const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const px = Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, Math.round(parsed)));
    setFontSizePx(String(px));
    restoreSelection();
    // execCommand only accepts sizes 1–7; stamp size 7 then rewrite to real px.
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* optional */
    }
    try {
      document.execCommand("fontSize", false, "7");
    } catch {
      onChange();
      return;
    }
    const editor = editorRef.current;
    if (editor) {
      const targets = [
        ...editor.querySelectorAll("font[size='7']"),
        ...editor.querySelectorAll("span[style]"),
      ].filter((node, index, list) => list.indexOf(node) === index);
      for (const node of targets) {
        if (node instanceof HTMLFontElement && node.getAttribute("size") === "7") {
          const span = document.createElement("span");
          span.style.fontSize = `${px}px`;
          while (node.firstChild) {
            span.appendChild(node.firstChild);
          }
          node.replaceWith(span);
          continue;
        }
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        const current = node.style.fontSize.toLowerCase();
        if (
          current === "xx-large" ||
          current === "-webkit-xxx-large" ||
          current === "xxx-large"
        ) {
          node.style.fontSize = `${px}px`;
        }
      }
    }
    rememberSelection();
    onChange();
    setOpenMenu(null);
    setStyleSub(null);
  }

  function ToolButton({
    label,
    onClick,
    active,
    children,
  }: {
    label: string;
    onClick: () => void;
    active?: boolean;
    children: ReactNode;
  }) {
    return (
      <button
        type="button"
        className={`drip-fmt-btn${active ? " is-active" : ""}`}
        aria-label={label}
        title={label}
        disabled={disabled}
        onMouseDown={(event) => {
          // Keep selection in the contentEditable.
          event.preventDefault();
        }}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  async function generateAiDraft() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) {
      return;
    }
    aiSpeech.stop();
    setAiBusy(true);
    setAiError("");
    try {
      const response = await fetch("/api/campaigns/write-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          campaignName: campaignName || undefined,
        }),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text?.trim()) {
        throw new Error(data.error || "Could not write the email.");
      }
      onApplyAiText(data.text.trim());
      setAiOpen(false);
      setAiPrompt("");
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : "Could not write the email.",
      );
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="drip-fmt-dock" ref={rootRef}>
      {aiOpen ? (
        <div className="drip-fmt-ai-panel" role="region" aria-label="Write with AI">
          <div className="drip-fmt-ai-bar">
            <span className="drip-fmt-ai-icon" aria-hidden>
              <IconSparkle />
            </span>
            <input
              className="drip-fmt-ai-input"
              value={aiPrompt}
              disabled={aiBusy}
              placeholder="Tell AI what to write, e.g. short intro for APAC CFOs with a soft CTA"
              aria-label="What the AI email should say"
              onChange={(event) => {
                setAiError("");
                setAiPrompt(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void generateAiDraft();
                }
                if (event.key === "Escape") {
                  aiSpeech.stop();
                  setAiOpen(false);
                }
              }}
            />
            {aiSpeech.supported ? (
              <button
                type="button"
                className={`drip-fmt-ai-mic${aiSpeech.listening ? " is-listening" : ""}`}
                onClick={aiSpeech.toggle}
                disabled={aiBusy}
                aria-pressed={aiSpeech.listening}
                aria-label={aiSpeech.listening ? "Stop speaking" : "Speak brief"}
                title={
                  aiSpeech.listening ? "Stop speaking" : "Speak instead of typing"
                }
              >
                {aiSpeech.listening ? (
                  <span className="drip-fmt-ai-mic-wave" aria-hidden>
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <IconMic />
                )}
              </button>
            ) : null}
            <button
              type="button"
              className="drip-fmt-ai-insert"
              disabled={aiBusy || !aiPrompt.trim()}
              onClick={() => void generateAiDraft()}
            >
              {aiBusy ? "Writing…" : "Insert"}
            </button>
            <button
              type="button"
              className="drip-fmt-ai-dismiss"
              aria-label="Close Write with AI"
              disabled={aiBusy}
              onClick={() => {
                aiSpeech.stop();
                setAiOpen(false);
              }}
            >
              ×
            </button>
          </div>
          {aiSpeech.error ? (
            <div className="drip-fmt-ai-error">{aiSpeech.error}</div>
          ) : null}
          {aiError ? <div className="drip-fmt-ai-error">{aiError}</div> : null}
        </div>
      ) : null}

      <div className="drip-fmt-toolbar" role="toolbar" aria-label="Text formatting">
      <div className="drip-fmt-group">
        <ToolButton label="Bold" onClick={() => runCommand("bold")}>
          <IconBold />
        </ToolButton>
        <ToolButton label="Italic" onClick={() => runCommand("italic")}>
          <IconItalic />
        </ToolButton>
        <ToolButton label="Underline" onClick={() => runCommand("underline")}>
          <IconUnderline />
        </ToolButton>
      </div>

      <span className="drip-fmt-sep" aria-hidden />

      <div className="drip-fmt-group">
        <ToolButton label="Insert link" onClick={applyLink}>
          <IconLink />
        </ToolButton>
      </div>

      <span className="drip-fmt-sep" aria-hidden />

      <div className="drip-fmt-group">
        <ToolButton
          label="Bulleted list"
          onClick={() => applyList(false)}
        >
          <IconBulletList />
        </ToolButton>
        <ToolButton
          label="Numbered list"
          onClick={() => applyList(true)}
        >
          <IconNumberList />
        </ToolButton>
      </div>

      <span className="drip-fmt-sep" aria-hidden />

      <div className="drip-fmt-menu-wrap">
        <button
          type="button"
          className={`drip-fmt-btn drip-fmt-btn-caret${openMenu === "style" ? " is-active" : ""}`}
          aria-label="Text style"
          title="Text style"
          aria-expanded={openMenu === "style"}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpenMenu((current) => (current === "style" ? null : "style"));
            setStyleSub(null);
          }}
        >
          <IconTextStyle />
          <IconChevron />
        </button>
        {openMenu === "style" ? (
          <div className="drip-fmt-menu" role="menu">
            {styleSub === null ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setStyleSub("color")}
                >
                  <IconTextColor />
                  Text Color
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setStyleSub("bg")}
                >
                  <IconBgColor />
                  Background Color
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="has-sub"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    rememberSelection();
                    setFontSizePx(String(DEFAULT_FONT_SIZE_PX));
                    setStyleSub("size");
                  }}
                >
                  <IconFontSize />
                  Font Size
                  <span className="drip-fmt-menu-chevron" aria-hidden>
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    runCommand("removeFormat");
                    setOpenMenu(null);
                  }}
                >
                  <IconClear />
                  Clear Formatting
                </button>
              </>
            ) : null}
            {styleSub === "color" ? (
              <div className="drip-fmt-swatches" role="group" aria-label="Text color">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="drip-fmt-swatch"
                    style={{ background: color }}
                    aria-label={color}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      runCommand("foreColor", color);
                      setOpenMenu(null);
                      setStyleSub(null);
                    }}
                  />
                ))}
              </div>
            ) : null}
            {styleSub === "bg" ? (
              <div className="drip-fmt-swatches" role="group" aria-label="Background color">
                {BG_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="drip-fmt-swatch"
                    style={{
                      background: color === "transparent" ? "#fff" : color,
                      backgroundImage:
                        color === "transparent"
                          ? "linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%),linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%)"
                          : undefined,
                      backgroundSize: color === "transparent" ? "8px 8px" : undefined,
                      backgroundPosition:
                        color === "transparent" ? "0 0, 4px 4px" : undefined,
                    }}
                    aria-label={color}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      // hiliteColor works in most browsers; backColor as fallback.
                      focusEditor();
                      const ok = document.execCommand("hiliteColor", false, color);
                      if (!ok) {
                        document.execCommand("backColor", false, color);
                      }
                      onChange();
                      setOpenMenu(null);
                      setStyleSub(null);
                    }}
                  />
                ))}
              </div>
            ) : null}
            {styleSub === "size" ? (
              <div className="drip-fmt-size-panel" role="group" aria-label="Font size">
                <div className="drip-fmt-size-input-row">
                  <label className="drip-fmt-size-input-label" htmlFor="drip-fmt-font-size">
                    Size
                  </label>
                  <input
                    id="drip-fmt-font-size"
                    type="number"
                    className="drip-fmt-size-input"
                    min={MIN_FONT_SIZE_PX}
                    max={MAX_FONT_SIZE_PX}
                    step={1}
                    value={fontSizePx}
                    placeholder="14"
                    onMouseDown={() => rememberSelection()}
                    onChange={(event) => setFontSizePx(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyFontSizePx(fontSizePx);
                      }
                    }}
                  />
                  <span className="drip-fmt-size-unit">px</span>
                  <button
                    type="button"
                    className="drip-fmt-size-apply"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFontSizePx(fontSizePx)}
                  >
                    Apply
                  </button>
                </div>
                <div className="drip-fmt-size-presets">
                  {FONT_SIZE_PRESETS_PX.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`drip-fmt-size-chip${fontSizePx === String(size) ? " is-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFontSizePx(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="drip-fmt-menu-wrap">
        <button
          type="button"
          className={`drip-fmt-btn drip-fmt-btn-caret${openMenu === "align" ? " is-active" : ""}`}
          aria-label="Alignment"
          title="Alignment"
          aria-expanded={openMenu === "align"}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpenMenu((current) => (current === "align" ? null : "align"));
            setStyleSub(null);
          }}
        >
          <IconAlignLeft />
          <IconChevron />
        </button>
        {openMenu === "align" ? (
          <div className="drip-fmt-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                runCommand("justifyLeft");
                setOpenMenu(null);
              }}
            >
              <IconAlignLeft />
              Align Left
            </button>
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                runCommand("justifyCenter");
                setOpenMenu(null);
              }}
            >
              <IconAlignCenter />
              Align Center
            </button>
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                runCommand("justifyRight");
                setOpenMenu(null);
              }}
            >
              <IconAlignRight />
              Align Right
            </button>
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                runCommand("indent");
                setOpenMenu(null);
              }}
            >
              <IconIndent />
              Indent
            </button>
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                runCommand("outdent");
                setOpenMenu(null);
              }}
            >
              <IconOutdent />
              Outdent
            </button>
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                runCommand("formatBlock", "blockquote");
                setOpenMenu(null);
              }}
            >
              <IconQuote />
              Block Quote
            </button>
          </div>
        ) : null}
      </div>

      <span className="drip-fmt-sep" aria-hidden />

      <button
        type="button"
        className={`drip-fmt-ai-btn${aiOpen ? " is-open" : ""}`}
        disabled={disabled || aiBusy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setAiError("");
          setOpenMenu(null);
          setAiOpen((open) => {
            if (open) {
              aiSpeech.stop();
            }
            return !open;
          });
        }}
      >
        <IconSparkle />
        Write with AI
      </button>
      </div>
    </div>
  );
}
