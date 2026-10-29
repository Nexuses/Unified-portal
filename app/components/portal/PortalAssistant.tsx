"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import PortalPeopleSearchCard from "@/app/components/portal/PortalPeopleSearchCard";
import PortalPitchResearchCard from "@/app/components/portal/PortalPitchResearchCard";
import { CSV_MARKER, UPLOAD_MARKER, type AssistantCard } from "@/lib/assistant";
import {
  PITCH_RESEARCH_ACCEPT,
  PITCH_RESEARCH_MARKER,
  type AssistantPitchResearchCard,
} from "@/lib/pitch-research";
import { useSpeechInput } from "@/lib/use-speech-input";

type UploadBucket = { name: string; region: string };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Bucket choices for the file waiting to upload. */
  buckets?: UploadBucket[];
  uploadUrl?: string;
  /** File name and size shown on a user message that came with an upload. */
  attachment?: string;
  /** People searches and pitch research shown as result cards under the reply. */
  cards?: AssistantCard[];
};

const PITCH_FILE = /\.(csv|xlsx|txt)$/i;
const PITCH_REQUEST = /\b(research|pitch(es)?)\b/i;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SUGGESTIONS = [
  "Give me an overview of this project",
  "Find directors at construction companies in Saudi Arabia",
  "Research my company list and write custom pitches",
  "How did my campaigns perform this month?",
  "Which campaign has the best open rate?",
  "Show the latest replies in the inbox",
  "Are my senders set up correctly?",
  "How do I create a Personalise campaign?",
];

const BOT_FACE_IMAGE = "/assistant/bot-face.png";
const EYE_REACH_PX = 260;

function BotIcon({ size = 24 }: { size?: number }) {
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;

    const update = () => {
      frame = 0;
      if (!pointer) return;
      const rect = root.getBoundingClientRect();
      if (!rect.width) return;
      const dx = pointer.x - (rect.left + rect.width / 2);
      const dy = pointer.y - (rect.top + rect.height * 0.5);
      const distance = Math.hypot(dx, dy) || 1;
      const strength = Math.min(1, distance / 40) * (distance < EYE_REACH_PX ? 1 : 0.55);
      root.style.setProperty("--eye-x", ((dx / distance) * strength).toFixed(3));
      root.style.setProperty("--eye-y", ((dy / distance) * strength).toFixed(3));
      root.classList.toggle("is-watching", distance < EYE_REACH_PX);
    };

    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onLeave = () => {
      pointer = null;
      root.style.setProperty("--eye-x", "0");
      root.style.setProperty("--eye-y", "0");
      root.classList.remove("is-watching");
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span
      ref={rootRef}
      className="pa-bot-img"
      style={{ "--bot-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BOT_FACE_IMAGE} alt="" className="pa-bot-face" draggable={false} />
      <i className="pa-bot-eye is-left" />
      <i className="pa-bot-eye is-right" />
    </span>
  );
}

function tidyMarkdown(text: string) {
  let inFence = false;
  const cleaned = text
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      if (inFence) return line;
      const marks = line.match(/\*\*/g)?.length ?? 0;
      if (marks % 2 === 0) return line;
      const last = line.lastIndexOf("**");
      return line.slice(0, last) + line.slice(last + 2);
    })
    .join("\n");
  return normalizeMarkdownTables(cleaned);
}

function splitRawTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** Pad uneven GFM table rows so columns line up when rendered. */
function normalizeMarkdownTables(markdown: string) {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const separator = lines[index + 1]?.trim() ?? "";
    const isTable =
      Boolean(lines[index]?.includes("|")) &&
      /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(separator);
    if (!isTable) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    const block: string[] = [lines[index], lines[index + 1]];
    let cursor = index + 2;
    while (
      cursor < lines.length &&
      lines[cursor].includes("|") &&
      lines[cursor].trim()
    ) {
      block.push(lines[cursor]);
      cursor += 1;
    }
    const dataRows = block
      .filter((_, rowIndex) => rowIndex !== 1)
      .map((line) => splitRawTableRow(line));
    const width = Math.max(...dataRows.map((row) => row.length), 1);
    const padded = block.map((line, rowIndex) => {
      if (rowIndex === 1) {
        const cells = Array.from({ length: width }, () => "---");
        return `| ${cells.join(" | ")} |`;
      }
      const cells = splitRawTableRow(line);
      while (cells.length < width) {
        cells.push("");
      }
      return `| ${cells.slice(0, width).join(" | ")} |`;
    });
    // Blank line before tables helps GFM parse reliably in chat.
    if (out.length > 0 && out[out.length - 1].trim() !== "") {
      out.push("");
    }
    out.push(...padded);
    index = cursor;
  }
  return out.join("\n");
}

