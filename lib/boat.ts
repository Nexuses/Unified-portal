import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

const BOAT_API_BASE = process.env.BOAT_API_BASE?.trim() || "https://boat.dev/api/v1";

const RUNNING_STATES = new Set(["ready", "idle", "running"]);
const STARTING_STATES = new Set(["init", "provisioning", "provisioned", "cloning"]);

export type BoatSandbox = {
  id: string;
  name: string;
  state: string;
  error: string | null;
};

export type BoatCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  detached: boolean;
  processId?: number;
};

type BoatLinkDoc = {
  projectId: ObjectId;
  sandboxId: string;
  createdAt: Date;
  updatedAt: Date;
  promptId?: string;
  conversationId?: string | null;
};

export class BoatError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BoatError";
    this.status = status;
    this.code = code;
  }
}

export function boatConfigured() {
  return Boolean(process.env.BOAT_API_KEY?.trim());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isBoatRunning(state: string) {
  return RUNNING_STATES.has(state);
}

async function boatFetch(path: string, init?: RequestInit) {
  const key = process.env.BOAT_API_KEY?.trim();
  if (!key) {
    throw new BoatError(
      "Boat is not set up. An admin needs to add BOAT_API_KEY to the server.",
      503,
      "not_configured",
    );
  }
  const response = await fetch(`${BOAT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const record = (data ?? {}) as {
      message?: string;
      code?: string;
      error?: { message?: string; code?: string };
    };
    throw new BoatError(
      record.error?.message || record.message || `Boat request failed (${response.status})`,
      response.status,
      record.error?.code || record.code || "boat_error",
    );
  }
  return data;
}

function readSandbox(data: unknown): BoatSandbox {
  const record = (data ?? {}) as Record<string, unknown>;
  const nested =
    record.sandbox && typeof record.sandbox === "object"
      ? (record.sandbox as Record<string, unknown>)
      : record;
  const id = typeof nested.id === "string" ? nested.id : "";
  if (!id) {
    throw new BoatError("Boat did not return a sandbox id", 502, "missing_sandbox");
  }
  return {
    id,
    name: typeof nested.name === "string" && nested.name.trim() ? nested.name : "LinkedIn computer",
    state: typeof nested.state === "string" ? nested.state : "unknown",
    error: typeof nested.error === "string" ? nested.error : null,
  };
}

export async function getBoatSandbox(sandboxId: string) {
  return readSandbox(await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}`));
}

async function createBoatSandbox() {
  return readSandbox(
    await boatFetch("/sandboxes", {
      method: "POST",
      body: JSON.stringify({ type: "default", ttlSeconds: 3600 }),
    }),
  );
}

async function resumeBoatSandbox(sandboxId: string) {
  await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/resume`, {
    method: "POST",
    body: "{}",
  });
}

export async function stopBoatSandbox(sandboxId: string) {
  await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/stop`, {
    method: "POST",
    body: "{}",
  });
}

export async function waitForBoat(sandboxId: string, attempts = 8) {
  let sandbox = await getBoatSandbox(sandboxId);
  for (let attempt = 0; attempt < attempts && !isBoatRunning(sandbox.state); attempt += 1) {
    if (!STARTING_STATES.has(sandbox.state) && sandbox.state !== "archiving") {
      break;
    }
    await sleep(2000);
    sandbox = await getBoatSandbox(sandboxId);
  }
  return sandbox;
}

let linksIndexed = false;

async function boatLinks() {
  const db = await getDb();
  const collection = db.collection<BoatLinkDoc>("boat_sandboxes");
  if (!linksIndexed) {
    await collection.createIndex({ projectId: 1 }, { unique: true });
    linksIndexed = true;
  }
  return collection;
}

async function reviveBoat(sandboxId: string) {
  const sandbox = await getBoatSandbox(sandboxId);
  if (sandbox.state === "cancelled") {
    throw new BoatError("This computer was removed", 404, "not_found");
  }
  if (isBoatRunning(sandbox.state)) {
    return sandbox;
  }
  if (sandbox.state === "archived" || sandbox.state === "error") {
    await resumeBoatSandbox(sandboxId);
  }
  return waitForBoat(sandboxId);
}

/** One Boat computer per project. Creates it, or resumes the saved disk. */
export async function ensureProjectBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (saved?.sandboxId) {
    try {
      return await reviveBoat(saved.sandboxId);
    } catch (error) {
      if (!(error instanceof BoatError) || error.status !== 404) {
        throw error;
      }
    }
  }

  const created = await createBoatSandbox();
  await collection.updateOne(
    { projectId },
    {
      $set: { sandboxId: created.id, updatedAt: new Date() },
      $setOnInsert: { projectId, createdAt: new Date() },
    },
    { upsert: true },
  );
  if (isBoatRunning(created.state)) {
    return created;
  }
  return waitForBoat(created.id);
}

export async function projectBoatStatus(projectId: ObjectId) {
  if (!boatConfigured()) {
    return { configured: false as const, sandbox: null };
  }
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.sandboxId) {
    return { configured: true as const, sandbox: null };
  }
  try {
    const sandbox = await getBoatSandbox(saved.sandboxId);
    return { configured: true as const, sandbox };
  } catch (error) {
    if (error instanceof BoatError && error.status === 404) {
      return { configured: true as const, sandbox: null };
    }
    throw error;
  }
}

