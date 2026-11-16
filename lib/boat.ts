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
  /** True when the saved disk was gone and this call created a blank desktop. */
  replacedDeletedDisk?: boolean;
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
  sandboxId?: string;
  /** Separate desktop for LinkedIn. Email and Cloud Campaign stay on sandboxId. */
  linkedinSandboxId?: string;
  createdAt: Date;
  updatedAt: Date;
  promptId?: string;
  conversationId?: string | null;
  /** Last ensure/run/tick — used to idle-stop after BOAT_IDLE_STOP_MS. */
  lastBoatActivityAt?: Date;
  /** Last time we asked Boat to refresh the project's saved snapshot (sender logins backup). */
  snapshotRequestedAt?: Date;
  /** Set when the email computer was rebuilt from the saved snapshot. */
  restoredFromSnapshotAt?: Date;
};

/** Stop running VMs with no activity for this long (when not campaign-locked). */
export const BOAT_IDLE_STOP_MS = 30 * 60 * 1000;

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

/** Boat keeps a stopped disk for about 14 days, then resume fails while the id still exists. */
function sandboxDiskGone(error: unknown) {
  if (!(error instanceof BoatError)) return false;
  if (error.status === 404 || error.code === "not_found") return true;
  const text = `${error.code} ${error.message}`.toLowerCase();
  return text.includes("data was deleted") || text.includes("deleted after");
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

async function createBoatSandbox(from?: string) {
  return readSandbox(
    await boatFetch("/sandboxes", {
      method: "POST",
      body: JSON.stringify({ type: "default", ttlSeconds: 3600, ...(from ? { from } : {}) }),
    }),
  );
}

/* ---------------------------------------------------------------------------------------------
 * Saved snapshot ("computer memory"): Boat deletes a stopped computer's disk after ~14 days,
 * which loses the sender Chrome profiles and their Gmail/Outlook logins. A saved snapshot never
 * expires, so we keep one rolling copy per project and rebuild from it when the disk is gone.
 * ------------------------------------------------------------------------------------------- */

export function projectSnapshotName(projectId: ObjectId) {
  return `nx-${projectId.toHexString()}-email`;
}

export type ProjectSnapshotInfo = {
  name: string;
  status: "saving" | "ready" | "failed" | "none";
  createdAt?: string;
  sizeBytes?: number;
  error?: string;
};

export async function getProjectSnapshot(projectId: ObjectId): Promise<ProjectSnapshotInfo> {
  const name = projectSnapshotName(projectId);
  try {
    const data = (await boatFetch(`/saved-snapshots/${encodeURIComponent(name)}`)) as Record<string, unknown>;
    const snap = (data?.snapshot ?? {}) as Record<string, unknown>;
    const status = snap.status === "ready" || snap.status === "saving" || snap.status === "failed" ? snap.status : "none";
    return {
      name,
      status,
      createdAt: typeof snap.createdAt === "string" ? snap.createdAt : undefined,
      sizeBytes: typeof snap.sizeBytes === "number" ? snap.sizeBytes : undefined,
      error: typeof snap.error === "string" ? snap.error : undefined,
    };
  } catch (error) {
    if (error instanceof BoatError && error.status === 404) return { name, status: "none" };
    throw error;
  }
}

/**
 * Refresh the project's saved snapshot from its email computer (running or stopped).
 * Throttled unless forced; a save already in progress counts as success.
 */
export async function saveProjectSnapshot(
  projectId: ObjectId,
  options: { force?: boolean; minIntervalMs?: number } = {},
) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.sandboxId) return { saved: false as const, reason: "no_computer" as const };
  const minInterval = options.minIntervalMs ?? 6 * 60 * 60 * 1000;
  if (
    !options.force &&
    saved.snapshotRequestedAt &&
    Date.now() - saved.snapshotRequestedAt.getTime() < minInterval
  ) {
    return { saved: false as const, reason: "recent" as const };
  }
  try {
    await boatFetch("/saved-snapshots", {
      method: "POST",
      body: JSON.stringify({ sandboxId: saved.sandboxId, name: projectSnapshotName(projectId) }),
    });
  } catch (error) {
    if (!(error instanceof BoatError && error.code === "save_in_progress")) throw error;
  }
  await collection.updateOne({ projectId }, { $set: { snapshotRequestedAt: new Date() } });
  return { saved: true as const };
}

/** Fire-and-forget backup; never blocks or fails the caller. */
export function backupProjectSoon(projectId: ObjectId, force = false) {
  void saveProjectSnapshot(projectId, { force }).catch((error) => {
    console.warn("Saved snapshot failed:", error instanceof Error ? error.message : error);
  });
}

