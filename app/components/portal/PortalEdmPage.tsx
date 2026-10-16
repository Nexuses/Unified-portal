"use client";

import { useEffect, useRef, useState } from "react";
import ApiCreditButton from "@/app/components/portal/ApiCreditButton";
import { extractEdmResult } from "@/lib/edm-result";
import { useRouter } from "next/navigation";
import { PORTAL_ROUTES } from "@/lib/portal-nav";
import { useSpeechInput } from "@/lib/use-speech-input";

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
  uploadImageUrl?: string;
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
  loaded?: boolean;
};

type PendingEmail = {
  message: string;
  files: ChatFile[];
  referenceHtml: string;
  currentHtml: string;
  history: { role: "user" | "assistant"; content: string }[];
};

type PendingUpload = {
  html: string;
  files: ChatFile[];
};

const HELLO_PROMPTS = [
  "What email or social post should we make?",
  "Write a product launch email in our brand",
  "Create a square social post for this offer",
  "Make a short follow-up with one button",
  "Design a LinkedIn post from our brand",
  "Change the email, or ask for a new post",
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

function wantsPostUpload(text: string) {
  return (
    /\b(s3|bucket)\b/i.test(text) ||
    (/\bupload\b/i.test(text) && /\b(post|image|it|this|link|url)\b/i.test(text))
  );
}

function wantsPost(text: string) {
  if (/\b(email|e-mail|edm|newsletter|mailer)\b/i.test(text)) return false;
  if (wantsPostUpload(text) && !/\b(generate|create|make|design|draw|write)\b/i.test(text)) {
    return false;
  }
  return /\b(post|instagram|linkedin|facebook|banner|social media)\b/i.test(text);
}

function downloadPost(imageUrl: string) {
  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = "social-post.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function blankChat(): SavedChat {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    html: "",
    updatedAt: new Date().toISOString(),
    loaded: true,
  };
}

function hasContent(chat: Pick<SavedChat, "messages" | "html">) {
  return chat.messages.length > 0 || Boolean(chat.html.trim());
}

function chatPayload(chat: Pick<SavedChat, "id" | "messages" | "html" | "imageBucket">) {
  return JSON.stringify({
    id: chat.id,
    title: chatTitle(chat.messages),
    messages: chat.messages.slice(-30),
    html: chat.html,
    imageBucket: chat.imageBucket ?? null,
  });
}

async function putChat(payload: string) {
  const response = await fetch("/api/edm/chats", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "Could not save the chat");
  }
}

/** Chats from before server storage lived only in this browser; move them into the open project once. */
function takeBrowserChats(): SavedChat[] {
  const found: SavedChat[] = [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { chats?: SavedChat[] };
      if (Array.isArray(parsed.chats)) {
        for (const item of parsed.chats) {
          if (item && typeof item.id === "string" && Array.isArray(item.messages)) {
            const chat = { ...item, html: typeof item.html === "string" ? item.html : "" };
            if (hasContent(chat)) found.push(chat);
          }
        }
      }
    }
  } catch {
    // Ignore a broken history entry.
  }
  try {
    const legacy = window.localStorage.getItem(THREAD_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { messages?: ChatTurn[]; html?: string };
      const chat: SavedChat = {
        id: crypto.randomUUID(),
        title: "",
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        html: typeof parsed.html === "string" ? parsed.html : "",
        updatedAt: new Date().toISOString(),
      };
      if (hasContent(chat)) found.push(chat);
    }
  } catch {
    // Ignore a broken older thread.
  }
  return found.slice(0, 40);
}

function forgetBrowserChats() {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
    window.localStorage.removeItem(THREAD_KEY);
  } catch {
    // Storage may be unavailable.
  }
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

function SaveToast({
  message,
  durationMs = 4000,
  onDone,
}: {
  message: string;
  durationMs?: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
    // Toast is remounted with a new key when shown again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div className="drip-error-toast success" role="status">
      <div className="drip-error-toast-body">
        <span className="drip-error-toast-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="currentColor" />
            <path d="M7.5 12.5 10.5 15.5 16.5 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="drip-error-toast-text">{message}</span>
      </div>
      <div className="drip-error-toast-progress" aria-hidden="true">
        <span style={{ animationDuration: `${durationMs}ms` }} />
      </div>
    </div>
  );
}

