"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PORTAL_ROUTES } from "@/lib/portal-nav";
import {
  formatFormSubmission,
  parseAgentForm,
  type AgentForm,
  type AgentFormField,
} from "@/lib/project-assistant-form";
import {
  PROJECT_ASSISTANT_CATALOG,
  type ProjectAssistantConversationPublic,
  type ProjectAssistantIntegrationPublic,
  type ProjectAssistantMessagePublic,
} from "@/lib/project-assistant-types";

import { NEXUSES_LOGO_URL } from "@/lib/nexuses-logo";

const SUGGESTIONS = [
  "Help me set up a new drip campaign",
  "Add a sender for this project",
  "What's missing before I can launch my latest campaign?",
  "List my senders and contact lists",
  "Give me an overview of this project",
  "Connect HubSpot and pull latest contacts",
];

function fieldDefault(field: AgentFormField) {
  if (field.type === "checkbox") {
    return field.defaultValue === true || field.defaultValue === "true"
      ? "true"
      : "false";
  }
  if (field.defaultValue === undefined || field.defaultValue === null) {
    return "";
  }
  return String(field.defaultValue);
}

function AgentChatForm({
  form,
  disabled,
  submitted,
  onSubmit,
}: {
  form: AgentForm;
  disabled?: boolean;
  submitted?: boolean;
  onSubmit: (values: Record<string, string | boolean>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of form.fields) {
      initial[field.key] = fieldDefault(field);
    }
    return initial;
  });
  const [localError, setLocalError] = useState("");

  function update(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled || submitted) return;
    for (const field of form.fields) {
      if (!field.required || field.type === "checkbox") continue;
      if (!String(values[field.key] ?? "").trim()) {
        setLocalError(`${field.label} is required.`);
        return;
      }
    }
    setLocalError("");
    const payload: Record<string, string | boolean> = {};
    for (const field of form.fields) {
      if (field.type === "checkbox") {
        payload[field.key] = values[field.key] === "true";
      } else {
        payload[field.key] = values[field.key] ?? "";
      }
    }
    onSubmit(payload);
  }

  if (submitted) {
    return (
      <div className="pag-form is-done" role="status">
        <strong>{form.title}</strong>
        <span>Submitted</span>
      </div>
    );
  }

  return (
    <form className="pag-form" onSubmit={handleSubmit}>
      <div className="pag-form-head">
        <strong>{form.title}</strong>
        {form.description ? <p>{form.description}</p> : null}
      </div>
      <div className="pag-form-fields">
        {form.fields.map((field) => (
          <label key={field.key} className={field.type === "checkbox" ? "is-check" : ""}>
            {field.type === "checkbox" ? (
              <>
                <input
                  type="checkbox"
                  checked={values[field.key] === "true"}
                  disabled={disabled}
                  onChange={(event) =>
                    update(field.key, event.target.checked ? "true" : "false")
                  }
                />
                <span>
                  {field.label}
                  {field.help ? <em>{field.help}</em> : null}
                </span>
              </>
            ) : (
              <>
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                {field.type === "textarea" ? (
                  <textarea
                    value={values[field.key] ?? ""}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    rows={4}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                ) : field.type === "select" ? (
                  <select
                    value={values[field.key] ?? ""}
                    disabled={disabled}
                    onChange={(event) => update(field.key, event.target.value)}
                  >
                    <option value="">Select…</option>
                    {(field.options || []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={
                      field.type === "password"
                        ? "password"
                        : field.type === "email"
                          ? "email"
                          : field.type === "number"
                            ? "number"
                            : "text"
                    }
                    value={values[field.key] ?? ""}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    autoComplete={field.type === "password" ? "off" : "on"}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                )}
                {field.help ? <em>{field.help}</em> : null}
              </>
            )}
          </label>
        ))}
      </div>
      {localError ? <p className="pag-form-error">{localError}</p> : null}
      <div className="pag-form-actions">
        <button type="submit" className="pag-form-submit" disabled={disabled}>
          {form.submitLabel || "Continue"}
        </button>
      </div>
    </form>
  );
}

function playAgentChime() {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const tones = [523.25, 659.25, 783.99];
    tones.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02 + index * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28 + index * 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + index * 0.05);
      osc.stop(now + 0.4 + index * 0.08);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    // Audio is optional.
  }
}

function formatChatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function PortalProjectAssistantPage() {
  const [projectName, setProjectName] = useState("your project");
  const [conversations, setConversations] = useState<
    ProjectAssistantConversationPublic[]
  >([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ProjectAssistantMessagePublic[]>([]);
  const [integrations, setIntegrations] = useState<
    ProjectAssistantIntegrationPublic[]
  >([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [otherName, setOtherName] = useState("");
  const [otherKey, setOtherKey] = useState("");
  const [otherUrl, setOtherUrl] = useState("");
  const [addingOther, setAddingOther] = useState(false);
  const [submittedForms, setSubmittedForms] = useState<Record<string, true>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chimePlayed = useRef(false);

  async function loadConversationMessages(conversationId: string) {
    const chatRes = await fetch(
      `/api/project-assistant/messages?conversationId=${encodeURIComponent(conversationId)}`,
      { cache: "no-store" },
    );
    const chatData = (await chatRes.json()) as {
      messages?: ProjectAssistantMessagePublic[];
      error?: string;
    };
    if (!chatRes.ok) {
      throw new Error(chatData.error || "Failed to load chat");
    }
    setMessages(chatData.messages || []);
    setSubmittedForms({});
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [meRes, convRes, toolsRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/project-assistant/conversations", { cache: "no-store" }),
        fetch("/api/project-assistant/integrations", { cache: "no-store" }),
      ]);
      const meData = (await meRes.json().catch(() => null)) as {
        projectName?: string;
      } | null;
      if (meData?.projectName?.trim()) {
        setProjectName(meData.projectName.trim());
      }
      const convData = (await convRes.json()) as {
        conversations?: ProjectAssistantConversationPublic[];
        error?: string;
      };
      const toolsData = (await toolsRes.json()) as {
        integrations?: ProjectAssistantIntegrationPublic[];
        error?: string;
      };
      if (!convRes.ok) {
        throw new Error(convData.error || "Failed to load chats");
      }
      if (!toolsRes.ok) {
        throw new Error(toolsData.error || "Failed to load tools");
      }
      const list = convData.conversations || [];
      setConversations(list);
      setIntegrations(toolsData.integrations || []);
      if (list.length) {
        setActiveConversationId(list[0].id);
        await loadConversationMessages(list[0].id);
      } else {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assistant");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (chimePlayed.current || loading) return;
    chimePlayed.current = true;
    playAgentChime();
    inputRef.current?.focus();
  }, [loading]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  async function selectConversation(conversationId: string) {
    if (busy || conversationId === activeConversationId) {
      setHistoryOpen(false);
      return;
    }
    setSwitching(true);
    setError("");
    try {
      setActiveConversationId(conversationId);
      await loadConversationMessages(conversationId);
      setHistoryOpen(false);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open chat");
    } finally {
      setSwitching(false);
    }
  }

  async function startNewChat() {
    if (busy) return;
    setError("");
    try {
      const response = await fetch("/api/project-assistant/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      const data = (await response.json()) as {
        conversation?: ProjectAssistantConversationPublic;
        error?: string;
      };
      if (!response.ok || !data.conversation) {
        throw new Error(data.error || "Could not start chat");
      }
      setConversations((current) => [data.conversation!, ...current]);
      setActiveConversationId(data.conversation.id);
      setMessages([]);
      setSubmittedForms({});
      setHistoryOpen(false);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chat");
    }
  }

  async function deleteConversation(conversationId: string) {
    if (busy) return;
    setError("");
    try {
      const response = await fetch(
        `/api/project-assistant/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not delete chat");
      }
      const remaining = conversations.filter((item) => item.id !== conversationId);
      setConversations(remaining);
      if (activeConversationId === conversationId) {
        if (remaining[0]) {
          setActiveConversationId(remaining[0].id);
          await loadConversationMessages(remaining[0].id);
        } else {
          setActiveConversationId(null);
          setMessages([]);
          setSubmittedForms({});
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete chat");
    }
  }

  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setInput("");
    const optimistic: ProjectAssistantMessagePublic = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
      conversationId: activeConversationId || undefined,
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/project-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: activeConversationId || undefined,
        }),
      });
      const data = (await response.json()) as {
        reply?: string;
        conversationId?: string;
        messages?: ProjectAssistantMessagePublic[];
        conversations?: ProjectAssistantConversationPublic[];
        error?: string;
      };
      if (!response.ok || !data.reply) {
        throw new Error(data.error || "Could not get a reply");
      }
      if (data.conversationId) {
        setActiveConversationId(data.conversationId);
      }
      if (data.conversations) {
        setConversations(data.conversations);
      }
      setMessages((current) => {
        const withoutOptimistic = current.filter((item) => item.id !== optimistic.id);
        if (data.messages?.length) {
          return [...withoutOptimistic, ...data.messages];
        }
        return [
          ...withoutOptimistic,
          optimistic,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: data.reply || "",
            createdAt: new Date().toISOString(),
            conversationId: data.conversationId,
          },
        ];
      });
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setError(err instanceof Error ? err.message : "Could not get a reply");
      setInput(message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  async function connectTool(inputData: {
    provider: string;
    name?: string;
    apiKey: string;
    baseUrl?: string;
  }) {
    setConnectBusy(inputData.provider + (inputData.name || ""));
    setError("");
    try {
      const response = await fetch("/api/project-assistant/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputData),
      });
      const data = (await response.json()) as {
        integration?: ProjectAssistantIntegrationPublic;
        error?: string;
      };
      if (!response.ok || !data.integration) {
        throw new Error(data.error || "Could not connect");
      }
      setIntegrations((current) => {
        const next = current.filter((item) =>
          data.integration!.provider === "other"
            ? !(item.provider === "other" && item.name === data.integration!.name)
            : item.provider !== data.integration!.provider,
        );
        return [data.integration!, ...next];
      });
      if (inputData.provider === "other") {
        setOtherName("");
        setOtherKey("");
        setOtherUrl("");
        setAddingOther(false);
      } else {
        setKeys((current) => ({ ...current, [inputData.provider]: "" }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setConnectBusy("");
    }
  }

  async function disconnectTool(item: ProjectAssistantIntegrationPublic) {
    setConnectBusy(item.id);
    setError("");
    try {
      const response = await fetch(
        `/api/project-assistant/integrations/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not disconnect");
      }
      setIntegrations((current) => current.filter((row) => row.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setConnectBusy("");
    }
  }

  async function clearChat() {
    if (busy || !activeConversationId) return;
    setError("");
    try {
      const response = await fetch(
        `/api/project-assistant/messages?conversationId=${encodeURIComponent(activeConversationId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error("Could not clear chat");
      }
      setMessages([]);
      setSubmittedForms({});
      setConversations((current) =>
        current.map((item) =>
          item.id === activeConversationId
            ? { ...item, title: "New chat", updatedAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear chat");
    }
  }

  function submitAgentForm(form: AgentForm, values: Record<string, string | boolean>) {
    if (busy || submittedForms[form.id]) return;
    setSubmittedForms((current) => ({ ...current, [form.id]: true }));
    void sendMessage(formatFormSubmission(form, values));
  }

  const connectedByProvider = new Map(
    integrations
      .filter((item) => item.provider !== "other")
      .map((item) => [item.provider, item]),
  );
  const others = integrations.filter((item) => item.provider === "other");
  const empty = !loading && messages.length === 0;
  const parsedMessages = useMemo(
    () =>
      messages.map((message, index) => {
        if (message.role !== "assistant") {
          return {
            message,
            markdown: message.content,
            form: null as AgentForm | null,
            formCompleted: false,
          };
        }
        const parsed = parseAgentForm(message.content);
        if (!parsed.form) {
          return {
            message,
            markdown: parsed.markdown,
            form: null,
            formCompleted: false,
          };
        }
        const submittedInSession = Boolean(submittedForms[parsed.form.id]);
        const submittedInThread = messages.slice(index + 1).some((later) => {
          if (later.role !== "user") return false;
          const text = later.content;
          return (
            text.includes(`Submitted “${parsed.form!.title}”`) ||
            text.includes(`Submitted "${parsed.form!.title}"`)
          );
        });
        const formCompleted = submittedInSession || submittedInThread;
        return {
          message,
          markdown: parsed.markdown,
          // Keep unsubmitted forms fillable — never mark Done just because a newer form appeared.
          form: formCompleted ? null : parsed.form,
          formCompleted,
        };
      }),
    [messages, submittedForms],
  );

  return (
    <div className={`pag-root${historyOpen ? " is-history-open" : ""}`}>
      <aside className="pag-history" aria-label="Chat history">
        <div className="pag-history-top">
          <Link href={PORTAL_ROUTES.dashboard} className="pag-back">
            ← Portal
          </Link>
          <button
            type="button"
            className="pag-history-new"
            onClick={() => void startNewChat()}
            disabled={busy}
          >
            New chat
          </button>
        </div>
        <div className="pag-history-list">
          {conversations.length === 0 ? (
            <p className="pag-history-empty">No chats yet</p>
          ) : (
            conversations.map((item) => (
              <div
                key={item.id}
                className={`pag-history-item${
                  item.id === activeConversationId ? " is-active" : ""
                }`}
              >
                <button
                  type="button"
                  className="pag-history-open"
                  onClick={() => void selectConversation(item.id)}
                  disabled={switching}
                >
                  <span className="pag-history-title">{item.title}</span>
                  <span className="pag-history-time">
                    {formatChatTime(item.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="pag-history-delete"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => void deleteConversation(item.id)}
                  disabled={busy}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {historyOpen ? (
        <button
          type="button"
          className="pag-history-backdrop"
          aria-label="Close history"
          onClick={() => setHistoryOpen(false)}
        />
      ) : null}

      <div className="pag-main">
      <header className="pag-top">
        <div className="pag-top-inner">
          <button
            type="button"
            className="pag-ghost pag-history-toggle"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            Chats
          </button>
          <div className="pag-top-title">
            <Image
              src={NEXUSES_LOGO_URL}
              alt="Nexuses"
              width={108}
              height={24}
              className="pag-top-logo"
              priority
              unoptimized
            />
          </div>
          <div className="pag-top-actions">
            {messages.length > 0 ? (
              <button type="button" className="pag-ghost" onClick={() => void clearChat()}>
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className="pag-ghost"
              onClick={() => setToolsOpen(true)}
            >
              Tools{integrations.length ? ` (${integrations.length})` : ""}
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="pag-error-wrap">
          <p className="pag-error">{error}</p>
        </div>
      ) : null}

      <div className="pag-stage" ref={scrollerRef}>
        <div className="pag-column">
          {loading || switching ? (
            <div className="pag-loading">{switching ? "Opening chat…" : "Starting…"}</div>
          ) : empty ? (
            <div className="pag-hero">
              <Image
                src={NEXUSES_LOGO_URL}
                alt="Nexuses"
                width={148}
                height={32}
                className="pag-logo"
                priority
                unoptimized
              />
              <h1>How can I help with {projectName}?</h1>
              <p className="pag-lead">
                Set up campaigns, add senders, manage lists, or connect tools — all from
                chat.
              </p>
              <div className="pag-suggestions">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="pag-suggestion"
                    onClick={() => void sendMessage(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="pag-thread">
              {parsedMessages.map(({ message, markdown, form, formCompleted }) => (
                <div
                  key={message.id}
                  className={`pag-row ${message.role === "user" ? "is-user" : "is-assistant"}`}
                >
                  {message.role === "assistant" ? (
                    <div className="pag-agent-mark" aria-hidden="true">
                      N
                    </div>
                  ) : null}
                  <div className="pag-bubble">
                    {message.role === "assistant" ? (
                      <>
                        {markdown.trim() ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {markdown}
                          </ReactMarkdown>
                        ) : null}
                        {form ? (
                          <AgentChatForm
                            form={form}
                            disabled={busy}
                            submitted={Boolean(submittedForms[form.id])}
                            onSubmit={(values) => submitAgentForm(form, values)}
                          />
                        ) : formCompleted ? (
                          <div className="pag-form is-done" role="status">
                            <strong>Details submitted</strong>
                            <span>Submitted</span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {busy ? (
                <div className="pag-row is-assistant">
                  <div className="pag-agent-mark" aria-hidden="true">
                    N
                  </div>
                  <div className="pag-bubble pag-thinking">
                    <span className="pag-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    Thinking
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="pag-composer-wrap">
        <form className="pag-composer" onSubmit={onSubmit}>
          <div className="pag-composer-card">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="How can I help you today?"
              rows={1}
              disabled={busy}
            />
            <div className="pag-composer-foot">
              <span>Enter to send</span>
              <button
                type="submit"
                className="pag-send"
                disabled={busy || !input.trim()}
                aria-label="Send"
              >
                {busy ? "…" : "↑"}
              </button>
            </div>
          </div>
        </form>
      </div>
      </div>

      {toolsOpen ? (
        <div className="pa-drawer-root">
          <button
            type="button"
            className="pa-drawer-backdrop"
            aria-label="Close connect tools"
            onClick={() => setToolsOpen(false)}
          />
          <aside className="pa-drawer" aria-label="Connect tools">
            <div className="pa-drawer-head">
              <div>
                <p className="pa-drawer-kicker">Connect</p>
                <h3>Tools</h3>
                <p>
                  Connect APIs here, then ask the agent to transfer contacts, sync
                  campaigns, or call endpoints.
                </p>
              </div>
              <button
                type="button"
                className="btn-soft"
                onClick={() => setToolsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="pa-drawer-body">
              {PROJECT_ASSISTANT_CATALOG.map((item) => {
                const connected = connectedByProvider.get(item.provider);
                return (
                  <div key={item.provider} className="pa-connect-card">
                    <div className="pa-connect-card-head">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.blurb}</p>
                        {connected ? (
                          <span className="pa-connected">
                            Connected · {connected.keyHint}
                          </span>
                        ) : null}
                      </div>
                      {connected ? (
                        <button
                          type="button"
                          className="btn-soft"
                          disabled={connectBusy === connected.id}
                          onClick={() => void disconnectTool(connected)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {!connected ? (
                      <form
                        className="pa-connect-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void connectTool({
                            provider: item.provider,
                            apiKey: keys[item.provider] || "",
                            baseUrl: item.defaultBaseUrl,
                          });
                        }}
                      >
                        <label>
                          API key / token
                          <input
                            type="password"
                            value={keys[item.provider] || ""}
                            placeholder={item.placeholder}
                            onChange={(event) =>
                              setKeys((current) => ({
                                ...current,
                                [item.provider]: event.target.value,
                              }))
                            }
                            required
                          />
                        </label>
                        <button
                          type="submit"
                          className="btn-dark"
                          disabled={connectBusy === item.provider}
                        >
                          {connectBusy === item.provider
                            ? "Connecting…"
                            : `Connect ${item.title}`}
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })}

              {others.map((item) => (
                <div key={item.id} className="pa-connect-card">
                  <div className="pa-connect-card-head">
                    <div>
                      <strong>{item.name}</strong>
                      <p>
                        Custom API
                        {item.baseUrl ? ` · ${item.baseUrl}` : ""}
                      </p>
                      <span className="pa-connected">Connected · {item.keyHint}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-soft"
                      disabled={connectBusy === item.id}
                      onClick={() => void disconnectTool(item)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              <div className="pa-connect-card">
                <div className="pa-connect-card-head">
                  <div>
                    <strong>Other / custom API</strong>
                    <p>
                      Any REST API (SmartLead, another HubSpot app, internal tools).
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-soft"
                    onClick={() => setAddingOther((value) => !value)}
                  >
                    {addingOther ? "Cancel" : "Add"}
                  </button>
                </div>
                {addingOther ? (
                  <form
                    className="pa-connect-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connectTool({
                        provider: "other",
                        name: otherName,
                        apiKey: otherKey,
                        baseUrl: otherUrl,
                      });
                    }}
                  >
                    <label>
                      Name
                      <input
                        value={otherName}
                        onChange={(event) => setOtherName(event.target.value)}
                        placeholder="SmartLead"
                        required
                        minLength={2}
                      />
                    </label>
                    <label>
                      Base URL
                      <input
                        value={otherUrl}
                        onChange={(event) => setOtherUrl(event.target.value)}
                        placeholder="https://api.example.com"
                        required
                      />
                    </label>
                    <label>
                      API key
                      <input
                        type="password"
                        value={otherKey}
                        onChange={(event) => setOtherKey(event.target.value)}
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn-dark"
                      disabled={connectBusy.startsWith("other")}
                    >
                      {connectBusy.startsWith("other") ? "Connecting…" : "Connect"}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