export async function getProjectBackupMeta(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  return {
    snapshotRequestedAt: saved?.snapshotRequestedAt?.toISOString(),
    restoredFromSnapshotAt: saved?.restoredFromSnapshotAt?.toISOString(),
  };
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

/** States where we should keep polling after resume/start (not terminal failure). */
const WAITING_STATES = new Set([
  ...STARTING_STATES,
  "archiving",
  "archived",
  "stopping",
  "stopped",
  "resuming",
  "starting",
  "unknown",
]);

export async function waitForBoat(sandboxId: string, attempts = 20) {
  let sandbox = await getBoatSandbox(sandboxId);
  for (let attempt = 0; attempt < attempts && !isBoatRunning(sandbox.state); attempt += 1) {
    // Permanent failures — stop waiting. Otherwise keep polling through resume-from-archive.
    if (!WAITING_STATES.has(sandbox.state)) {
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
  if (isBoatRunning(sandbox.state)) {
    return sandbox;
  }
  if (sandbox.state === "cancelled" || sandbox.state === "deleted") {
    throw new BoatError("This computer was removed", 404, "not_found");
  }
  if (/data was deleted|deleted after/i.test(sandbox.error ?? "")) {
    throw new BoatError(sandbox.error || "This sandbox's data was deleted.", 410, "sandbox_deleted");
  }
  if (
    sandbox.state === "archived" ||
    sandbox.state === "error" ||
    sandbox.state === "stopped" ||
    sandbox.state === "stopping"
  ) {
    await resumeBoatSandbox(sandboxId);
  }
  return waitForBoat(sandboxId);
}

export async function stampBoatActivity(projectId: ObjectId) {
  const collection = await boatLinks();
  const now = new Date();
  await collection.updateOne(
    { projectId },
    { $set: { lastBoatActivityAt: now, updatedAt: now } },
  );
}

/** Stop this project's VM if it is currently running (disk is kept). */
export async function stopProjectBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.sandboxId) {
    return { stopped: false as const, reason: "none" as const };
  }
  try {
    const sandbox = await getBoatSandbox(saved.sandboxId);
    if (
      sandbox.state === "archived" ||
      sandbox.state === "archiving" ||
      sandbox.state === "stopped" ||
      sandbox.state === "stopping" ||
      sandbox.state === "cancelled" ||
      sandbox.state === "deleted"
    ) {
      return {
        stopped: false as const,
        reason: "already_stopped" as const,
        sandboxId: sandbox.id,
        state: sandbox.state,
      };
    }
    if (!isBoatRunning(sandbox.state) && !STARTING_STATES.has(sandbox.state)) {
      return {
        stopped: false as const,
        reason: "not_running" as const,
        sandboxId: sandbox.id,
        state: sandbox.state,
      };
    }
    await stopBoatSandbox(sandbox.id);
    return {
      stopped: true as const,
      sandboxId: sandbox.id,
      state: "archiving" as const,
    };
  } catch (error) {
    if (error instanceof BoatError && (error.status === 404 || sandboxDiskGone(error))) {
      return { stopped: false as const, reason: "gone" as const };
    }
    throw error;
  }
}

/**
 * Stop if last activity is older than BOAT_IDLE_STOP_MS.
 * Caller must skip when a campaign holds boat_desktop_locks.
 */
export async function maybeStopIdleProjectBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.sandboxId) {
    return { stopped: false as const, reason: "none" as const };
  }
  const last = saved.lastBoatActivityAt;
  if (!last) {
    return { stopped: false as const, reason: "no_activity" as const };
  }
  if (Date.now() - last.getTime() < BOAT_IDLE_STOP_MS) {
    return { stopped: false as const, reason: "active" as const };
  }
  return stopProjectBoat(projectId);
}

export async function getBoatActivityMeta(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  return {
    sandboxId: saved?.sandboxId || null,
    lastBoatActivityAt: saved?.lastBoatActivityAt
      ? saved.lastBoatActivityAt.toISOString()
      : null,
  };
}

/** One Boat computer per project. Resumes the saved disk, or creates a blank one when that disk is gone. */
export async function ensureProjectBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  let replacedDeletedDisk = false;
  if (saved?.sandboxId) {
    try {
      const sandbox = await reviveBoat(saved.sandboxId);
      await stampBoatActivity(projectId);
      return sandbox;
    } catch (error) {
      if (!sandboxDiskGone(error)) {
        throw error;
      }
      replacedDeletedDisk = true;
    }
  }

  // Disk gone (or first computer): rebuild from the saved snapshot when there is one, so the
  // sender Chromes and their logins come back instead of a blank desktop.
  let restoredFrom = "";
  if (replacedDeletedDisk || saved?.snapshotRequestedAt) {
    const snapshot = await getProjectSnapshot(projectId).catch(() => null);
    if (snapshot?.status === "ready") restoredFrom = snapshot.name;
  }
  let created: BoatSandbox;
  try {
    created = await createBoatSandbox(restoredFrom || undefined);
  } catch (error) {
    if (!restoredFrom) throw error;
    console.warn("Restore from saved snapshot failed; starting blank:", error);
    restoredFrom = "";
    created = await createBoatSandbox();
  }
  const now = new Date();
  await collection.updateOne(
    { projectId },
    {
      $set: {
        sandboxId: created.id,
        updatedAt: now,
        lastBoatActivityAt: now,
        ...(restoredFrom ? { restoredFromSnapshotAt: now } : {}),
      },
      $unset: { promptId: "", conversationId: "" },
      $setOnInsert: { projectId, createdAt: now },
    },
    { upsert: true },
  );
  const ready = isBoatRunning(created.state) ? created : await waitForBoat(created.id);
  if (restoredFrom) return { ...ready, restoredFromSnapshot: true };
  return replacedDeletedDisk ? { ...ready, replacedDeletedDisk: true } : ready;
}