export default function PortalEdmPage() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatEpoch = useRef(0);
  const pendingEmail = useRef<PendingUpload | null>(null);
  const savedPayloads = useRef(new Map<string, string>());
  const pendingSave = useRef<{ id: string; payload: string; timer: number } | null>(null);
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
  const [projectName, setProjectName] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveDrip, setSaveDrip] = useState(true);
  const [saveOneone, setSaveOneone] = useState(true);
  const [saveNote, setSaveNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [imageBucket, setImageBucket] = useState<EdmBucket | null>(null);
  const [helloIndex, setHelloIndex] = useState(0);
  const [helloVisible, setHelloVisible] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const speech = useSpeechInput({ value: draft, onChange: setDraft });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let saved: SavedChat[] = [];
      try {
        const response = await fetch("/api/edm/chats");
        const data = (await response.json().catch(() => null)) as {
          chats?: SavedChat[];
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(data?.error || "Could not load your chats");
        }
        saved = (Array.isArray(data?.chats) ? data.chats : []).map((chat) => ({
          id: chat.id,
          title: chat.title || "New chat",
          messages: [],
          html: "",
          updatedAt: chat.updatedAt,
          loaded: false,
        }));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load your chats");
        }
      }
      if (cancelled) return;
      const fresh = blankChat();
      setChats([fresh, ...saved].slice(0, 40));
      setActiveId(fresh.id);
      setMessages([]);
      setHtml("");
      setPreviewOpen(false);
      setReady(true);
      const local = takeBrowserChats();
      if (!local.length) return;
      const known = new Set(saved.map((chat) => chat.id));
      const moved: SavedChat[] = [];
      for (const chat of local) {
        if (known.has(chat.id)) continue;
        try {
          await putChat(chatPayload(chat));
          moved.push({ ...chat, loaded: true });
        } catch {
          // Keep going. A failed copy stays out of this list.
        }
      }
      forgetBrowserChats();
      if (cancelled || !moved.length) return;
      for (const chat of moved) {
        savedPayloads.current.set(chat.id, chatPayload(chat));
      }
      setChats((current) => {
        const ids = new Set(current.map((chat) => chat.id));
        return [...current, ...moved.filter((chat) => !ids.has(chat.id))]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 40);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/edm/memory");
      if (!response.ok) return;
      const data = (await response.json()) as { projectName?: string };
      setProjectName(typeof data.projectName === "string" ? data.projectName : "");
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
      return active ? [active, ...next.filter((chat) => chat.id !== activeId)] : next;
    });
  }, [messages, html, imageBucket, ready, activeId]);

  useEffect(() => {
    const flush = () => {
      const pending = pendingSave.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pendingSave.current = null;
      void putChat(pending.payload).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (!ready || !activeId) return;
    const previous = pendingSave.current;
    if (previous && previous.id !== activeId) {
      window.clearTimeout(previous.timer);
      pendingSave.current = null;
      void putChat(previous.payload)
        .then(() => savedPayloads.current.set(previous.id, previous.payload))
        .catch(() => setError("Could not save the last chat. Check your connection."));
    }
    if (!hasContent({ messages, html })) return;
    const payload = chatPayload({ id: activeId, messages, html, imageBucket });
    if (savedPayloads.current.get(activeId) === payload) return;
    if (pendingSave.current) window.clearTimeout(pendingSave.current.timer);
    const id = activeId;
    const timer = window.setTimeout(() => {
      pendingSave.current = null;
      void putChat(payload)
        .then(() => savedPayloads.current.set(id, payload))
        .catch(() => setError("Could not save this chat. Check your connection."));
    }, 700);
    pendingSave.current = { id, payload, timer };
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
    const epoch = chatEpoch.current;
    setActiveId(chat.id);
    setImageBucket(chat.imageBucket ?? null);
    pendingEmail.current = null;
    setDraft("");
    setFiles([]);
    setReferenceHtml("");
    setPasteOpen(false);
    setPasteDraft("");
    setError("");
    setBusy(false);
    if (chat.loaded !== false) {
      setMessages(chat.messages);
      setHtml(chat.html);
      setPreviewOpen(Boolean(chat.html.trim()));
      setChatLoading(false);
      return;
    }
    setMessages([]);
    setHtml("");
    setPreviewOpen(false);
    setChatLoading(true);
    void fetch(`/api/edm/chats?id=${encodeURIComponent(chat.id)}`)
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          chat?: SavedChat;
          error?: string;
        } | null;
        if (!response.ok || !data?.chat) {
          throw new Error(data?.error || "Could not open that chat");
        }
        return data.chat;
      })
      .then((full) => {
        if (chatEpoch.current !== epoch) return;
        const loaded = { ...full, loaded: true };
        savedPayloads.current.set(loaded.id, chatPayload(loaded));
        setChats((current) =>
          current.map((item) => (item.id === loaded.id ? { ...item, ...loaded } : item)),
        );
        setMessages(loaded.messages ?? []);
        setHtml(loaded.html ?? "");
        setImageBucket(loaded.imageBucket ?? null);
        setPreviewOpen(Boolean(loaded.html?.trim()));
      })
      .catch((err: unknown) => {
        if (chatEpoch.current !== epoch) return;
        setError(err instanceof Error ? err.message : "Could not open that chat");
      })
      .finally(() => {
        if (chatEpoch.current === epoch) setChatLoading(false);
      });
  }

  function deleteChat(id: string) {
    const remaining = chats.filter((chat) => chat.id !== id);
    const next = remaining.length ? remaining : [blankChat()];
    const active = id === activeId ? next[0] : next.find((chat) => chat.id === activeId) ?? next[0];
    setChats(next);
    if (pendingSave.current?.id === id) {
      window.clearTimeout(pendingSave.current.timer);
      pendingSave.current = null;
    }
    const removed = chats.find((chat) => chat.id === id);
    if (removed && (removed.loaded === false || savedPayloads.current.has(id) || hasContent(removed))) {
      savedPayloads.current.delete(id);
      void fetch(`/api/edm/chats?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(
        (response) => {
          if (!response.ok && response.status !== 404) {
            setError("Could not delete that chat.");
          }
        },
      );
    }
    if (id !== activeId) return;
    if (active.loaded === false) {
      openChat(active);
      return;
    }
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

  function attachmentPayload(files: ChatFile[]) {
    return files.map((file) => ({
      name: file.label,
      text: file.text ?? "",
      dataUrl: file.dataUrl ?? "",
    }));
  }

  async function requestEmail(pending: PendingEmail, bucket: EdmBucket | null, epoch: number) {
    setBusy(true);
    try {
      const response = await fetch("/api/edm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: pending.message,
          history: pending.history,
          referenceHtml: pending.referenceHtml,
          attachments: attachmentPayload(pending.files),
          currentHtml: pending.currentHtml,
          bucket,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        html?: string;
        needsBucket?: boolean;
        buckets?: EdmBucket[];
        projectName?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Chat failed");
      }
      if (chatEpoch.current !== epoch) return;
      window.dispatchEvent(new Event("nexuses-api-credit"));
      if (data?.needsBucket && data.html) {
        pendingEmail.current = { html: data.html, files: pending.files };
        setMessages((current) => [
          ...current,
          ...(data.message
            ? [{ id: crypto.randomUUID(), role: "assistant" as const, text: data.message }]
            : []),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `This email has images. Which ${data.projectName || projectName || "project"} bucket should they upload to?`,
            buckets: data.buckets ?? [],
          },
        ]);
        return;
      }
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

  async function finishPostUpload(imageUrl: string, bucket: EdmBucket | null) {
    const epoch = chatEpoch.current;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/edm/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload: true,
          imageUrl,
          bucket: bucket ? { name: bucket.name, region: bucket.region } : undefined,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        url?: string;
        bucket?: string;
        needsBucket?: boolean;
        buckets?: EdmBucket[];
      } | null;
      if (chatEpoch.current !== epoch) return;
      if (data?.needsBucket) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Which bucket should this post go to?",
            buckets: data.buckets ?? [],
            uploadImageUrl: imageUrl,
          },
        ]);
        return;
      }
      if (!response.ok || !data?.url) {
        throw new Error(data?.error || "Could not upload the post");
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `The post is on S3${data.bucket ? ` (${data.bucket})` : ""}:\n${data.url}`,
        },
      ]);
    } catch (err) {
      if (chatEpoch.current !== epoch) return;
      setError(err instanceof Error ? err.message : "Could not upload the post");
    } finally {
      if (chatEpoch.current === epoch) setBusy(false);
    }
  }

  async function chooseBucket(bucket: EdmBucket) {
    if (busy) return;
    const uploadImage = messages.find((item) => item.buckets && item.uploadImageUrl)?.uploadImageUrl;
    if (uploadImage) {
      setImageBucket(bucket);
      setMessages((current) =>
        current.map((item) =>
          item.uploadImageUrl && item.buckets
            ? { ...item, buckets: undefined, uploadImageUrl: undefined, text: `Uploading the post to ${bucket.name}.` }
            : item,
        ),
      );
      await finishPostUpload(uploadImage, bucket);
      return;
    }
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
    const epoch = chatEpoch.current;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/edm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalizeHtml: pending.html,
          attachments: attachmentPayload(pending.files),
          bucket,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        html?: string;
      } | null;
      if (!response.ok || !data?.html) {
        throw new Error(data?.error || "Could not upload the images");
      }
      if (chatEpoch.current !== epoch) return;
      setHtml(data.html);
      setPreviewOpen(true);
      if (data.message) {
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", text: data.message ?? "" },
        ]);
      }
    } catch (err) {
      if (chatEpoch.current !== epoch) return;
      setError(err instanceof Error ? err.message : "Could not upload the images");
    } finally {
      if (chatEpoch.current === epoch) setBusy(false);
    }
  }

  async function send() {
    if (!ready || busy) return;
    if (wantsPost(draft)) {
      await generatePost();
      return;
    }
    if (wantsPostUpload(draft)) {
      const imageUrl = [...messages].reverse().find((item) => item.imageUrl)?.imageUrl;
      const message = draft.trim();
      if (!message) return;
      speech.stop();
      setError("");
      setDraft("");
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
      if (!imageUrl) {
        setError("Generate a post first, then ask to upload it.");
        return;
      }
      await finishPostUpload(imageUrl, imageBucket);
      return;
    }
    const message =
      draft.trim() ||
      (hasAttachment ? "Create an email from these attachments." : "");
    if (!message || busy) return;
    const epoch = chatEpoch.current;
    speech.stop();
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
    pendingEmail.current = null;
    await requestEmail(pending, imageBucket, epoch);
  }

  async function generatePost() {
    if (busy || !ready) return;
    const reference = files.find((file) => file.dataUrl)?.dataUrl ?? "";
    const prompt =
      draft.trim() ||
      (reference ? `Create a post like this in ${projectName || "our"} branding and content.` : "");
    const alsoUpload = wantsPostUpload(prompt);
    if (!prompt) {
      setError("Describe the post, then press send.");
      return;
    }
    speech.stop();
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
      window.dispatchEvent(new Event("nexuses-api-credit"));
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Here is the post. Hover it to download.",
          imageUrl: data.imageUrl,
        },
      ]);
      if (alsoUpload && data.imageUrl) {
        await finishPostUpload(data.imageUrl, imageBucket);
      }
    } catch (err) {
      if (chatEpoch.current !== epoch) return;
      setError(err instanceof Error ? err.message : "Could not generate the post");
    } finally {
      if (chatEpoch.current === epoch) setBusy(false);
    }
  }

  async function saveTemplate() {
    setSaveNote("");
    if (saving) return;
    setSaveNote("");
    const destinations = [
      ...(saveDrip ? ["drip"] : []),
      ...(saveOneone ? ["oneone"] : []),
    ];
    const name = chatTitle(messages);
    setSaving(true);
    let response: Response;
    try {
      response = await fetch("/api/edm/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name === "New chat" ? "EDM template" : name,
          subject: "",
          html,
          destinations,
        }),
      });
    } catch {
      setSaving(false);
      setSaveNote("Could not reach the server. Please try again.");
      return;
    }
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setSaveNote(data?.error || "Could not save the template.");
      return;
    }
    setSaveOpen(false);
    const where = destinations.map((item) => (item === "drip" ? "Drip" : "1-1")).join(" and ");
    setToast({ key: Date.now(), message: `Template saved to ${where} design templates` });
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
  const rightOpen = showPreview;
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
          <ApiCreditButton />
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
          <div className={`edm-messages${messages.length === 0 && !html && !chatLoading ? " is-empty" : ""}`}>
            {chatLoading ? (
              <p className="edm-chat-loading">Loading chat…</p>
            ) : messages.length === 0 && !html ? (
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
                      <div className="edm-post-frame">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="edm-post-image" src={item.imageUrl} alt="Generated post" />
                        <button
                          type="button"
                          className="edm-post-download"
                          aria-label="Download post"
                          onClick={() => downloadPost(item.imageUrl || "")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M12 4v10M8 10l4 4 4-4M5 19h14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
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
              {speech.error ? <p className="edm-error">{speech.error}</p> : null}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  speech.listening
                    ? "Listening… speak now"
                    : html.trim()
                      ? "Ask for an email change, or ask for a social post"
                      : "Describe an email or a social post"
                }
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
                {speech.supported ? (
                  <button
                    type="button"
                    className={`edm-mic${speech.listening ? " is-listening" : ""}`}
                    onClick={speech.toggle}
                    disabled={busy}
                    aria-pressed={speech.listening}
                    aria-label={speech.listening ? "Stop speaking" : "Speak"}
                    title={speech.listening ? "Stop speaking" : "Speak instead of typing"}
                  >
                    {speech.listening ? (
                      <span className="edm-mic-wave" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="edm-send"
                  disabled={busy || !ready || (!draft.trim() && !hasAttachment)}
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
              <button type="submit" className="edm-send" disabled={saving || (!saveDrip && !saveOneone)}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {toast ? (
        <SaveToast key={toast.key} message={toast.message} onDone={() => setToast(null)} />
      ) : null}
    </>
  );
}
