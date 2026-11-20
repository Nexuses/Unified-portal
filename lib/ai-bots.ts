import type { AssistantCard } from "@/lib/assistant";

/**
 * AI Bots: a roster of chat bots per project (like contacts in a messaging app). Each bot has its own name,
 * look, personality and brain. The "portal" brain is the portal assistant on our API keys; the others are
 * coding agents on the project's Boat computer, signed in with our company's AI subscriptions on Boat.
 */
export type BotEngine = "portal" | "chatgpt" | "grok" | "claude";

export type BotModelOption = { engine: BotEngine; model: string; label: string; note: string };

export const BOT_ENGINES: Record<BotEngine, { label: string; short: string; runsOnComputer: boolean; blurb: string }> = {
  portal: {
    label: "Portal AI",
    short: "PA",
    runsOnComputer: false,
    blurb: "Fast answers from your portal data. Uses the portal's API credits.",
  },
  chatgpt: {
    label: "ChatGPT",
    short: "GP",
    runsOnComputer: true,
    blurb: "Codex runs on the bot's computer, on the ChatGPT plan connected in AI accounts.",
  },
  grok: {
    label: "Grok",
    short: "GR",
    runsOnComputer: true,
    blurb: "Grok Build runs on the bot's computer, on the SuperGrok plan connected in AI accounts.",
  },
  claude: {
    label: "Claude",
    short: "CL",
    runsOnComputer: true,
    blurb: "Claude Code on the bot's computer, through the company's Boat account.",
  },
};

/** "" means the engine's own default model. */
export const BOT_MODELS: BotModelOption[] = [
  { engine: "portal", model: "", label: "Portal AI", note: "Default" },
  { engine: "chatgpt", model: "", label: "ChatGPT", note: "Default model" },
  { engine: "grok", model: "", label: "Grok", note: "Default model" },
  { engine: "grok", model: "grok-4.6", label: "Grok 4.6", note: "" },
  { engine: "grok", model: "grok-4.5", label: "Grok 4.5", note: "" },
  { engine: "claude", model: "", label: "Claude", note: "Default model" },
];

export function modelLabel(engine: BotEngine, model: string) {
  return (
    BOT_MODELS.find((option) => option.engine === engine && option.model === model)?.label ||
    (model ? `${BOT_ENGINES[engine].label} · ${model}` : BOT_ENGINES[engine].label)
  );
}

export const BOT_COLORS = [
  "#0b996e",
  "#3b82f6",
  "#e0523f",
  "#f08c2e",
  "#8b5cf6",
  "#0ea5c6",
  "#e0489a",
  "#d4a017",
  "#14a89b",
  "#ef6a54",
] as const;

export type Bot = {
  id: string;
  name: string;
  color: string;
  /** One emoji, or "" to show the first letter. */
  emoji: string;
  instructions: string;
  engine: BotEngine;
  model: string;
  /** Runs on its own Boat computer instead of the project's shared one. */
  ownComputer: boolean;
  pinned: boolean;
  isChief: boolean;
  createdAt: string;
  lastMessageAt: string | null;
  lastPreview: string;
  unread: number;
  running: boolean;
};

export type BotFile = { path: string; name: string; size: number };

export type BotMessage = {
  id: string;
  role: "user" | "bot";
  content: string;
  status: "done" | "running" | "error";
  authorName: string;
  /** Where a message came from when a person did not type it. */
  source?: "routine" | "handoff";
  cards?: AssistantCard[];
  files?: BotFile[];
  error?: string;
  createdAt: string;
};