function clip(value: string, max = 6000) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…truncated`;
}

export async function runBoatCommand(
  sandboxId: string,
  command: string,
  timeoutSeconds = 25,
) {
  const data = await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      command,
      timeoutSeconds: Math.min(90, Math.max(1, Math.floor(timeoutSeconds))),
    }),
  });
  const record = (data ?? {}) as Record<string, unknown>;
  if (record.type === "command.started" || typeof record.processId === "number") {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      detached: true,
      processId: typeof record.processId === "number" ? record.processId : undefined,
    } satisfies BoatCommandResult;
  }
  return {
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
    stdout: clip(typeof record.stdout === "string" ? record.stdout : ""),
    stderr: clip(typeof record.stderr === "string" ? record.stderr : "", 2000),
    timedOut: record.timedOut === true,
    detached: false,
  } satisfies BoatCommandResult;
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const DESKTOP_TASK_PREFACE = `You control this Linux desktop. The user is watching the screen.
Use the computer and browser tools. Look at what is already open before you ask anything.
Read spreadsheets, pages, and Gmail yourself. Click and type to finish the task.
Do not ask the user for columns, subjects, or account names that are already visible.

Task:
`;

function agentProviders() {
  const chosen = process.env.BOAT_AGENT_PROVIDER?.trim();
  if (chosen) return [chosen];
  return ["claude-code", "codex"];
}

export type BoatPromptRun = {
  promptId: string;
  conversationId: string | null;
  status: string;
  done: boolean;
  report: string;
};

function readPromptRun(data: unknown, fallbackPromptId: string): BoatPromptRun {
  const record = (data ?? {}) as Record<string, unknown>;
  const run =
    record.promptRun && typeof record.promptRun === "object"
      ? (record.promptRun as Record<string, unknown>)
      : record;
  const conversationId =
    typeof run.conversationId === "string"
      ? run.conversationId
      : typeof record.conversationId === "string"
        ? record.conversationId
        : null;
  return {
    promptId: String(run.promptId || record.promptId || fallbackPromptId),
    conversationId,
    status: typeof run.status === "string" ? run.status : typeof record.status === "string" ? record.status : "unknown",
    done: run.done === true || record.done === true,
    report: "",
  };
}

async function queueBoatPrompt(
  sandboxId: string,
  task: string,
  conversationId: string | null,
) {
  const prompt = `${DESKTOP_TASK_PREFACE}${task.trim()}\n\nWhen you finish, report the rows you read, who you emailed, and any row that failed.`;
  let lastError: unknown;
  for (const provider of agentProviders()) {
    try {
      const data = await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          provider,
          prompt,
          ...(conversationId ? { conversationId } : { new: true }),
        }),
      });
      return readPromptRun(data, "");
    } catch (error) {
      lastError = error;
      if (!(error instanceof BoatError) || error.code !== "provider_not_configured") {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new BoatError(
        "The desktop agent is not connected. In the Boat dashboard, open Agents and connect Claude or Codex.",
        409,
        "provider_not_configured",
      );
}

export async function getBoatPrompt(sandboxId: string, promptId: string) {
  const data = await boatFetch(
    `/sandboxes/${encodeURIComponent(sandboxId)}/prompts/${encodeURIComponent(promptId)}`,
  );
  return readPromptRun(data, promptId);
}

async function latestAgentReport(sandboxId: string, conversationId: string | null) {
  const params = new URLSearchParams({ sort: "asc" });
  if (conversationId) params.set("conversation", conversationId);
  const data = await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/events?${params}`);
  const record = (data ?? {}) as Record<string, unknown>;
  const events = Array.isArray(record.events)
    ? record.events
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(data)
        ? data
        : [];
  let report = "";
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const payload = (event as { data?: unknown }).data;
    const body =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    if (!body || body.is_streaming === true) continue;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content) report = content;
  }
  return clip(report, 4000);
}

/** Queue the desktop agent, then wait for it to finish or for the watch window to end. */
export async function runBoatDesktopTask(
  sandboxId: string,
  task: string,
  conversationId: string | null,
  watchMs = 90_000,
) {
  let queued: Awaited<ReturnType<typeof queueBoatPrompt>>;
  try {
    queued = await queueBoatPrompt(sandboxId, task, conversationId);
  } catch (error) {
    if (conversationId && error instanceof BoatError && error.status === 404) {
      return runBoatDesktopTask(sandboxId, task, null, watchMs);
    }
    throw error;
  }
  const started = Date.now();
  let current = queued;
  let report = "";
  while (Date.now() - started < watchMs) {
    await sleep(3000);
    try {
      current = await getBoatPrompt(sandboxId, queued.promptId);
    } catch {
      break;
    }
    report = await latestAgentReport(sandboxId, current.conversationId).catch(() => report);
    if (current.done) break;
  }
  return { ...current, report };
}

export async function rememberBoatTask(
  projectId: ObjectId,
  promptId: string,
  conversationId: string | null,
) {
  const collection = await boatLinks();
  await collection.updateOne(
    { projectId },
    { $set: { promptId, conversationId, updatedAt: new Date() } },
  );
}

export async function refreshBoatTask(
  sandboxId: string,
  promptId: string,
  conversationId: string | null,
) {
  const current = await getBoatPrompt(sandboxId, promptId);
  const report = await latestAgentReport(
    sandboxId,
    current.conversationId || conversationId,
  ).catch(() => "");
  return { ...current, report };
}

export async function savedBoatTask(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.sandboxId || !saved.promptId) return null;
  return {
    sandboxId: saved.sandboxId,
    promptId: saved.promptId,
    conversationId: saved.conversationId ?? null,
  };
}

export async function openBoatDesktop(sandboxId: string) {
  const data = await boatFetch(
    `/sandboxes/${encodeURIComponent(sandboxId)}/desktop?theme=light`,
    { method: "POST" },
  );
  const record = (data ?? {}) as Record<string, unknown>;
  const url = record.desktopUrl ?? record.viewerUrl ?? record.url;
  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new BoatError("Boat did not return a desktop URL", 502, "missing_desktop");
  }
  return url;
}
