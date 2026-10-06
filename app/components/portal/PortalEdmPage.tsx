"use client";

import { useEffect, useRef, useState } from "react";
import { extractEdmResult } from "@/lib/edm-result";
import { useRouter } from "next/navigation";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

type EdmBucket = {
  name: string;
  region: string;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageUrl?: string;
  buckets?: EdmBucket[];
};

type MemoryLink = {
  id: string;
  name: string;
  link: string;
};

type ChatFile = {
  id: string;
  label: string;
  dataUrl?: string;
  text?: string;
};

type SavedChat = {
  id: string;
  title: string;
  messages: ChatTurn[];
  html: string;
  imageBucket?: EdmBucket | null;
  updatedAt: string;
};

type PendingEmail = {
  message: string;
  files: ChatFile[];
  referenceHtml: string;
  currentHtml: string;
  history: { role: "user" | "assistant"; content: string }[];
};

const HELLO_PROMPTS = [
  "What email should we make?",
  "Write a product launch email in our brand",
  "Make a short follow-up with one button",
  "Create a square social post for this offer",
  "Match this reference layout with our colors",
  "Design a welcome email with our logo",
];

const HISTORY_KEY = "edm-studio-chats-v1";
const THREAD_KEY = "edm-studio-thread-v1";

function chatTitle(messages: ChatTurn[]) {
  const first = messages.find((item) => item.role === "user")?.text.trim() ?? "";
  if (!first) return "New chat";
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}

function assistantText(text: string) {
  if (text.includes('"html"') || /HTML:/i.test(text)) {
    return extractEdmResult(text).message;
  }
  return text;
}

function blankChat(): SavedChat {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    html: "",
    updatedAt: new Date().toISOString(),
  };
}

function readHistory(): { chats: SavedChat[]; activeId: string } {
  if (typeof window === "undefined") {
    const chat = { id: "pending", title: "New chat", messages: [], html: "", updatedAt: "" };
    return { chats: [chat], activeId: chat.id };
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { chats?: SavedChat[]; activeId?: string };
      const chats = Array.isArray(parsed.chats)
        ? parsed.chats.filter((item) => item && typeof item.id === "string").slice(0, 40)
        : [];
      if (chats.length) {
        const activeId = chats.some((item) => item.id === parsed.activeId)
          ? parsed.activeId!
          : chats[0].id;
        return { chats, activeId };
      }
    }
  } catch {
    // Fall through to a fresh chat.
  }

  try {
    const legacy = window.localStorage.getItem(THREAD_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { messages?: ChatTurn[]; html?: string };
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const html = typeof parsed.html === "string" ? parsed.html : "";
      if (messages.length || html) {
        const chat: SavedChat = {
          id: crypto.randomUUID(),
          title: chatTitle(messages),
          messages,
          html,
          updatedAt: new Date().toISOString(),
        };
        return { chats: [chat], activeId: chat.id };
      }
    }
  } catch {
    // Ignore a broken older thread.
  }

  const chat = blankChat();
  return { chats: [chat], activeId: chat.id };
}