export type BotRoutine = {
  id: string;
  botId: string;
  title: string;
  prompt: string;
  /** "daily" at hh:mm in the timezone, or "hours" every N hours. */
  kind: "daily" | "hours";
  time: string;
  everyHours: number;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

export type BotComputerInfo = {
  sandboxId: string | null;
  state: string;
  running: boolean;
  shared: boolean;
  desktopUrl?: string;
};

export type BotDraft = Partial<
  Pick<Bot, "name" | "color" | "emoji" | "instructions" | "engine" | "model" | "ownComputer" | "pinned">
>;

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchBots() {
  return readJson<{ bots: Bot[]; computerReady: boolean }>(await fetch("/api/bots", { cache: "no-store" }));
}

export async function createBot(draft: BotDraft & { duplicateOf?: string }) {
  return readJson<{ bot: Bot }>(await fetch("/api/bots", json(draft)));
}

export async function updateBot(id: string, draft: BotDraft) {
  return readJson<{ bot: Bot }>(await fetch(`/api/bots/${encodeURIComponent(id)}`, json(draft, "PATCH")));
}

export async function deleteBot(id: string) {
  return readJson<{ ok: true }>(await fetch(`/api/bots/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function fetchBotMessages(id: string) {
  return readJson<{ messages: BotMessage[] }>(
    await fetch(`/api/bots/${encodeURIComponent(id)}/messages`, { cache: "no-store" }),
  );
}

export async function sendBotMessage(id: string, content: string) {
  return readJson<{ messages: BotMessage[] }>(
    await fetch(`/api/bots/${encodeURIComponent(id)}/messages`, json({ content })),
  );
}

export async function clearBotChat(id: string) {
  return readJson<{ ok: true }>(
    await fetch(`/api/bots/${encodeURIComponent(id)}/messages`, { method: "DELETE" }),
  );
}

export async function botComputer(id: string, action: "status" | "start" | "desktop" | "stop") {
  return readJson<{ computer: BotComputerInfo }>(
    await fetch(`/api/bots/${encodeURIComponent(id)}/computer`, json({ action })),
  );
}

export function botFileUrl(id: string, path: string) {
  return `/api/bots/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`;
}

export async function fetchRoutines() {
  return readJson<{ routines: BotRoutine[] }>(await fetch("/api/bots/routines", { cache: "no-store" }));
}

export async function saveRoutine(routine: Partial<BotRoutine> & { botId: string }) {
  return readJson<{ routine: BotRoutine }>(
    await fetch(
      routine.id ? `/api/bots/routines/${encodeURIComponent(routine.id)}` : "/api/bots/routines",
      json(routine, routine.id ? "PATCH" : "POST"),
    ),
  );
}

export async function deleteRoutine(id: string) {
  return readJson<{ ok: true }>(
    await fetch(`/api/bots/routines/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}

export async function runRoutineNow(id: string) {
  return readJson<{ ok: true }>(
    await fetch(`/api/bots/routines/${encodeURIComponent(id)}`, json({ runNow: true }, "PATCH")),
  );
}

/* ---- Connected apps (Composio) ---- */

export type ConnectedApp = {
  slug: string;
  name: string;
  logo: string;
  description: string;
  connected: boolean;
  accountId: string | null;
};

export async function fetchApps() {
  return readJson<{ configured: boolean; apps: ConnectedApp[] }>(await fetch("/api/bots/apps", { cache: "no-store" }));
}

export async function connectApp(toolkit: string) {
  return readJson<{ url: string }>(await fetch("/api/bots/apps", json({ action: "connect", toolkit })));
}

export async function disconnectApp(accountId: string) {
  return readJson<{ ok: true }>(await fetch("/api/bots/apps", json({ action: "disconnect", accountId })));
}

/* ---- AI subscription sign-ins (ChatGPT plan, SuperGrok plan) ---- */

export type AiLoginProvider = "chatgpt" | "grok";

export type AiLogin = {
  provider: AiLoginProvider;
  label: string;
  plan: string;
  state: "none" | "pending" | "connected" | "error";
  /** While pending: where to approve, and the code to enter there. */
  url?: string;
  code?: string;
  expiresAt?: string;
  connectedAt?: string;
  error?: string;
};

export async function fetchLogins() {
  return readJson<{ configured: boolean; logins: AiLogin[] }>(await fetch("/api/bots/logins", { cache: "no-store" }));
}

export async function loginAction(provider: AiLoginProvider, action: "connect" | "cancel" | "disconnect") {
  return readJson<{ logins: AiLogin[] }>(await fetch("/api/bots/logins", json({ action, provider })));
}
