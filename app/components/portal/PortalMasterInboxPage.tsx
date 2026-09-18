"use client";

import {
  useCallback,
  useEffect,
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

/** Keep pasted signatures/banners (incl. images); drop scripts and unsafe URLs. */
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
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^\s*javascript:/i.test(value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  doc.querySelectorAll("img").forEach((img) => {
    const src = (img.getAttribute("src") || "").trim();
    if (!/^(https?:|data:image\/)/i.test(src)) {
      img.remove();
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function InboxReplyEditor({
  threadKey,
  disabled,
  onHtmlChange,
  onSubmitShortcut,
}: {
  threadKey: string;
  disabled?: boolean;
  onHtmlChange: (html: string) => void;
  onSubmitShortcut: () => void;
}) {
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

  async function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }

    const imageItems = [...clipboard.items].filter((item) =>
      item.type.startsWith("image/"),
    );
    if (imageItems.length > 0) {
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
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

    const html = clipboard.getData("text/html");
    if (html.trim()) {
      document.execCommand("insertHTML", false, sanitizePastedHtml(html));
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
      data-placeholder="Write your reply… Paste signatures with images here."
      suppressContentEditableWarning
      onInput={syncHtml}
      onPaste={(event) => {
        void handlePaste(event);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

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
  const handleReplyHtmlChange = useCallback((html: string) => {
    setReplyHtml(html);
  }, []);

  const loadThreads = useCallback(async (inboxId: string) => {
    setLoading(true);
    setError("");
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
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads(selectedInboxId);
  }, [loadThreads, selectedInboxId]);

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
                <div>
                  <h3>{selected?.subject || "Conversation"}</h3>
                  <p>
                    {selected?.fromName || selected?.fromEmail}
                    {selected?.relatedCampaignId ? (
                      <>
                        {" · "}
                        <Link
                          href={portalCampaignRoute(selected.relatedCampaignId)}
                          className="inbox-campaign-link"
                        >
                          Campaign #{selected.relatedCampaignId}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
              </header>
              <div className="inbox-messages">
                {messages.map((message) => {
                  const outbound = message.direction === "outbound";
                  return (
                    <article
                      key={message.id}
                      className={`inbox-message${outbound ? " outbound" : ""}`}
                    >
                      <div className="inbox-message-meta">
                        <strong>
                          {outbound
                            ? `You · ${message.fromEmail}`
                            : message.fromName || message.fromEmail}
                        </strong>
                        <span>{formatWhen(message.receivedAt)}</span>
                      </div>
                      <div className="inbox-message-to">
                        to {message.toEmail}
                      </div>
                      {message.htmlBody.trim() ? (
                        <iframe
                          className="inbox-message-html"
                          title={message.subject}
                          sandbox=""
                          srcDoc={message.htmlBody}
                        />
                      ) : (
                        <pre className="inbox-message-text">
                          {message.textBody || "(empty message)"}
                        </pre>
                      )}
                    </article>
                  );
                })}
              </div>
              <form
                className="inbox-reply"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply();
                }}
              >
                <label className="inbox-reply-label" htmlFor="inbox-reply-body">
                  Reply to {replyToLabel}
                </label>
                <InboxReplyEditor
                  key={`${selectedKey}-${replyEditorKey}`}
                  threadKey={selectedKey}
                  disabled={sendingReply}
                  onHtmlChange={handleReplyHtmlChange}
                  onSubmitShortcut={() => {
                    void sendReply();
                  }}
                />
                <div className="inbox-reply-actions">
                  <span className="inbox-reply-hint">
                    Sends from {selected?.senderEmail || "your Gmail sender"} ·
                    paste keeps images
                  </span>
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
    </div>
  );
}
