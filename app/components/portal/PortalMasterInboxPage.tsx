"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import type {
  InboxAccount,
  InboxMessage,
  InboxThread,
} from "@/lib/master-inbox-server";
import { portalCampaignRoute } from "@/lib/portal-nav";

const HTML_SIGNATURE_STORAGE_KEY = "portal-inbox-html-signature";
const AUTO_REFRESH_MS = 10 * 60 * 1000;

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const CAMPAIGN_TYPE_LABEL: Record<NonNullable<InboxThread["campaignType"]>, string> = {
  drip: "Drip",
  oneone: "1-1",
  personalise: "Personalise",
};

function simpleHtmlToText(html: string) {
  const doc = new DOMParser().parseFromString(
    html.replace(/\s*\n\s*/g, " "),
    "text/html",
  );
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("li").forEach((li) => li.prepend("- "));
  doc
    .querySelectorAll("p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,tr")
    .forEach((el) => el.append(el.tagName === "LI" ? "\n" : "\n\n"));
  return (doc.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRichHtml(html: string) {
  const lower = html.toLowerCase();
  return (
    lower.includes("<img") ||
    lower.includes("<table") ||
    lower.includes("<blockquote") ||
    lower.includes("<iframe") ||
    lower.includes("<hr") ||
    (html.match(/<(p|div|br|span|a)\b/gi)?.length ?? 0) > 6
  );
}

function InboxMessageHtml({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const fitHeight = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    try {
      const doc = frame.contentDocument;
      const body = doc?.body;
      if (!body) {
        return;
      }
      const height = Math.ceil(
        Math.max(
          body.scrollHeight,
          body.offsetHeight,
          doc.documentElement?.scrollHeight ?? 0,
        ),
      );
      frame.style.height = `${Math.min(Math.max(height + 8, 28), 480)}px`;
    } catch {
      // Ignore cross-origin / sandbox read failures.
    }
  }, []);

  return (
    <iframe
      ref={frameRef}
      className="inbox-message-html"
      title={title}
      sandbox="allow-same-origin"
      srcDoc={html}
      onLoad={fitHeight}
    />
  );
}

function stripHtmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyReplyHtml(html: string) {
  if (!html.trim()) {
    return true;
  }
  if (/<img\b/i.test(html)) {
    return false;
  }
  return !stripHtmlToText(html);
}

const BORDER_STYLE_RE =
  /(?:^|;)\s*(?:border(?:-(?:top|right|bottom|left))?(?:-width|-style|-color)?|outline(?:-width|-style|-color)?)\s*:[^;]*/gi;

function stripBorderStyles(style: string) {
  return style
    .replace(BORDER_STYLE_RE, "")
    .replace(/;;+/g, ";")
    .replace(/^;|;$/g, "")
    .trim();
}

function hasMeaningfulContent(el: Element) {
  if (el.querySelector("img,svg")) {
    return true;
  }
  return (el.textContent || "").replace(/\u00a0/g, " ").trim().length > 0;
}

function applyCleanedStyle(el: HTMLElement, style: string | null) {
  if (!style) {
    el.removeAttribute("style");
    return;
  }
  const cleaned = stripBorderStyles(style);
  if (cleaned) {
    el.setAttribute("style", cleaned);
  } else {
    el.removeAttribute("style");
  }
}

function isUsableImageSrc(src: string) {
  return /^(https?:|data:image\/)/i.test(src.trim());
}

function isInlineDataImageSrc(src: string) {
  return /^data:image\//i.test(src.trim());
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

async function filesToDataUrls(files: File[]) {
  const urls: string[] = [];
  for (const file of files) {
    try {
      urls.push(await readFileAsDataUrl(file));
    } catch {
      // Skip unreadable clipboard files.
    }
  }
  return urls;
}

/** Collect image files from both clipboard items and files lists. */
function collectClipboardImages(clipboard: DataTransfer) {
  const files: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    const key = `${file.type}:${file.size}:${file.name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    files.push(file);
  };

  for (const item of clipboard.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      add(item.getAsFile());
    }
  }
  for (const file of clipboard.files) {
    add(file);
  }
  return files;
}

function stylePastedImage(img: HTMLElement) {
  img.style.maxWidth = "100%";
  img.style.height = "auto";
  if (!img.getAttribute("alt")) {
    img.setAttribute("alt", "");
  }
}

/**
 * Prefer clipboard image bytes for signature logos (same as pre-divider paste).
 * Outlook/Word often put cid:/https attachment URLs that do not load in the editor.
 */
async function embedClipboardImages(html: string, imageFiles: File[]) {
  const dataUrls = await filesToDataUrls(imageFiles);
  const doc = new DOMParser().parseFromString(html || "<div></div>", "text/html");
  const imgs = [...doc.querySelectorAll("img")];
  let clipboardIndex = 0;

  for (const img of imgs) {
    if (!(img instanceof HTMLElement)) {
      continue;
    }
    const src = (img.getAttribute("src") || "").trim();
    // Already inlined — keep.
    if (isInlineDataImageSrc(src)) {
      stylePastedImage(img);
      continue;
    }
    // Clipboard bytes beat remote/cid/file URLs (restores logos that worked before).
    if (clipboardIndex < dataUrls.length) {
      img.setAttribute("src", dataUrls[clipboardIndex]);
      clipboardIndex += 1;
      stylePastedImage(img);
      continue;
    }
    if (!isUsableImageSrc(src)) {
      img.remove();
      continue;
    }
    stylePastedImage(img);
  }

  // No <img> tags in HTML — append clipboard images (old image-only paste path).
  if (imgs.length === 0) {
    for (const dataUrl of dataUrls) {
      const img = doc.createElement("img");
      img.setAttribute("src", dataUrl);
      stylePastedImage(img);
      doc.body.appendChild(img);
    }
  }

  return doc.body.innerHTML;
}

/**
 * Keep pasted signatures/banners; drop scripts/unsafe URLs; kill grid borders.
 * Divider spacers are removed (no replacement line). Images are left for embedClipboardImages.
 */
function sanitizePastedHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,iframe,object,embed,link,meta,form,input,button")
    .forEach((el) => el.remove());

  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        name === "border" ||
        name === "bordercolor" ||
        name === "frame" ||
        name === "rules"
      ) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^\s*javascript:/i.test(value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // Remove divider spacers / hrs — do not insert a replacement line.
  doc.querySelectorAll("p,div,tr,td,th,hr").forEach((el) => {
    if (el.tagName === "HR") {
      el.remove();
      return;
    }
    // Never drop nodes that still contain images.
    if (hasMeaningfulContent(el)) {
      return;
    }
    const style = el.getAttribute("style") || "";
    const height = el instanceof HTMLElement ? el.style.height : "";
    const looksLikeRule =
      /border/i.test(style) ||
      el.hasAttribute("bgcolor") ||
      (/background(?:-color)?\s*:/i.test(style) &&
        (/height\s*:\s*[12](?:\.0)?px/i.test(style) ||
          height === "1px" ||
          height === "2px"));
    if (looksLikeRule) {
      el.remove();
    }
  });

  doc.querySelectorAll("hr").forEach((hr) => hr.remove());

  doc.querySelectorAll("table").forEach((table) => {
    if (!(table instanceof HTMLElement)) {
      return;
    }
    const style = table.getAttribute("style");
    const cleaned = style ? stripBorderStyles(style) : "";
    table.setAttribute(
      "style",
      cleaned
        ? `${cleaned};border:0;border-collapse:collapse;`
        : "border:0;border-collapse:collapse;",
    );
  });

  doc.querySelectorAll("td,th,p,div,span,li,tr,font").forEach((el) => {
    if (!(el instanceof HTMLElement)) {
      return;
    }
    applyCleanedStyle(el, el.getAttribute("style"));
  });

  // Do not delete images here — embedClipboardImages handles src fixing.
  doc.querySelectorAll("img").forEach((img) => {
    if (!(img instanceof HTMLElement)) {
      return;
    }
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    if (!img.getAttribute("alt")) {
      img.setAttribute("alt", "");
    }
  });

  return doc.body.innerHTML;
}

type InboxReplyEditorHandle = {
  insertHtml: (html: string) => void;
  replaceHtml: (html: string) => void;
};

const InboxReplyEditor = forwardRef<
  InboxReplyEditorHandle,
  {
    threadKey: string;
    disabled?: boolean;
    onHtmlChange: (html: string) => void;
    onSubmitShortcut: () => void;
  }
>(function InboxReplyEditor(
  { threadKey, disabled, onHtmlChange, onSubmitShortcut },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.innerHTML = "";
    onHtmlChange("");
  }, [threadKey, onHtmlChange]);

  function syncHtml() {
    const html = editorRef.current?.innerHTML ?? "";
    onHtmlChange(html);
  }

  useImperativeHandle(ref, () => ({
    insertHtml(html: string) {
      const editor = editorRef.current;
      if (!editor || disabled) {
        return;
      }
      const cleaned = sanitizePastedHtml(html).trim();
      if (!cleaned) {
        return;
      }
      const needsBreak = Boolean(
        editor.innerHTML.replace(/\s|&nbsp;/gi, "").length,
      );
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand(
        "insertHTML",
        false,
        `${needsBreak ? "<br><br>" : ""}${cleaned}`,
      );
      syncHtml();
    },
    replaceHtml(html: string) {
      const editor = editorRef.current;
      if (!editor || disabled) {
        return;
      }
      editor.innerHTML = sanitizePastedHtml(html).trim();
      editor.focus();
      syncHtml();
    },
  }));

  async function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }

    const imageFiles = collectClipboardImages(clipboard);
    const html = clipboard.getData("text/html").trim();
    if (html) {
      const cleaned = sanitizePastedHtml(html);
      const withImages = await embedClipboardImages(cleaned, imageFiles);
      document.execCommand("insertHTML", false, withImages);
      syncHtml();
      return;
    }

    if (imageFiles.length > 0) {
      for (const file of imageFiles) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          document.execCommand(
            "insertHTML",
            false,
            `<img src="${dataUrl}" alt="" style="max-width:100%;height:auto;" />`,
          );
        } catch {
          // Ignore unreadable clipboard images.
        }
      }
      syncHtml();
      return;
    }

    const text = clipboard.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
      syncHtml();
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSubmitShortcut();
    }
  }

  return (
    <div
      ref={editorRef}
      id="inbox-reply-body"
      className="inbox-reply-input inbox-reply-editor"
      contentEditable={!disabled}
      role="textbox"
      aria-multiline="true"
      aria-label="Reply message"
      data-placeholder="Write your reply…"
      suppressContentEditableWarning
      onInput={syncHtml}
      onPaste={(event) => {
        void handlePaste(event);
      }}
      onKeyDown={handleKeyDown}
    />
  );
});

export default function PortalMasterInboxPage() {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [inboxes, setInboxes] = useState<InboxAccount[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyHtml, setReplyHtml] = useState("");
  const [replyEditorKey, setReplyEditorKey] = useState(0);
  const [sendingReply, setSendingReply] = useState(false);
  const [error, setError] = useState("");
  const [syncNote, setSyncNote] = useState("");
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureHtmlDraft, setSignatureHtmlDraft] = useState("");
  const replyEditorRef = useRef<InboxReplyEditorHandle>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const selectedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);
  const handleReplyHtmlChange = useCallback((html: string) => {
    setReplyHtml(html);
  }, []);

  function openSignatureModal() {
    try {
      setSignatureHtmlDraft(
        localStorage.getItem(HTML_SIGNATURE_STORAGE_KEY) || "",
      );
    } catch {
      setSignatureHtmlDraft("");
    }
    setSignatureModalOpen(true);
  }

  function closeSignatureModal() {
    setSignatureModalOpen(false);
  }

  function insertHtmlSignature() {
    const raw = signatureHtmlDraft.trim();
    if (!raw) {
      return;
    }
    try {
      localStorage.setItem(HTML_SIGNATURE_STORAGE_KEY, raw);
    } catch {
      // Ignore storage failures (private mode / quota).
    }
    replyEditorRef.current?.insertHtml(raw);
    setSignatureModalOpen(false);
  }

  const loadThreads = useCallback(async (inboxId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError("");
    }
    try {
      const params = new URLSearchParams();
      if (inboxId && inboxId !== "all") {
        params.set("senderId", inboxId);
      }
      const query = params.toString();
      const response = await fetch(query ? `/api/inbox?${query}` : "/api/inbox");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load inbox");
      }
      setThreads(Array.isArray(data.threads) ? data.threads : []);
      setInboxes(Array.isArray(data.inboxes) ? data.inboxes : []);
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : "Failed to load inbox");
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadThreads(selectedInboxId);
  }, [loadThreads, selectedInboxId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadThreads(selectedInboxId, { silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadThreads, selectedInboxId]);

  useEffect(() => {
    if (loading || selectedKey || threads.length === 0) {
      return;
    }
    const latest = threads.reduce((best, thread) =>
      new Date(thread.latestAt).getTime() > new Date(best.latestAt).getTime()
        ? thread
        : best,
    );
    void openThread(latest.threadKey);
  }, [loading, selectedKey, threads]);

  async function syncInbox() {
    setSyncing(true);
    setError("");
    setSyncNote("");
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sinceDays: 14,
          ...(selectedInboxId !== "all" ? { senderId: selectedInboxId } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to sync Gmail inbox");
      }
      setThreads(Array.isArray(data.threads) ? data.threads : []);
      setInboxes(Array.isArray(data.inboxes) ? data.inboxes : []);
      const imported = Number(data.imported ?? 0);
      const errors = Array.isArray(data.errors) ? data.errors : [];
      setSyncNote(
        errors.length > 0
          ? `Synced ${imported} campaign ${imported === 1 ? "reply" : "replies"}. ${errors.join(" · ")}`
          : `Synced ${imported} campaign ${imported === 1 ? "reply" : "replies"}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync inbox");
    } finally {
      setSyncing(false);
    }
  }

  async function openThread(threadKey: string) {
    setSelectedKey(threadKey);
    setReplyHtml("");
    setComposerOpen(false);
    setAiInstruction("");
    setSuggestError("");
    setLoadingThread(true);
    setError("");
    try {
      const response = await fetch(
        `/api/inbox/${encodeURIComponent(threadKey)}`,
        { method: "PATCH" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to open thread");
      }
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setThreads((current) =>
        current.map((thread) =>
          thread.threadKey === threadKey
            ? { ...thread, unreadCount: 0 }
            : thread,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open thread");
    } finally {
      setLoadingThread(false);
    }
  }

  async function suggestReply() {
    if (!selectedKey || suggesting) {
      return;
    }
    const threadKey = selectedKey;
    setSuggesting(true);
    setSuggestError("");
    try {
      const response = await fetch(
        `/api/inbox/${encodeURIComponent(threadKey)}/suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction: aiInstruction }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as { html?: string; error?: string };
      if (!response.ok || !data.html) {
        throw new Error(data.error || "Could not suggest a reply.");
      }
      if (selectedKeyRef.current === threadKey) {
        replyEditorRef.current?.replaceHtml(data.html);
      }
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "Could not suggest a reply.");
    } finally {
      setSuggesting(false);
    }
  }

  function openAiReply() {
    setComposerOpen(true);
    if (isEmptyReplyHtml(replyHtml)) {
      void suggestReply();
    }
  }

  async function sendReply() {
    if (!selectedKey || isEmptyReplyHtml(replyHtml) || sendingReply) {
      return;
    }
    setSendingReply(true);
    setError("");
    const outgoingHtml = replyHtml;
    try {
      const response = await fetch(
        `/api/inbox/${encodeURIComponent(selectedKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: outgoingHtml }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to send reply");
      }
      const nextMessages = Array.isArray(data.messages) ? data.messages : [];
      setMessages(nextMessages);
      setReplyHtml("");
      setReplyEditorKey((key) => key + 1);
      setComposerOpen(false);
      const preview =
        stripHtmlToText(outgoingHtml).slice(0, 140) ||
        (/<img\b/i.test(outgoingHtml) ? "(image)" : "(no preview)");
      setThreads((current) => {
        const updated = current.map((thread) =>
          thread.threadKey === selectedKey
            ? {
                ...thread,
                preview: `You: ${preview}`,
                messageCount: nextMessages.length || thread.messageCount + 1,
                latestAt: new Date().toISOString(),
                unreadCount: 0,
              }
            : thread,
        );
        return updated.sort(
          (a, b) =>
            new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
        );
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  }

  function onInboxChange(nextId: string) {
    setSelectedInboxId(nextId);
    setSelectedKey(null);
    setMessages([]);
    setReplyHtml("");
    setComposerOpen(false);
    setSyncNote("");
  }

  const selected = threads.find((thread) => thread.threadKey === selectedKey);
  const replyToLabel =
    selected?.fromName ||
    selected?.relatedContactEmail ||
    selected?.fromEmail ||
    "contact";
  const selectedInboxLabel =
    selectedInboxId === "all"
      ? inboxes.length === 0
        ? "No Gmail inboxes"
        : `All Gmail inboxes (${inboxes.length})`
      : inboxes.find((inbox) => inbox.id === selectedInboxId)?.email ||
        "Selected inbox";
  const canSendReply = !sendingReply && !isEmptyReplyHtml(replyHtml);

  return (
    <div className="crm-page inbox-page">
      <div className="crm-page-head">
        <div>
          <h2>Master Inbox</h2>
          <p className="desc">
            Only replies to campaigns you sent. If nobody has replied to a
            campaign yet, this stays empty — regular Gmail mail is never shown.
          </p>
        </div>
        <div className="crm-actions inbox-toolbar">
          <label className="inbox-filter">
            <span>Inbox</span>
            <select
              className="filter"
              value={selectedInboxId}
              onChange={(event) => onInboxChange(event.target.value)}
              disabled={loading || syncing}
            >
              <option value="all">
                {inboxes.length === 0
                  ? "No Gmail inboxes"
                  : `All Gmail inboxes (${inboxes.length})`}
              </option>
              {inboxes.map((inbox) => (
                <option key={inbox.id} value={inbox.id}>
                  {inbox.email}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-dark"
            disabled={syncing || inboxes.length === 0}
            onClick={() => void syncInbox()}
          >
            {syncing ? "Syncing…" : "Sync Gmail"}
          </button>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}
      {syncNote ? <div className="crm-summary">{syncNote}</div> : null}

      <div className="inbox-showing">
        Showing campaign replies from <strong>{selectedInboxLabel}</strong>
        <span> · Syncs automatically every 10 minutes</span>
      </div>

      <div className="inbox-layout">
        <aside className="inbox-thread-list">
          {loading ? (
            <div className="inbox-empty">Loading inbox…</div>
          ) : threads.length === 0 ? (
            <div className="inbox-empty">
              No campaign replies for {selectedInboxLabel}. This is not your full
              Gmail inbox — only replies to campaigns you ran appear here after
              Sync Gmail.
            </div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.threadKey}
                type="button"
                className={`inbox-thread-item${selectedKey === thread.threadKey ? " active" : ""}${thread.unreadCount > 0 ? " unread" : ""}`}
                onClick={() => void openThread(thread.threadKey)}
              >
                <div className="inbox-thread-top">
                  <span className="inbox-thread-from">
                    {thread.fromName || thread.fromEmail || "Unknown"}
                  </span>
                  <span className="inbox-thread-time">
                    {formatWhen(thread.latestAt)}
                  </span>
                </div>
                <div className="inbox-thread-subject">{thread.subject}</div>
                <div className="inbox-thread-preview">{thread.preview}</div>
                <div className="inbox-thread-meta">
                  via {thread.senderEmail}
                  {thread.unreadCount > 0
                    ? ` · ${thread.unreadCount} unread`
                    : ""}
                </div>
              </button>
            ))
          )}
        </aside>

        <section className="inbox-thread-pane">
          {!selectedKey ? (
            <div className="inbox-empty">Select a conversation</div>
          ) : loadingThread ? (
            <div className="inbox-empty">Loading thread…</div>
          ) : (
            <>
              <header className="inbox-thread-head">
                <div className="inbox-thread-head-main">
                  <h3>{selected?.subject || "Conversation"}</h3>
                  <div className="inbox-thread-head-meta">
                    <span className="inbox-chip">
                      {selected?.fromName || selected?.fromEmail || "Unknown"}
                    </span>
                    {selected?.campaignType ? (
                      <span
                        className={`inbox-chip inbox-chip-type is-${selected.campaignType}`}
                      >
                        {CAMPAIGN_TYPE_LABEL[selected.campaignType]}
                      </span>
                    ) : null}
                    {selected?.relatedCampaignId ? (
                      <Link
                        href={portalCampaignRoute(
                          selected.relatedCampaignId,
                          selected.campaignType === "oneone" ||
                            selected.campaignType === "personalise"
                            ? "oneone"
                            : "drip",
                          selected.campaignType === "personalise"
                            ? ["personalise"]
                            : undefined,
                        )}
                        className="inbox-chip inbox-chip-link"
                        title={selected.campaignName || undefined}
                      >
                        {selected.campaignName
                          ? `#${selected.relatedCampaignId} · ${selected.campaignName}`
                          : `Campaign #${selected.relatedCampaignId}`}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </header>
              <div className="inbox-messages">
                {messages.map((message) => {
                  const outbound = message.direction === "outbound";
                  const html = message.htmlBody.trim();
                  const simpleHtml = Boolean(html) && !isRichHtml(html);
                  const text =
                    outbound && simpleHtml
                      ? simpleHtmlToText(html)
                      : message.textBody.trim();
                  const usePlainText =
                    Boolean(text) && (!html || simpleHtml);
                  return (
                    <article
                      key={message.id}
                      className={`inbox-message${outbound ? " outbound" : ""}`}
                    >
                      <div className="inbox-message-meta">
                        <strong>
                          {outbound
                            ? "You"
                            : message.fromName || message.fromEmail}
                        </strong>
                        <span>{formatWhen(message.receivedAt)}</span>
                      </div>
                      {usePlainText ? (
                        <pre className="inbox-message-text">
                          {text || "(empty message)"}
                        </pre>
                      ) : html ? (
                        <InboxMessageHtml html={html} title={message.subject} />
                      ) : (
                        <pre className="inbox-message-text">
                          {text || "(empty message)"}
                        </pre>
                      )}
                    </article>
                  );
                })}
              </div>
              {!composerOpen ? (
                <div className="inbox-reply-launch">
                  <button
                    type="button"
                    className="inbox-ai-btn inbox-ai-launch-btn"
                    onClick={openAiReply}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z" />
                      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z" />
                    </svg>
                    AI reply
                  </button>
                </div>
              ) : null}
              <form
                className={`inbox-reply${composerOpen ? " is-open" : ""}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply();
                }}
              >
                <div className="inbox-reply-top">
                  <label className="inbox-reply-label" htmlFor="inbox-reply-body">
                    Reply to {replyToLabel}
                  </label>
                  <div className="inbox-reply-top-right">
                    <span className="inbox-reply-hint">
                      via {selected?.senderEmail || "Gmail"}
                    </span>
                    <button
                      type="button"
                      className="inbox-reply-close"
                      aria-label="Hide reply"
                      title="Hide reply"
                      onClick={() => setComposerOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="inbox-ai-bar">
                  <span className="inbox-ai-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z" />
                      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z" />
                    </svg>
                  </span>
                  <input
                    className="inbox-ai-input"
                    value={aiInstruction}
                    placeholder="Optional: tell AI what to say, e.g. propose Tuesday 3 PM"
                    aria-label="What the AI reply should say"
                    disabled={suggesting || sendingReply}
                    onChange={(event) => setAiInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void suggestReply();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="inbox-ai-btn"
                    disabled={suggesting || sendingReply}
                    onClick={() => void suggestReply()}
                  >
                    {suggesting ? "Writing…" : "Suggest reply"}
                  </button>
                </div>
                {suggestError ? <div className="inbox-ai-error">{suggestError}</div> : null}
                <InboxReplyEditor
                  key={`${selectedKey}-${replyEditorKey}`}
                  ref={replyEditorRef}
                  threadKey={selectedKey}
                  disabled={sendingReply}
                  onHtmlChange={handleReplyHtmlChange}
                  onSubmitShortcut={() => {
                    void sendReply();
                  }}
                />
                <div className="inbox-reply-actions">
                  <button
                    type="button"
                    className="inbox-sig-btn"
                    onClick={openSignatureModal}
                    disabled={sendingReply}
                  >
                    Insert HTML signature
                  </button>
                  <button
                    type="submit"
                    className="btn-dark"
                    disabled={!canSendReply}
                  >
                    {sendingReply ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {signatureModalOpen ? (
        <div className="crm-modal-backdrop" onClick={closeSignatureModal}>
          <div
            className="crm-modal inbox-sig-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inbox-sig-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="inbox-sig-title">HTML signature</h3>
                <p>
                  Paste your signature HTML below. Use{" "}
                  <code>https://</code> or <code>data:image</code> image URLs so
                  logos show in the reply.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeSignatureModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <div className="crm-field">
                <label htmlFor="inbox-sig-html">Signature HTML</label>
                <textarea
                  id="inbox-sig-html"
                  className="inbox-sig-textarea"
                  value={signatureHtmlDraft}
                  onChange={(event) => setSignatureHtmlDraft(event.target.value)}
                  placeholder={`<table>\n  <tr>\n    <td>\n      <img src="https://…/logo.png" alt="Logo" width="120" />\n      <div>Your Name</div>\n    </td>\n  </tr>\n</table>`}
                  spellCheck={false}
                />
              </div>
              {signatureHtmlDraft.trim() ? (
                <div className="crm-field">
                  <label>Preview</label>
                  <div
                    className="inbox-sig-preview"
                    dangerouslySetInnerHTML={{
                      __html: sanitizePastedHtml(signatureHtmlDraft),
                    }}
                  />
                </div>
              ) : null}
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-link-purple"
                onClick={closeSignatureModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={insertHtmlSignature}
                disabled={!signatureHtmlDraft.trim()}
              >
                Insert into reply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
