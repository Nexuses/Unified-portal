"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function PortalMasterInboxPage() {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [inboxes, setInboxes] = useState<InboxAccount[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState("");
  const [syncNote, setSyncNote] = useState("");

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

  function onInboxChange(nextId: string) {
    setSelectedInboxId(nextId);
    setSelectedKey(null);
    setMessages([]);
    setSyncNote("");
  }

  const selected = threads.find((thread) => thread.threadKey === selectedKey);
  const selectedInboxLabel =
    selectedInboxId === "all"
      ? inboxes.length === 0
        ? "No Gmail inboxes"
        : `All Gmail inboxes (${inboxes.length})`
      : inboxes.find((inbox) => inbox.id === selectedInboxId)?.email ||
        "Selected inbox";

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
                {messages.map((message) => (
                  <article key={message.id} className="inbox-message">
                    <div className="inbox-message-meta">
                      <strong>
                        {message.fromName || message.fromEmail}
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
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