/** LinkedIn's own computer. Does not resume or replace the email computer. */
export async function ensureLinkedinBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (saved?.linkedinSandboxId) {
    try {
      return await reviveBoat(saved.linkedinSandboxId);
    } catch (error) {
      if (!sandboxDiskGone(error)) {
        throw error;
      }
    }
  }

  const created = await createBoatSandbox();
  await collection.updateOne(
    { projectId },
    {
      $set: { linkedinSandboxId: created.id, updatedAt: new Date() },
      $setOnInsert: { projectId, createdAt: new Date() },
    },
    { upsert: true },
  );
  const ready = isBoatRunning(created.state) ? created : await waitForBoat(created.id);
  return { ...ready, replacedDeletedDisk: true };
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
  /** Raise for commands that return data (e.g. a file read back in chunks). */
  stdoutMax = 6000,
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
    stdout: clip(typeof record.stdout === "string" ? record.stdout : "", stdoutMax),
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

/** Used for automated runner tasks that define their own reply format. */
/** Automated runner tasks: the task text carries everything, so no extra preface. */
const STRICT_TASK_PREFACE = "";

export type BoatTaskOptions = {
  /** Task defines its own reply format: no generic suffix, tighter preface. */
  strict?: boolean;
  /** When the watch window ends before the turn finishes, interrupt it. */
  interruptOnTimeout?: boolean;
};