async function readImageFile(file: File, maxEdge: number) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Attach an image.");
  }
  if (file.size > 8_000_000) {
    throw new Error("That image is too large.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export default function PortalEdmPage() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatEpoch = useRef(0);
  const pendingEmail = useRef<PendingEmail | null>(null);
  const [ready, setReady] = useState(false);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [html, setHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [codeView, setCodeView] = useState(false);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [referenceHtml, setReferenceHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [links, setLinks] = useState<MemoryLink[]>([]);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [memoryNote, setMemoryNote] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveDrip, setSaveDrip] = useState(true);
  const [saveOneone, setSaveOneone] = useState(true);
  const [saveNote, setSaveNote] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [imageBucket, setImageBucket] = useState<EdmBucket | null>(null);
  const [helloIndex, setHelloIndex] = useState(0);
  const [helloVisible, setHelloVisible] = useState(true);

  useEffect(() => {
    const history = readHistory();
    const fresh = blankChat();
    const previous = history.chats.filter(
      (chat) => chat.messages.length > 0 || chat.html.trim(),
    );
    setChats([fresh, ...previous].slice(0, 40));
    setActiveId(fresh.id);
    setMessages([]);
    setHtml("");
    setPreviewOpen(false);
    setReady(true);
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/edm/memory");
      if (!response.ok) return;
      const data = (await response.json()) as {
        logoUrl?: string;
        projectName?: string;
        links?: MemoryLink[];
      };
      setLogoUrl(typeof data.logoUrl === "string" ? data.logoUrl : "");
      setProjectName(typeof data.projectName === "string" ? data.projectName : "");
      setLinks(Array.isArray(data.links) ? data.links : []);
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    if (messages.length || html.trim()) return;
    let fadeTimer = 0;
    const timer = window.setInterval(() => {
      setHelloVisible(false);
      fadeTimer = window.setTimeout(() => {
        setHelloIndex((index) => (index + 1) % HELLO_PROMPTS.length);
        setHelloVisible(true);
      }, 280);
    }, 3400);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(fadeTimer);
    };
  }, [messages.length, html]);

  useEffect(() => {
    if (!ready || !activeId) return;
    setChats((current) => {
      const next = current.map((chat) =>
        chat.id === activeId
          ? {
              ...chat,
              messages: messages.slice(-30),
              html,
              imageBucket,
              title: chatTitle(messages),
              updatedAt: new Date().toISOString(),
            }
          : chat,
      );
      const active = next.find((chat) => chat.id === activeId);
      const ordered = active ? [active, ...next.filter((chat) => chat.id !== activeId)] : next;
      try {
        window.localStorage.setItem(
          HISTORY_KEY,
          JSON.stringify({ chats: ordered, activeId }),
        );
      } catch {
        // Ignore quota errors.
      }
      return ordered;
    });
  }, [messages, html, imageBucket, ready, activeId]);

  async function attachFiles(list: FileList | null) {
    if (!list?.length) return;
    setError("");
    const next: ChatFile[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list).slice(0, 6)) {
      const isImage =
        file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      try {
        if (isImage) {
          const dataUrl = await readImageFile(file, 1200);
          next.push({ id: crypto.randomUUID(), label: file.name, dataUrl });
          continue;
        }
        if (file.size > 1_500_000) {
          problems.push(`${file.name} is too large.`);
          continue;
        }
        const raw = (await file.text()).replace(/\u0000/g, "").trim();
        const readable = raw.replace(/[^\t\n\r\x20-\x7e]/g, "");
        if (!raw || readable.length < raw.length * 0.6) {
          problems.push(`${file.name} needs to be an image or a text file.`);
          continue;
        }
        const text = raw;
        next.push({
          id: crypto.randomUUID(),
          label: file.name,
          text: text.slice(0, 20_000),
        });
      } catch (err) {
        problems.push(err instanceof Error ? err.message : `Could not read ${file.name}.`);
      }
    }
    if (next.length) {
      setFiles((current) => [...current, ...next].slice(0, 6));
    }
    if (problems.length) setError(problems[0]);
  }

  function usePastedHtml() {
    const text = pasteDraft.trim();
    if (!text) {
      setError("Paste the reference HTML first.");
      return;
    }
    setError("");
    setReferenceHtml(text);
    setPasteOpen(false);
    setPasteDraft("");
  }

  const hasAttachment = Boolean(files.length || referenceHtml);

  function openChat(chat: SavedChat) {
    if (chat.id === activeId) return;
    chatEpoch.current += 1;
    setActiveId(chat.id);
    setMessages(chat.messages);
    setHtml(chat.html);
    setImageBucket(chat.imageBucket ?? null);
    pendingEmail.current = null;
    setPreviewOpen(Boolean(chat.html.trim()));
    setDraft("");
    setFiles([]);
    setReferenceHtml("");
    setPasteOpen(false);
    setPasteDraft("");
    setError("");
    setBusy(false);
  }

  function deleteChat(id: string) {
    const remaining = chats.filter((chat) => chat.id !== id);
    const next = remaining.length ? remaining : [blankChat()];
    const active = id === activeId ? next[0] : next.find((chat) => chat.id === activeId) ?? next[0];
    setChats(next);
    try {
      window.localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify({ chats: next, activeId: active.id }),
      );
    } catch {
      // Ignore quota errors.
    }
    if (id !== activeId) return;
    chatEpoch.current += 1;
    pendingEmail.current = null;
    setActiveId(active.id);
    setMessages(active.messages);
    setHtml(active.html);
    setImageBucket(active.imageBucket ?? null);
    setPreviewOpen(Boolean(active.html.trim()));
    setDraft("");
    setFiles([]);
    setReferenceHtml("");
    setPasteOpen(false);
    setPasteDraft("");
    setError("");
    setBusy(false);
  }

  function startNewChat() {
    const current = chats.find((chat) => chat.id === activeId);
    if (current && current.messages.length === 0 && !current.html.trim()) return;
    const chat = blankChat();
    chatEpoch.current += 1;
    setChats((items) => [chat, ...items].slice(0, 40));
    setActiveId(chat.id);
    setMessages([]);
    setHtml("");
    setImageBucket(null);
    pendingEmail.current = null;
    setPreviewOpen(false);
    setDraft("");
    setFiles([]);
    setReferenceHtml("");
    setPasteOpen(false);
    setPasteDraft("");
    setError("");
    setBusy(false);
  }

  async function requestEmail(pending: PendingEmail, bucket: EdmBucket, epoch: number) {
    setBusy(true);
    try {
      const response = await fetch("/api/edm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: pending.message,
          history: pending.history,
          links: links.map((item) => ({ name: item.name, link: item.link })),
          referenceHtml: pending.referenceHtml,
          attachments: pending.files.map((file) => ({
            name: file.label,
            text: file.text ?? "",
            dataUrl: file.dataUrl ?? "",
          })),
          currentHtml: pending.currentHtml,
          bucket,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        html?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Chat failed");
      }
      if (chatEpoch.current !== epoch) return;
      const rawReply = data?.message?.trim() || "";
      const extracted =
        rawReply.includes('"html"') || /HTML:/i.test(rawReply)
          ? extractEdmResult(rawReply)
          : null;
      const reply = extracted?.message || rawReply || "Updated the email.";
      const nextHtml = extracted?.html || data?.html?.trim() || "";
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: reply },
      ]);
      if (nextHtml) {
        setHtml(nextHtml);
        setPreviewOpen(true);
      }
    } catch (err) {
      if (chatEpoch.current !== epoch) return;
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      if (chatEpoch.current === epoch) setBusy(false);
    }
  }

  async function chooseBucket(bucket: EdmBucket) {
    if (busy) return;
    const pending = pendingEmail.current;
    pendingEmail.current = null;
    setImageBucket(bucket);
    setMessages((current) =>
      current.map((item) =>
        item.buckets
          ? { ...item, buckets: undefined, text: `Images will upload to ${bucket.name}.` }
          : item,
      ),
    );
    if (!pending) return;
    await requestEmail(pending, bucket, chatEpoch.current);
  }

  async function send() {
    const message =
      draft.trim() ||
      (hasAttachment ? "Create an email from these attachments." : "");
    if (!message || busy) return;
    const epoch = chatEpoch.current;
    const pending: PendingEmail = {
      message,
      files,
      referenceHtml,
      currentHtml: html,
      history: messages.slice(-8).map((item) => ({
        role: item.role,
        content: item.text,
      })),
    };
    setError("");
    setDraft("");
    setFiles([]);
    setReferenceHtml("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    if (!imageBucket) {
      pendingEmail.current = pending;
      setBusy(true);
      try {
        const response = await fetch("/api/edm/buckets");
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          buckets?: EdmBucket[];
          projectName?: string;
        } | null;
        if (!response.ok) {
          throw new Error(data?.error || "Could not list buckets");
        }
        if (chatEpoch.current !== epoch) return;
        const buckets = Array.isArray(data?.buckets) ? data.buckets : [];
        if (!buckets.length) {
          throw new Error(
            `No S3 buckets match ${data?.projectName || projectName || "this project"}.`,
          );
        }
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Which ${data?.projectName || projectName || "project"} bucket should the images upload to?`,
            buckets,
          },
        ]);
      } catch (err) {
        if (chatEpoch.current !== epoch) return;
        pendingEmail.current = null;
        setError(err instanceof Error ? err.message : "Could not list buckets");
      } finally {
        if (chatEpoch.current === epoch) setBusy(false);
      }
      return;
    }
    await requestEmail(pending, imageBucket, epoch);
  }

  async function addLink() {
    setMemoryNote("");
    const response = await fetch("/api/edm/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: linkName, link: linkUrl }),
    });
    const data = (await response.json().catch(() => null)) as {
      error?: string;
      link?: MemoryLink;
    } | null;
    if (!response.ok || !data?.link) {
      setMemoryNote(data?.error || "Could not save that link.");
      return;
    }
    setLinks((current) => [data.link as MemoryLink, ...current]);
    setLinkName("");
    setLinkUrl("");
    setMemoryNote("Saved to the knowledge base.");
  }

  async function generatePost() {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const reference = files.find((file) => file.dataUrl)?.dataUrl ?? "";
    const epoch = chatEpoch.current;
    setError("");
    setDraft("");
    setFiles([]);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: prompt }]);
    setBusy(true);
    try {
      const response = await fetch("/api/edm/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, referenceDataUrl: reference }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        imageUrl?: string;
      } | null;
      if (!response.ok || !data?.imageUrl) {
        throw new Error(data?.error || "Could not generate the post");
      }
      if (chatEpoch.current !== epoch) return;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Here is the post.",
          imageUrl: data.imageUrl,
        },
      ]);
    } catch (err) {
      if (chatEpoch.current !== epoch) return;
      setError(err instanceof Error ? err.message : "Could not generate the post");
    } finally {
      if (chatEpoch.current === epoch) setBusy(false);
    }
  }

  async function removeLink(id: string) {
    const response = await fetch(`/api/edm/memory?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) return;
    setLinks((current) => current.filter((item) => item.id !== id));
  }

  async function saveTemplate() {
    setSaveNote("");
    const destinations = [
      ...(saveDrip ? ["drip"] : []),
      ...(saveOneone ? ["oneone"] : []),
    ];
    const name = chatTitle(messages);
    const response = await fetch("/api/edm/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name === "New chat" ? "EDM template" : name,
        subject: "",
        html,
        destinations,
      }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setSaveNote(data?.error || "Could not save the template.");
      return;
    }
    setSaveOpen(false);
    const where = destinations.map((item) => (item === "drip" ? "Drip" : "1-1")).join(" and ");
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Saved to ${where} design templates.`,
      },
    ]);
  }

  const showPreview = previewOpen && Boolean(html.trim());
  const rightOpen = memoryOpen || showPreview;
  const historyCollapsed = rightOpen && !historyExpanded;

  useEffect(() => {
    if (!rightOpen) setHistoryExpanded(false);
  }, [rightOpen]);

  return (
    <>
      <header className="edm-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="edm-top-logo"
          src="https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png"
          alt="Nexuses"
        />
        <div className="edm-top-actions">
          <button
            type="button"
            className="edm-close"
            aria-label="Close EDM generation"
            onClick={() => router.push(PORTAL_ROUTES.drip)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div
        className={`edm-body${showPreview ? " has-preview" : ""}${
          historyCollapsed ? " history-collapsed" : ""
        }`}
      >
        <aside className="edm-history" aria-label="Chat history">
          <div className="edm-history-inner">
            {historyCollapsed ? (
              <div className="edm-history-rail">
                <button
                  type="button"
                  className="edm-history-new"
                  aria-label="New chat"
                  onClick={startNewChat}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 5v14M5 12h14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="edm-history-new"
                  aria-label="Expand sidebar"
                  onClick={() => setHistoryExpanded(true)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 5h14v14H5zM9 5v14M13 9l3 3-3 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}
            <div className="edm-history-head">
              <div className="edm-history-label">Chats</div>
              <div className="edm-history-tools">
              {rightOpen ? (
                <button
                  type="button"
                  className="edm-history-new"
                  aria-label="Collapse sidebar"
                  onClick={() => setHistoryExpanded(false)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 5h14v14H5zM9 5v14M15 9l-3 3 3 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="edm-history-new"
                aria-label="New chat"
                onClick={startNewChat}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              </div>
            </div>
            <div className="edm-history-list">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`edm-history-row${chat.id === activeId ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="edm-history-item"
                    title={chat.title}
                    onClick={() => openChat(chat)}
                  >
                    {chat.title}
                  </button>
                  <button
                    type="button"
                    className="edm-history-delete"
                    aria-label={`Delete ${chat.title}`}
                    onClick={() => deleteChat(chat.id)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>
        <section className="edm-chat" aria-label="Chat">
          <div className={`edm-messages${messages.length === 0 && !html ? " is-empty" : ""}`}>
            {messages.length === 0 && !html ? (
              <button
                type="button"
                className={`edm-hello${helloVisible ? "" : " is-fading"}`}
                onClick={() => setDraft(HELLO_PROMPTS[helloIndex])}
              >
                {HELLO_PROMPTS[helloIndex]}
              </button>
            ) : (
              <div className="edm-thread">
                {messages.map((item) => (
                  <div key={item.id} className={`edm-bubble ${item.role}`}>
                    {item.role === "assistant" ? assistantText(item.text) : item.text}
                    {item.buckets?.length ? (
                      <div className="edm-buckets">
                        {item.buckets.map((bucket) => (
                          <button
                            key={bucket.name}
                            type="button"
                            className="edm-bucket"
                            disabled={busy || Boolean(imageBucket)}
                            onClick={() => void chooseBucket(bucket)}
                          >
                            {bucket.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="edm-post-image" src={item.imageUrl} alt="Generated post" />
                    ) : null}
                  </div>
                ))}
                {busy ? (
                  <div className="edm-typing" aria-label="Working on the email">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
                {html.trim() ? (
                  <button
                    type="button"
                    className={`edm-artifact${showPreview ? " active" : ""}`}
                    onClick={() => setPreviewOpen(true)}
                  >
                    <span className="edm-artifact-mark">HTML</span>
                    <span>
                      <strong>Email</strong>
                      <small>Click to preview</small>
                    </span>
                  </button>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <form
            className="edm-composer-wrap"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="edm-composer">
              {files.length || referenceHtml ? (
                <div className="edm-chips">
                  {files.map((file) => (
                    <div key={file.id} className="edm-chip">
                      {file.dataUrl ? <img src={file.dataUrl} alt="" /> : null}
                      <span>{file.label}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
                        aria-label={`Remove ${file.label}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {referenceHtml ? (
                    <div className="edm-chip">
                      <span>Pasted HTML</span>
                      <button type="button" onClick={() => setReferenceHtml("")} aria-label="Remove pasted HTML">
                        ×
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {pasteOpen ? (
                <div className="edm-paste">
                  <textarea
                    value={pasteDraft}
                    onChange={(event) => setPasteDraft(event.target.value)}
                    placeholder="Paste the reference HTML"
                    rows={6}
                  />
                  <button type="button" className="edm-save" onClick={usePastedHtml}>
                    Use this HTML
                  </button>
                </div>
              ) : null}
              {error ? <p className="edm-error">{error}</p> : null}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={html.trim() ? "Ask for a change" : "Describe the email you want"}
                rows={1}
              />
              <div className="edm-composer-row">
                <label className="edm-tool edm-file">
                  Attach
                  <input
                    type="file"
                    multiple
                    onChange={(event) => {
                      void attachFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="edm-tool"
                  onClick={() => setPasteOpen((open) => !open)}
                >
                  Paste HTML
                </button>
                <button
                  type="button"
                  className={`edm-tool${memoryOpen ? " active" : ""}`}
                  onClick={() => setMemoryOpen((open) => !open)}
                >
                  Knowledge base{links.length ? ` · ${links.length}` : ""}
                </button>
                <button
                  type="button"
                  className="edm-tool"
                  disabled={busy || !draft.trim()}
                  title="Uses the message in the chat. An attached image is an optional reference."
                  onClick={() => void generatePost()}
                >
                  Generate post
                </button>
                <button
                  type="submit"
                  className="edm-send"
                  disabled={busy || (!draft.trim() && !hasAttachment)}
                  aria-label="Send"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 19V6M12 6l-6 6M12 6l6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </form>
        </section>

        {showPreview ? (
          <aside className="edm-preview" aria-label="HTML preview">
            <div className="edm-preview-bar">
              <span>{codeView ? "Code" : "Preview"}</span>
              <div className="edm-preview-actions">
                <button
                  type="button"
                  className={`edm-save${codeView ? " active" : ""}`}
                  onClick={() => setCodeView((open) => !open)}
                >
                  Code
                </button>
                <button
                  type="button"
                  className="edm-save"
                  onClick={() => {
                    setSaveNote("");
                    setSaveOpen(true);
                  }}
                >
                  Save template
                </button>
                <button
                  type="button"
                  className="edm-close"
                  aria-label="Close preview"
                  onClick={() => setPreviewOpen(false)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {codeView ? (
              <pre className="edm-code">
                <code>{html}</code>
              </pre>
            ) : (
              <div className="edm-preview-frame">
                <iframe title="EDM preview" sandbox="" srcDoc={html} />
              </div>
            )}
          </aside>
        ) : null}

        <aside
          className={`edm-memory-panel${memoryOpen ? " open" : ""}`}
          aria-label="Knowledge base"
          aria-hidden={!memoryOpen}
        >
          <div className="edm-memory-panel-inner">
            <div className="edm-memory-head">
              <div>
                <h2 id="edm-memory-title">Knowledge base</h2>
                <p>Included in every email</p>
              </div>
              <button type="button" onClick={() => setMemoryOpen(false)} aria-label="Close knowledge base">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <section className="edm-memory-brand" aria-label="Client logo">
              <div className="edm-memory-logo-frame">
                {logoUrl ? (
                  <img src={logoUrl} alt={`${projectName || "Client"} logo`} />
                ) : (
                  <span>{projectName.slice(0, 1) || "C"}</span>
                )}
              </div>
              <div>
                <span>Client</span>
                <strong>{projectName || "This project"}</strong>
              </div>
            </section>

            <section className="edm-memory-links" aria-label="Saved links">
              <h3>Links</h3>
              {links.length === 0 ? (
                <p className="edm-memory-empty">Add a site or deck link. The email can use it as a button.</p>
              ) : (
                <ul>
                  {links.map((item) => (
                    <li key={item.id}>
                      <a href={item.link} target="_blank" rel="noreferrer">
                        <strong>{item.name}</strong>
                        <span>{item.link.replace(/^https?:\/\//, "")}</span>
                      </a>
                      <button type="button" onClick={() => void removeLink(item.id)} aria-label={`Remove ${item.name}`}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <form
              className="edm-memory-form"
              onSubmit={(event) => {
                event.preventDefault();
                void addLink();
              }}
            >
              <h3>Add a link</h3>
              <label className="edm-field">
                Name
                <input
                  value={linkName}
                  onChange={(event) => setLinkName(event.target.value)}
                  placeholder="Website"
                  required
                />
              </label>
              <label className="edm-field">
                Link
                <input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://"
                  required
                />
              </label>
              {memoryNote ? <p className="edm-note">{memoryNote}</p> : null}
              <button type="submit" className="edm-memory-add" disabled={!linkName.trim() || !linkUrl.trim()}>
                Add to knowledge base
              </button>
            </form>
          </div>
        </aside>
      </div>

      {saveOpen ? (
        <div className="edm-modal-backdrop" role="presentation" onMouseDown={() => setSaveOpen(false)}>
          <form
            className="edm-modal"
            role="dialog"
            aria-labelledby="edm-save-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveTemplate();
            }}
          >
            <h2 id="edm-save-title">Save template</h2>
            <p className="edm-save-lead">Add this email to a design template list.</p>
            <div className="edm-save-choices" role="group" aria-label="Save into">
              <button
                type="button"
                className={`edm-save-choice${saveDrip ? " active" : ""}`}
                aria-pressed={saveDrip}
                onClick={() => setSaveDrip((value) => !value)}
              >
                <span className="edm-save-choice-mark" aria-hidden="true" />
                <span>
                  <strong>Drip</strong>
                  <small>Design templates</small>
                </span>
              </button>
              <button
                type="button"
                className={`edm-save-choice${saveOneone ? " active" : ""}`}
                aria-pressed={saveOneone}
                onClick={() => setSaveOneone((value) => !value)}
              >
                <span className="edm-save-choice-mark" aria-hidden="true" />
                <span>
                  <strong>1-1</strong>
                  <small>Design templates</small>
                </span>
              </button>
            </div>
            {saveNote ? <p className="edm-error">{saveNote}</p> : null}
            <div className="edm-modal-actions">
              <button type="button" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="edm-send" disabled={!saveDrip && !saveOneone}>
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