function cleanCell(cell: string) {
  const text = cell
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
  return /^-?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(text) ? text.replace(/,/g, "") : text;
}

function splitRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(cleanCell);
}

/** GFM pipe tables in a reply, as rows of cells (header row first). */
function extractTables(markdown: string) {
  const lines = markdown.split("\n");
  const tables: string[][][] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const separator = lines[index + 1].trim();
    if (!lines[index].includes("|") || !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(separator)) {
      continue;
    }
    const rows = [splitRow(lines[index])];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim()) {
      rows.push(splitRow(lines[cursor]));
      cursor += 1;
    }
    tables.push(rows);
    index = cursor - 1;
  }
  return tables;
}

function csvValue(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsvFile(csv: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadTablesCsv(markdown: string) {
  const tables = extractTables(markdown);
  if (tables.length === 0) {
    return;
  }
  const csv = tables
    .map((rows) => rows.map((row) => row.map(csvValue).join(",")).join("\r\n"))
    .join("\r\n\r\n");
  const heading = markdown.match(/^#{1,4}\s+(.+)$/m)?.[1] ?? "assistant-export";
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  downloadCsvFile(
    csv,
    `${slug || "assistant-export"}-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

function downloadHtmlTableCsv(table: HTMLTableElement) {
  const rows = [...table.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll("th,td")].map((cell) =>
      csvValue((cell.textContent || "").replace(/\s+/g, " ").trim()),
    ),
  );
  if (rows.length === 0) {
    return;
  }
  const csv = rows.map((row) => row.join(",")).join("\r\n");
  downloadCsvFile(
    csv,
    `assistant-table-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

function AssistantMarkdownTable({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div className="pa-table-card">
      <div className="pa-table-toolbar">
        <button
          type="button"
          className="pa-table-export"
          onClick={() => {
            const table = wrapRef.current?.querySelector("table");
            if (table) {
              downloadHtmlTableCsv(table);
            }
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Export
        </button>
      </div>
      <div className="pa-table-wrap" ref={wrapRef}>
        <table>{children}</table>
      </div>
    </div>
  );
}

type AssistantStat = { label: string; value: string; hint?: string };

type AssistantSegment =
  | { type: "md"; text: string }
  | { type: "stats"; items: AssistantStat[] };

const STAT_LINE_RE =
  /^([A-Za-z][A-Za-z0-9 /&+’'-]{1,40}):\s+(-?\d[\d,]*(?:\.\d+)?%?(?:\s*\([^)]+\))?|-)$/;

function parseStatValue(rawInput: string): Pick<AssistantStat, "value" | "hint"> {
  const raw = rawInput.replace(/\*\*/g, "").trim();
  const hintMatch = raw.match(/\(([^)]+)\)\s*$/);
  const value = hintMatch ? raw.slice(0, hintMatch.index).trim() : raw;
  const hint = hintMatch?.[1]?.trim();
  return hint ? { value, hint } : { value };
}

function parseStatLine(line: string): AssistantStat | null {
  const match = line.trim().match(STAT_LINE_RE);
  if (!match) {
    return null;
  }
  return { label: match[1].trim(), ...parseStatValue(match[2]) };
}

function isTableSeparator(line: string) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function isMetricValueHeader(cells: string[]) {
  if (cells.length !== 2) {
    return false;
  }
  const left = cells[0].replace(/\*\*/g, "").trim().toLowerCase();
  const right = cells[1].replace(/\*\*/g, "").trim().toLowerCase();
  return (
    /^(metric|metrics|stat|stats|measure|kpi|field|name)$/.test(left) &&
    /^(value|count|total|totals|number|amount)$/.test(right)
  );
}

function statsFromMetricValueTable(block: string[]): AssistantStat[] | null {
  if (block.length < 3 || !isTableSeparator(block[1] || "")) {
    return null;
  }
  const header = splitRawTableRow(block[0] || "");
  if (!isMetricValueHeader(header)) {
    return null;
  }
  const items: AssistantStat[] = [];
  for (const line of block.slice(2)) {
    const cells = splitRawTableRow(line).map((cell) => cell.replace(/\*\*/g, "").trim());
    if (cells.length < 2) {
      continue;
    }
    const label = cells[0];
    const parsed = parseStatValue(cells[1]);
    if (!label || !parsed.value) {
      continue;
    }
    items.push({ label, ...parsed });
  }
  return items.length >= 2 ? items : null;
}

function readMarkdownTableBlock(lines: string[], start: number) {
  if (
    !lines[start]?.includes("|") ||
    !isTableSeparator(lines[start + 1] || "")
  ) {
    return null;
  }
  const block = [lines[start], lines[start + 1]];
  let cursor = start + 2;
  while (
    cursor < lines.length &&
    lines[cursor].includes("|") &&
    lines[cursor].trim()
  ) {
    block.push(lines[cursor]);
    cursor += 1;
  }
  return { block, end: cursor };
}

/** Pull Metric/Value tables and Delivered:/Opens: lines into scorecard segments. */
function splitAssistantSegments(markdown: string): AssistantSegment[] {
  const lines = markdown.split("\n");
  const segments: AssistantSegment[] = [];
  let mdBuffer: string[] = [];
  let index = 0;

  const flushMd = () => {
    const text = mdBuffer.join("\n").trim();
    if (text) {
      segments.push({ type: "md", text });
    }
    mdBuffer = [];
  };

  while (index < lines.length) {
    const table = readMarkdownTableBlock(lines, index);
    if (table) {
      const scorecards = statsFromMetricValueTable(table.block);
      if (scorecards) {
        flushMd();
        segments.push({ type: "stats", items: scorecards });
        index = table.end;
        continue;
      }
      mdBuffer.push(...table.block);
      index = table.end;
      continue;
    }

    const first = parseStatLine(lines[index] || "");
    if (!first) {
      mdBuffer.push(lines[index] || "");
      index += 1;
      continue;
    }
    const items: AssistantStat[] = [first];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const blank = !(lines[cursor] || "").trim();
      if (blank) {
        if (cursor + 1 < lines.length && parseStatLine(lines[cursor + 1] || "")) {
          cursor += 1;
          continue;
        }
        break;
      }
      const next = parseStatLine(lines[cursor] || "");
      if (!next) {
        break;
      }
      items.push(next);
      cursor += 1;
    }
    if (items.length >= 2) {
      flushMd();
      segments.push({ type: "stats", items });
      index = cursor;
      continue;
    }
    mdBuffer.push(lines[index] || "");
    index += 1;
  }
  flushMd();
  return segments.length > 0 ? segments : [{ type: "md", text: markdown }];
}

function AssistantStatCards({ items }: { items: AssistantStat[] }) {
  return (
    <div className="pa-stat-grid" role="group" aria-label="Report totals">
      {items.map((item) => (
        <div className="pa-stat-card" key={`${item.label}-${item.value}`}>
          <div className="pa-stat-label">{item.label}</div>
          <div className="pa-stat-value">{item.value}</div>
          {item.hint ? <div className="pa-stat-hint">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

function AssistantMarkdownBody({
  content,
  components,
}: {
  content: string;
  components: Components;
}) {
  const prepared = tidyMarkdown(stripCsvMarker(content));
  const segments = splitAssistantSegments(prepared);
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "stats" ? (
          <AssistantStatCards key={`stats-${index}`} items={segment.items} />
        ) : (
          <ReactMarkdown
            key={`md-${index}`}
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {segment.text}
          </ReactMarkdown>
        ),
      )}
    </>
  );
}

function stripCsvMarker(content: string) {
  return [CSV_MARKER, UPLOAD_MARKER, PITCH_RESEARCH_MARKER]
    .reduce((text, marker) => text.split(marker).join(""), content)
    .trimEnd();
}

const AFFIRMATIVE = /^(y|yes|yeah|yep|yup|sure|ok|okay|please|pls|haan|ha|do it|go ahead)\b/i;

/** The reply carries the CSV marker, or answers "yes" to the bot's previous CSV offer. */
function csvRequested(messages: ChatMessage[], index: number) {
  if (messages[index].content.includes(CSV_MARKER)) {
    return true;
  }
  const question = messages[index - 1];
  const offer = messages[index - 2];
  return (
    question?.role === "user" &&
    offer?.role === "assistant" &&
    /\b(csv|export|download)\b/i.test(offer.content.split("\n").slice(-3).join(" ")) &&
    (AFFIRMATIVE.test(question.content.trim()) ||
      /\b(csv|export|download)\b/i.test(question.content))
  );
}

function storageKey(projectId: string) {
  return `portal-assistant-chat:${projectId}`;
}

export default function PortalAssistant({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  /** Session-only: refresh shows the launcher again. */
  const [launcherHidden, setLauncherHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overDismiss, setOverDismiss] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
    overDismiss: boolean;
  } | null>(null);
  const launcherWrapRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const saved = sessionStorage.getItem(storageKey(projectId));
      return saved ? (JSON.parse(saved) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const speech = useSpeechInput({ value: draft, onChange: setDraft });
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pitchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = messages
        .slice(-40)
        .map((message) => (message.buckets ? { ...message, buckets: undefined } : message));
      sessionStorage.setItem(storageKey(projectId), JSON.stringify(saved));
    } catch {
      // Storage can be full or unavailable.
    }
  }, [messages, projectId]);

  const stopSpeech = speech.stop;
  useEffect(() => {
    if (!open) {
      stopSpeech();
      return;
    }
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stopSpeech]);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, thinking, open]);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    }
  }, [draft]);

  /** Ask the model; `hiddenQuestion` is sent as the last user turn without showing it. */
  async function requestReply(visible: ChatMessage[], hiddenQuestion?: string) {
    setError("");
    setThinking(true);
    try {
      const payload = visible.map(({ role, content }) => ({ role, content }));
      if (hiddenQuestion) {
        payload.push({ role: "user", content: hiddenQuestion });
      }
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        reply?: string;
        cards?: AssistantCard[];
        error?: string;
      };
      if (!response.ok || !data.reply) {
        throw new Error(data.error || "The assistant could not answer right now.");
      }
      setMessages([
        ...visible,
        {
          role: "assistant",
          content: data.reply,
          ...(data.cards?.length ? { cards: data.cards } : {}),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer right now.");
    } finally {
      setThinking(false);
    }
  }

  async function ask(question: string, base = messages) {
    const text = question.trim();
    if (!text || thinking) {
      return;
    }
    speech.stop();
    const next: ChatMessage[] = [...base, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    await requestReply(next);
  }

  function submit() {
    if (attachedFile && PITCH_FILE.test(attachedFile.name) && PITCH_REQUEST.test(draft)) {
      void startPitchResearch(attachedFile, draft.trim());
    } else if (attachedFile) {
      void startUpload(attachedFile, draft.trim());
    } else {
      void ask(draft);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onFilePicked(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`${file.name} is too big. Files can be up to 25 MB.`);
      return;
    }
    setError("");
    setAttachedFile(file);
    inputRef.current?.focus();
  }

  /** Uploads a company list; `focus` defaults to the user's latest request in the chat. */
  async function startPitchResearch(file: File, prompt = "") {
    if (uploading || thinking) {
      return;
    }
    speech.stop();
    setError("");
    setAttachedFile(null);
    setDraft("");
    const focus =
      prompt || [...messages].reverse().find((message) => message.role === "user")?.content || "";
    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: prompt || `Research the companies in ${file.name}`,
        attachment: `${file.name} · ${formatBytes(file.size)}`,
      },
    ]);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("focus", focus);
      const response = await fetch("/api/pitch-research", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as {
        card?: AssistantPitchResearchCard;
        skipped?: number;
        error?: string;
      };
      if (!response.ok || !data.card) {
        throw new Error(data.error || "Could not start the research.");
      }
      const card = data.card;
      const skipped = data.skipped
        ? ` ${data.skipped} more were skipped (the limit is ${card.total} per list).`
        : "";
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Researching **${card.total}** ${card.total === 1 ? "company" : "companies"} from **${file.name}**. Results fill in below as each one finishes.${skipped}`,
          cards: [card],
        },
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "Could not start the research.",
        },
      ]);
    } finally {
      setUploading(false);
    }
  }

  async function startUpload(file: File, prompt: string) {
    if (uploading || thinking) {
      return;
    }
    speech.stop();
    setError("");
    setAttachedFile(null);
    setDraft("");
    setPendingFile(file);
    setPendingPrompt(prompt);
    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: prompt || `Upload ${file.name}`,
        attachment: `${file.name} · ${formatBytes(file.size)}`,
      },
    ]);
    setUploading(true);
    try {
      const response = await fetch("/api/edm/buckets");
      const data = (await response.json().catch(() => ({}))) as {
        buckets?: UploadBucket[];
        projectName?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not list buckets.");
      }
      const buckets = Array.isArray(data.buckets) ? data.buckets : [];
      const project = data.projectName || projectName || "this project";
      setMessages((current) => [
        ...current,
        buckets.length
          ? { role: "assistant", content: `Which ${project} bucket should **${file.name}** upload to?`, buckets }
          : { role: "assistant", content: `No S3 buckets match **${project}**, so I can't upload this file.` },
      ]);
      if (!buckets.length) {
        setPendingFile(null);
      }
    } catch (err) {
      setPendingFile(null);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: err instanceof Error ? err.message : "Could not list buckets." },
      ]);
    } finally {
      setUploading(false);
    }
  }

  async function uploadToBucket(index: number, bucket: UploadBucket) {
    const file = pendingFile;
    if (!file || uploading) {
      return;
    }
    const picker = messages[index];
    setUploading(true);
    setMessages((current) =>
      current.map((message, position) =>
        position === index
          ? { role: "assistant", content: `Uploading **${file.name}** to **${bucket.name}**…` }
          : message,
      ),
    );
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("bucket", bucket.name);
      const response = await fetch("/api/assistant/upload", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Upload failed.");
      }
      const url = data.url;
      const prompt = pendingPrompt;
      setPendingFile(null);
      setPendingPrompt("");
      const updated: ChatMessage[] = messages.map((message, position) =>
        position === index
          ? {
              role: "assistant",
              content: `Uploaded **${file.name}** to **${bucket.name}**.\n\n[${url}](${url})`,
              uploadUrl: url,
            }
          : message,
      );
      setMessages(updated);
      if (prompt) {
        setUploading(false);
        await requestReply(
          updated,
          `${prompt}\n\nI just uploaded the file "${file.name}" to the S3 bucket ${bucket.name}. Its public link is ${url}`,
        );
      }
    } catch (err) {
      setMessages((current) =>
        current.map((message, position) =>
          position === index
            ? {
                ...picker,
                content: `${err instanceof Error ? err.message : "Upload failed."} Pick a bucket to try again.`,
              }
            : message,
        ),
      );
    } finally {
      setUploading(false);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl((current) => (current === url ? "" : current)), 1800);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  function retry() {
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      void ask(last.content, messages.slice(0, -1));
    }
  }

  const markdown: Components = {
    a: ({ href = "", children }) =>
      href.startsWith("/") ? (
        <Link href={href} onClick={() => setOpen(false)}>
          {children}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    table: ({ children }) => (
      <AssistantMarkdownTable>{children}</AssistantMarkdownTable>
    ),
  };

  const DISMISS_RADIUS = 72;
  const DRAG_THRESHOLD = 8;

  const isOverDismissZone = useCallback((clientX: number, clientY: number) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    return Math.hypot(dx, dy) <= DISMISS_RADIUS;
  }, []);

  function onLauncherPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }
    const wrap = launcherWrapRef.current;
    if (!wrap) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
      overDismiss: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onLauncherPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      setOpen(false);
    }
    const nextOver = isOverDismissZone(event.clientX, event.clientY);
    drag.overDismiss = nextOver;
    setOverDismiss(nextOver);
    setDragPos({
      x: drag.originLeft + dx,
      y: drag.originTop + dy,
    });
  }

  function endLauncherPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    if (drag.moved) {
      if (drag.overDismiss || isOverDismissZone(event.clientX, event.clientY)) {
        setLauncherHidden(true);
        setOpen(false);
      }
      setDragging(false);
      setOverDismiss(false);
      setDragPos(null);
      return;
    }
    setDragging(false);
    setOverDismiss(false);
    setDragPos(null);
    setOpen((value) => !value);
  }

  if (launcherHidden && !open) {
    return null;
  }

  const launcherStyle: CSSProperties | undefined = dragPos
    ? {
        left: dragPos.x,
        top: dragPos.y,
        right: "auto",
        bottom: "auto",
      }
    : undefined;

  return (
    <>
      {dragging ? (
        <div
          className={`pa-dismiss-scrim${overDismiss ? " is-hot" : ""}`}
          aria-hidden="true"
        >
          <div className={`pa-dismiss-zone${overDismiss ? " is-hot" : ""}`}>
            <span className="pa-dismiss-ring" />
            <span className="pa-dismiss-ring is-outer" />
            <span className="pa-dismiss-core">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </span>
            <span className="pa-dismiss-label">
              {overDismiss ? "Release to hide" : "Drag here to hide"}
            </span>
          </div>
        </div>
      ) : null}

      {!launcherHidden ? (
        <div
          ref={launcherWrapRef}
          className={`pa-launcher-wrap${open ? " is-open" : ""}${
            dragging ? " is-dragging" : ""
          }${overDismiss ? " is-over-dismiss" : ""}`}
          style={launcherStyle}
        >
          <button
            type="button"
            className={`pa-launcher${open ? " is-open" : ""}`}
            aria-label={open ? "Close assistant" : "Open assistant"}
            title="Ask the assistant · drag to center to hide"
            onPointerDown={onLauncherPointerDown}
            onPointerMove={onLauncherPointerMove}
            onPointerUp={endLauncherPointer}
            onPointerCancel={endLauncherPointer}
          >
            <BotIcon size={64} />
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="pa-backdrop" onClick={() => setOpen(false)}>
          <div
            className="pa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pa-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pa-head">
              <span className="pa-avatar">
                <BotIcon size={34} />
              </span>
              <div className="pa-head-text">
                <h3 id="pa-title">Portal assistant</h3>
                <p>Ask anything about {projectName || "your project"}</p>
              </div>
              {messages.length > 0 ? (
                <button
                  type="button"
                  className="pa-head-btn"
                  onClick={() => {
                    setMessages([]);
                    setError("");
                  }}
                  disabled={thinking}
                  aria-label="New chat"
                  title="New chat"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="pa-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className="pa-body" ref={listRef}>
              {messages.length === 0 ? (
                <div className="pa-empty">
                  <span className="pa-empty-icon">
                    <BotIcon size={64} />
                  </span>
                  <h4>How can I help?</h4>
                  <p>
                    I can look up your campaigns, results, contacts, lists, senders and
                    inbox replies, find people in the Enrich database, research companies
                    and write custom pitches, and explain how to do things in the portal.
                  </p>
                  <div className="pa-suggestions">
                    {SUGGESTIONS.map((item) => (
                      <button key={item} type="button" onClick={() => void ask(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message, index) =>
                  message.role === "user" ? (
                    <div key={index} className="pa-msg pa-msg-user">
                      {message.attachment ? (
                        <span className="pa-msg-file">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          {message.attachment}
                        </span>
                      ) : null}
                      {message.content}
                    </div>
                  ) : (
                    <div key={index} className="pa-msg pa-msg-bot">
                      <span className="pa-avatar pa-avatar-sm">
                        <BotIcon size={24} />
                      </span>
                      <div className="pa-md">
                        <AssistantMarkdownBody
                          content={message.content}
                          components={markdown}
                        />
                        {message.cards?.map((card, cardIndex) =>
                          card.kind === "pitch-research" ? (
                            <PortalPitchResearchCard key={card.jobId} card={card} />
                          ) : (
                            <PortalPeopleSearchCard
                              key={cardIndex}
                              card={card}
                              onOpen={() => setOpen(false)}
                            />
                          ),
                        )}
                        {csvRequested(messages, index) &&
                        extractTables(message.content).length > 0 ? (
                          <button
                            type="button"
                            className="pa-download"
                            onClick={() => downloadTablesCsv(stripCsvMarker(message.content))}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 3v12" />
                              <path d="m7 10 5 5 5-5" />
                              <path d="M5 21h14" />
                            </svg>
                            Download CSV
                          </button>
                        ) : null}
                        {message.buckets?.length ? (
                          <div className="pa-buckets">
                            {message.buckets.map((bucket) => (
                              <button
                                key={bucket.name}
                                type="button"
                                className="pa-bucket"
                                disabled={uploading || !pendingFile}
                                onClick={() => void uploadToBucket(index, bucket)}
                                title={`${bucket.name} (${bucket.region})`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5Z" />
                                  <ellipse cx="12" cy="7" rx="8" ry="3" />
                                </svg>
                                {bucket.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {message.uploadUrl ? (
                          <button
                            type="button"
                            className="pa-download"
                            onClick={() => void copyUrl(message.uploadUrl!)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="12" height="12" rx="2" />
                              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                            </svg>
                            {copiedUrl === message.uploadUrl ? "Copied" : "Copy link"}
                          </button>
                        ) : null}
                        {message.content.includes(UPLOAD_MARKER) ? (
                          <button
                            type="button"
                            className="pa-download"
                            onClick={openFilePicker}
                            disabled={uploading}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 21V9" />
                              <path d="m7 14 5-5 5 5" />
                              <path d="M5 3h14" />
                            </svg>
                            Upload file
                          </button>
                        ) : null}
                        {message.content.includes(PITCH_RESEARCH_MARKER) ? (
                          <button
                            type="button"
                            className="pa-download"
                            onClick={() => pitchInputRef.current?.click()}
                            disabled={uploading || thinking}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 21V9" />
                              <path d="m7 14 5-5 5 5" />
                              <path d="M5 3h14" />
                            </svg>
                            Upload company list
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ),
                )
              )}
              {thinking || uploading ? (
                <div className="pa-msg pa-msg-bot">
                  <span className="pa-avatar pa-avatar-sm">
                    <BotIcon size={24} />
                  </span>
                  <div className="pa-typing" aria-label="Thinking">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              ) : null}
              {error ? (
                <div className="pa-error">
                  {error}
                  <button type="button" onClick={retry}>
                    Try again
                  </button>
                </div>
              ) : null}
            </div>

            {attachedFile ? (
              <div className="pa-attached">
                <span className="pa-attached-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </span>
                <span className="pa-attached-text">
                  <strong title={attachedFile.name}>{attachedFile.name}</strong>
                  <em>{formatBytes(attachedFile.size)} · File selected — send to choose a bucket</em>
                </span>
                <button
                  type="button"
                  className="pa-attached-remove"
                  onClick={() => setAttachedFile(null)}
                  aria-label={`Remove ${attachedFile.name}`}
                  title="Remove file"
                >
                  ×
                </button>
              </div>
            ) : null}
            <form
              className="pa-input"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                placeholder={
                  speech.listening
                    ? "Listening… speak now"
                    : attachedFile
                      ? "Add a message (optional), then press Enter to upload"
                      : "Ask about campaigns, results, contacts…"
                }
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                disabled={thinking}
              />
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(event) => {
                  onFilePicked(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <input
                ref={pitchInputRef}
                type="file"
                accept={PITCH_RESEARCH_ACCEPT}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void startPitchResearch(file);
                }}
              />
              <button
                type="button"
                className="pa-mic"
                onClick={openFilePicker}
                disabled={thinking || uploading}
                aria-label="Upload a file"
                title="Upload a file to S3 and get a link"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                </svg>
              </button>
              {speech.supported ? (
                <button
                  type="button"
                  className={`pa-mic${speech.listening ? " is-listening" : ""}`}
                  onClick={speech.toggle}
                  disabled={thinking}
                  aria-pressed={speech.listening}
                  aria-label={speech.listening ? "Stop speaking" : "Speak"}
                  title={speech.listening ? "Stop speaking" : "Speak instead of typing"}
                >
                  {speech.listening ? (
                    <span className="pa-mic-wave" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <path d="M12 17v4" />
                      <path d="M8 21h8" />
                    </svg>
                  )}
                </button>
              ) : null}
              <button
                type="submit"
                className="pa-send"
                disabled={thinking || uploading || (!draft.trim() && !attachedFile)}
                aria-label="Send"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22l-4-9-9-4Z" />
                </svg>
              </button>
            </form>
            {speech.error ? <p className="pa-mic-error">{speech.error}</p> : null}
            <p className="pa-hint">Enter to send · Shift + Enter for a new line · Answers use live project data</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