function agentModelOptions() {
  const model = process.env.BOAT_AGENT_MODEL?.trim();
  const reasoningEffort = process.env.BOAT_AGENT_EFFORT?.trim();
  return {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

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
  strict = false,
) {
  const prompt = strict
    ? `${STRICT_TASK_PREFACE}${task.trim()}`
    : `${DESKTOP_TASK_PREFACE}${task.trim()}\n\nWhen you finish, report the rows you read, who you emailed, and any row that failed.`;
  let lastError: unknown;
  for (const provider of agentProviders()) {
    try {
      const data = await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          provider,
          prompt,
          ...agentModelOptions(),
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

export async function getBoatTaskReport(sandboxId: string, promptId: string) {
  const run = await getBoatPrompt(sandboxId, promptId);
  const report = await latestAgentReport(sandboxId, run.conversationId);
  return { ...run, report };
}

/** What the agent actually did (tool calls), for diagnosing turns that never produced text. */
export type BoatAgentActivity = { responses: number; toolCalls: number; lastTool: string };

async function latestAgentReport(
  sandboxId: string,
  conversationId: string | null,
  activity?: BoatAgentActivity,
) {
  // Only agent text: "prompt" events echo our own task (and its "STATUS: sent OR failed" template).
  const params = new URLSearchParams({ sort: "asc", type: "response" });
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
    const eventType = (event as { type?: unknown }).type;
    if (typeof eventType === "string" && eventType !== "response") continue;
    const payload = (event as { data?: unknown }).data;
    const body =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    if (activity && body) {
      activity.responses += 1;
      const tools = Array.isArray(body.tools) ? body.tools : [];
      for (const tool of tools) {
        if (!tool || typeof tool !== "object") continue;
        const record = tool as Record<string, unknown>;
        const name = String(record.name ?? record.tool ?? record.tool_name ?? "");
        if (record.type === "tool_use" || name) {
          activity.toolCalls += 1;
          if (name) activity.lastTool = name;
        }
      }
    }
    if (!body || body.is_streaming === true) continue;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content) report = content;
  }
  return clip(report, 4000);
}

/** Stop a running agent turn (one conversation, or everything when null). */
export async function interruptBoatAgent(
  sandboxId: string,
  conversationId: string | null,
) {
  const query = conversationId
    ? `?conversation=${encodeURIComponent(conversationId)}`
    : "";
  await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/interrupt${query}`, {
    method: "POST",
  });
}

/** Queue the desktop agent, then wait for it to finish or for the watch window to end. */
export async function runBoatDesktopTask(
  sandboxId: string,
  task: string,
  conversationId: string | null,
  watchMs = 90_000,
  projectId?: ObjectId,
  options: BoatTaskOptions = {},
) {
  if (projectId) {
    await stampBoatActivity(projectId).catch(() => undefined);
  }
  let queued: Awaited<ReturnType<typeof queueBoatPrompt>>;
  try {
    queued = await queueBoatPrompt(sandboxId, task, conversationId, options.strict);
  } catch (error) {
    if (conversationId && error instanceof BoatError && error.status === 404) {
      return runBoatDesktopTask(sandboxId, task, null, watchMs, projectId, options);
    }
    throw error;
  }
  const started = Date.now();
  let current = queued;
  let timedOut = false;
  while (true) {
    if (Date.now() - started >= watchMs) {
      timedOut = true;
      break;
    }
    await sleep(2500);
    try {
      current = await getBoatPrompt(sandboxId, queued.promptId);
    } catch {
      timedOut = true;
      break;
    }
    if (current.done) break;
  }
  let interrupted = false;
  if (timedOut && !current.done && options.interruptOnTimeout) {
    // Never leave an orphaned agent burning credits (and racing the next prompt).
    await interruptBoatAgent(sandboxId, current.conversationId ?? queued.conversationId).then(
      () => {
        interrupted = true;
      },
      () => undefined,
    );
  }
  // Only read events once (the final answer) instead of on every poll.
  const activity: BoatAgentActivity = { responses: 0, toolCalls: 0, lastTool: "" };
  const report = await latestAgentReport(
    sandboxId,
    current.conversationId ?? queued.conversationId,
    activity,
  ).catch(() => "");
  return { ...current, report, timedOut, interrupted, activity };
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

export type BoatAiUsageTotals = {
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type BoatAiUsageRow = BoatAiUsageTotals & {
  day: string;
  credential: string;
  model: string;
};

export type BoatAiUsage = {
  sandboxId: string;
  blocked: boolean;
  proxied: boolean;
  since: string;
  usage: BoatAiUsageRow[];
  totals: BoatAiUsageTotals;
  /** Boat proxy fee for the window ($1 / 1k proxied requests), not Anthropic token $ */
  proxyDollars: number;
};

export type BoatMachineUsage = {
  sandboxId: string;
  since: string;
  until: string;
  seconds: number;
  dollars: number;
  running: boolean;
};

function readAiTotals(value: unknown): BoatAiUsageTotals {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    requests: Math.max(0, Number(record.requests) || 0),
    errors: Math.max(0, Number(record.errors) || 0),
    inputTokens: Math.max(0, Number(record.inputTokens) || 0),
    outputTokens: Math.max(0, Number(record.outputTokens) || 0),
    cacheReadTokens: Math.max(0, Number(record.cacheReadTokens) || 0),
    cacheWriteTokens: Math.max(0, Number(record.cacheWriteTokens) || 0),
  };
}

export async function getBoatAiUsage(sandboxId: string, days = 30): Promise<BoatAiUsage> {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days) || 30));
  const data = await boatFetch(
    `/sandboxes/${encodeURIComponent(sandboxId)}/ai-usage?days=${safeDays}`,
  );
  const record = (data ?? {}) as Record<string, unknown>;
  const usageRaw = Array.isArray(record.usage) ? record.usage : [];
  const usage: BoatAiUsageRow[] = usageRaw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      day: typeof row.day === "string" ? row.day : "",
      credential: typeof row.credential === "string" ? row.credential : "",
      model: typeof row.model === "string" ? row.model : "",
      ...readAiTotals(row),
    }));
  return {
    sandboxId: typeof record.sandboxId === "string" ? record.sandboxId : sandboxId,
    blocked: record.blocked === true,
    proxied: record.proxied === true,
    since: typeof record.since === "string" ? record.since : "",
    usage,
    totals: readAiTotals(record.totals),
    proxyDollars: Math.max(0, Number(record.dollars) || 0),
  };
}

export async function getBoatMachineUsage(
  sandboxId: string,
  sinceIso?: string,
): Promise<BoatMachineUsage> {
  const query = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
  const data = await boatFetch(
    `/sandboxes/${encodeURIComponent(sandboxId)}/usage${query}`,
  );
  const record = (data ?? {}) as Record<string, unknown>;
  return {
    sandboxId: typeof record.sandboxId === "string" ? record.sandboxId : sandboxId,
    since: typeof record.since === "string" ? record.since : "",
    until: typeof record.until === "string" ? record.until : "",
    seconds: Math.max(0, Number(record.seconds) || 0),
    dollars: Math.max(0, Number(record.dollars) || 0),
    running: record.running === true,
  };
}

/** Return the linked sandbox id without starting/creating a computer. */
export async function getSavedBoatSandboxId(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  return saved?.sandboxId || null;
}
