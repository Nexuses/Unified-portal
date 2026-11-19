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
  /** When Boat last changed this computer (ISO). */
  updatedAt?: string;
  /** A stop Boat accepted but has not carried out yet: when it was asked for (ISO). */
  stopPendingSince?: string;
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
  /** LinkedIn's own computer. Email and Cloud Campaign stay on sandboxId. */
  linkedinSandboxId?: string;
  createdAt: Date;
  updatedAt: Date;
  promptId?: string;
  conversationId?: string | null;
  /** Last ensure/run/tick — used to idle-stop after BOAT_IDLE_STOP_MS. */
  lastBoatActivityAt?: Date;
  /** Last time we asked Boat to refresh the project's saved snapshot (sender logins backup). */
  snapshotRequestedAt?: Date;
  /** Set when the cloud computer was rebuilt from the saved snapshot. */
  restoredFromSnapshotAt?: Date;
  /** Cloud campaigns' own computer (separate from the assistant's `sandboxId`). */
  cloudSandboxId?: string;
  /** Every cloud computer this project has had (for exact per-project cost). */
  cloudSandboxIds?: string[];
  cloudActivityAt?: Date;
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

const TRANSIENT_BOAT_MESSAGE =
  /boat request failed \((500|502|503|504)\)|briefly unavailable|did not respond|internal error|fetch failed|econnreset|etimedout|socket hang up|bad gateway|gateway time-?out/i;

/**
 * A short Boat outage (gateway 502/503/504 or a dropped connection), not a real problem with
 * the computer or the sender. Worth waiting a few minutes and trying again.
 */
export function isTransientBoatError(error: unknown) {
  if (error instanceof BoatError) {
    return [500, 502, 503, 504].includes(error.status) || error.code === "boat_unreachable";
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return TRANSIENT_BOAT_MESSAGE.test(message);
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

/** What the person needs to know about a computer, from Boat's many state names. */
export type BoatPhase = "running" | "starting" | "stopping" | "stopped" | "none" | "unknown";

export function boatPhase(state: string | null | undefined): BoatPhase {
  if (!state) return "none";
  if (RUNNING_STATES.has(state)) return "running";
  if (STARTING_STATES.has(state) || state === "resuming" || state === "starting") return "starting";
  if (state === "archiving" || state === "stopping") return "stopping";
  if (state === "archived" || state === "stopped") return "stopped";
  return "unknown";
}

/** Boat keeps a stopped disk for about 14 days, then resume fails while the id still exists. */
function sandboxDiskGone(error: unknown) {
  if (!(error instanceof BoatError)) return false;
  if (error.status === 404 || error.code === "not_found") return true;
  const text = `${error.code} ${error.message}`.toLowerCase();
  return text.includes("data was deleted") || text.includes("deleted after");
}

const BOAT_READ_RETRIES = 2;
/**
 * Give up on one Boat call after this long. Without it a slow Boat holds a request open for
 * minutes (seen: 2.7 min for usage, >60 s for backups). Commands carry their own limit (≤90 s).
 */
const BOAT_READ_TIMEOUT_MS = 25_000;
const BOAT_WRITE_TIMEOUT_MS = 60_000;
const BOAT_COMMAND_TIMEOUT_MS = 150_000;
/** Boat's catch-all error text, which says nothing to a portal user on its own. */
const GENERIC_BOAT_MESSAGE = /^(something went wrong|internal (server )?error)\.?$/i;
const BOAT_RETRY_STATUS = new Set([502, 503, 504]);

async function boatFetch(path: string, init?: RequestInit) {
  const key = process.env.BOAT_API_KEY?.trim();
  if (!key) {
    throw new BoatError(
      "Boat is not set up. An admin needs to add BOAT_API_KEY to the server.",
      503,
      "not_configured",
    );
  }
  const method = (init?.method || "GET").toUpperCase();
  // Boat's gateway has short blips (502/503/504 or a dropped connection). Reads are safe to
  // repeat, so retry them; writes (start, exec, prompt) are not retried so nothing runs twice.
  const attempts = method === "GET" ? BOAT_READ_RETRIES + 1 : 1;
  const timeoutMs =
    method === "GET"
      ? BOAT_READ_TIMEOUT_MS
      : /\/commands(\?|$)/.test(path)
        ? BOAT_COMMAND_TIMEOUT_MS
        : BOAT_WRITE_TIMEOUT_MS;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await fetch(`${BOAT_API_BASE}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        ...init,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      if (attempt >= attempts) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new BoatError(
          timedOut
            ? `The cloud computer service did not respond within ${Math.round(timeoutMs / 1000)} s. Boat is running slowly — try again in a minute.`
            : `The cloud computer service did not respond (${error instanceof Error ? error.message : "network error"}). Try again in a minute.`,
          502,
          "boat_unreachable",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      continue;
    }
    if (!BOAT_RETRY_STATUS.has(response.status) || attempt >= attempts) break;
    await response.text().catch(() => "");
    await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
  }
  if (!response) {
    throw new BoatError("The cloud computer service did not respond. Try again in a minute.", 502, "boat_unreachable");
  }
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
    const raw = record.error?.message || record.message || "";
    throw new BoatError(
      GENERIC_BOAT_MESSAGE.test(raw.trim()) || (!raw && response.status >= 500)
        ? `The cloud computer service (Boat) had an internal error (${response.status}${raw ? `: ${raw.trim()}` : ""}). Try again in a minute.`
        : raw ||
          (BOAT_RETRY_STATUS.has(response.status)
            ? `The cloud computer service is briefly unavailable (${response.status}). Try again in a minute.`
            : `Boat request failed (${response.status})`),
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
  const stop = nested.stop && typeof nested.stop === "object" ? (nested.stop as Record<string, unknown>) : null;
  return {
    id,
    name: typeof nested.name === "string" && nested.name.trim() ? nested.name : "LinkedIn computer",
    state: typeof nested.state === "string" ? nested.state : "unknown",
    error: typeof nested.error === "string" ? nested.error : null,
    ...(typeof nested.updatedAt === "string" ? { updatedAt: nested.updatedAt } : {}),
    ...(stop?.status === "pending" && typeof stop.requestedAt === "string"
      ? { stopPendingSince: stop.requestedAt }
      : {}),
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
  const sourceId = saved?.cloudSandboxId || saved?.sandboxId;
  if (!sourceId) return { saved: false as const, reason: "no_computer" as const };
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
      body: JSON.stringify({ sandboxId: sourceId, name: projectSnapshotName(projectId) }),
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

export async function waitForBoat(sandboxId: string, attempts = 20, maxMs = 90_000) {
  // Bounded by time as well as attempts: when Boat is slow each poll can take 10 s+.
  const deadline = Date.now() + maxMs;
  let sandbox = await getBoatSandbox(sandboxId);
  for (
    let attempt = 0;
    attempt < attempts && !isBoatRunning(sandbox.state) && Date.now() < deadline;
    attempt += 1
  ) {
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

/** A stop that should take a minute or two has been pending this long: Boat lost it. */
const STUCK_STOP_MS = 10 * 60 * 1000;
/**
 * Stuck this long, the cloud computer is given up on and replaced (from the saved backup when
 * there is one). Seen: a stop pending for 3 hours that neither a resume nor a force stop cleared.
 */
const STUCK_REPLACE_MS = 30 * 60 * 1000;

function stuckStopping(sandbox: BoatSandbox, forMs = STUCK_STOP_MS) {
  if (sandbox.state !== "archiving" && sandbox.state !== "stopping") return false;
  const since = Date.parse(sandbox.stopPendingSince || sandbox.updatedAt || "");
  return Number.isFinite(since) && Date.now() - since > forMs;
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
  } else if (stuckStopping(sandbox)) {
    // Boat accepted a stop long ago but never carried it out, so the computer sits in
    // "archiving" for hours. Ask it to resume instead; if Boat refuses, we wait as before.
    console.warn(`Boat computer ${sandboxId} stuck ${sandbox.state} since ${sandbox.stopPendingSince || sandbox.updatedAt}; asking it to resume.`);
    await resumeBoatSandbox(sandboxId).catch((error) =>
      console.warn(`Boat resume of stuck computer ${sandboxId} failed:`, error instanceof Error ? error.message : error),
    );
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
  return stopSandboxIfRunning(saved.sandboxId);
}

async function stopSandboxIfRunning(sandboxId: string) {
  try {
    const sandbox = await getBoatSandbox(sandboxId);
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

  const created = await createBoatSandbox();
  const now = new Date();
  await collection.updateOne(
    { projectId },
    {
      $set: {
        sandboxId: created.id,
        updatedAt: now,
        lastBoatActivityAt: now,
      },
      $unset: { promptId: "", conversationId: "" },
      $setOnInsert: { projectId, createdAt: now },
    },
    { upsert: true },
  );
  const ready = isBoatRunning(created.state) ? created : await waitForBoat(created.id);
  return replacedDeletedDisk ? { ...ready, replacedDeletedDisk: true } : ready;
}

/* ------------------------------------------------------------------ Cloud computer */

async function waitForSnapshotReady(projectId: ObjectId, timeoutMs = 4 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await getProjectSnapshot(projectId).catch(() => null);
    if (snapshot?.status === "ready") return snapshot;
    if (snapshot?.status === "failed") return null;
    await sleep(5000);
  }
  return null;
}

/**
 * Cloud campaigns' own computer per project (separate from the assistant's), so its cost is
 * exactly this feature's. Starts from the project's saved backup so sender logins carry over;
 * the very first time, that backup is taken from the shared computer the senders used before.
 */
export async function ensureCloudBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  /** The old computer cannot come back (disk deleted, or stuck shutting down on Boat's side). */
  let diskGone = false;
  const current = saved?.cloudSandboxId
    ? await getBoatSandbox(saved.cloudSandboxId).catch(() => null)
    : null;
  if (current && stuckStopping(current, STUCK_REPLACE_MS)) {
    console.warn(
      `Cloud computer ${current.id} for project ${projectId} stuck ${current.state} since ${current.stopPendingSince || current.updatedAt}; replacing it.`,
    );
    diskGone = true;
  } else if (saved?.cloudSandboxId) {
    try {
      const sandbox = await reviveBoat(saved.cloudSandboxId);
      await collection.updateOne({ projectId }, { $set: { cloudActivityAt: new Date() } });
      return sandbox;
    } catch (error) {
      if (!sandboxDiskGone(error)) throw error;
      diskGone = true;
    }
  }

  let snapshot = await getProjectSnapshot(projectId).catch(() => null);
  const savingSince = Date.parse(snapshot?.createdAt || "");
  if (
    snapshot?.status === "saving" &&
    Number.isFinite(savingSince) &&
    Date.now() - savingSince > STUCK_REPLACE_MS
  ) {
    // A backup still "saving" after half an hour is stuck too (seen with a stuck computer): don't wait on it.
    console.warn(`Backup ${snapshot.name} stuck saving since ${snapshot.createdAt}; starting without it.`);
    snapshot = null;
  }
  if (snapshot?.status === "saving") snapshot = await waitForSnapshotReady(projectId);
  if (snapshot?.status !== "ready" && !saved?.cloudSandboxId && saved?.sandboxId) {
    // First cloud computer for an existing project: copy the shared computer (sender logins).
    await boatFetch("/saved-snapshots", {
      method: "POST",
      body: JSON.stringify({ sandboxId: saved.sandboxId, name: projectSnapshotName(projectId) }),
    }).catch((error) => {
      if (!(error instanceof BoatError && error.code === "save_in_progress")) throw error;
    });
    snapshot = await waitForSnapshotReady(projectId);
  }
  let from = snapshot?.status === "ready" ? snapshot.name : "";
  let created: BoatSandbox;
  try {
    created = await createBoatSandbox(from || undefined);
  } catch (error) {
    if (!from) throw error;
    console.warn("Cloud computer from backup failed; starting blank:", error);
    from = "";
    created = await createBoatSandbox();
  }
  const now = new Date();
  await collection.updateOne(
    { projectId },
    {
      $set: {
        cloudSandboxId: created.id,
        cloudActivityAt: now,
        updatedAt: now,
        ...(from ? { restoredFromSnapshotAt: now } : {}),
      },
      $addToSet: { cloudSandboxIds: created.id },
      $setOnInsert: { projectId, createdAt: now },
    },
    { upsert: true },
  );
  const ready = isBoatRunning(created.state) ? created : await waitForBoat(created.id);
  return {
    ...ready,
    ...(from ? { restoredFromSnapshot: true } : {}),
    ...(diskGone && !from ? { replacedDeletedDisk: true } : {}),
  };
}

export async function getCloudBoatMeta(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  const ids = new Set(saved?.cloudSandboxIds || []);
  if (saved?.cloudSandboxId) ids.add(saved.cloudSandboxId);
  return {
    sandboxId: saved?.cloudSandboxId || null,
    sandboxIds: [...ids],
    lastActivityAt: saved?.cloudActivityAt?.toISOString() || null,
  };
}

export async function stopCloudBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.cloudSandboxId) return { stopped: false as const, reason: "none" as const };
  return stopSandboxIfRunning(saved.cloudSandboxId);
}

export async function cloudBoatStatus(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.cloudSandboxId) return { sandbox: null };
  const sandbox = await getBoatSandbox(saved.cloudSandboxId).catch(() => null);
  return { sandbox };
}

/** Stop the cloud computer after BOAT_IDLE_STOP_MS without cloud activity. */
export async function maybeStopIdleCloudBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.cloudSandboxId || !saved.cloudActivityAt) {
    return { stopped: false as const, reason: "none" as const };
  }
  if (Date.now() - saved.cloudActivityAt.getTime() < BOAT_IDLE_STOP_MS) {
    return { stopped: false as const, reason: "active" as const };
  }
  return stopSandboxIfRunning(saved.cloudSandboxId);
}

export async function stampCloudActivity(projectId: ObjectId) {
  const collection = await boatLinks();
  await collection.updateOne({ projectId }, { $set: { cloudActivityAt: new Date() } });
}

/** Saved-snapshot allowance (backup storage is billed only above the plan's included count). */
export async function getSnapshotAllowance() {
  const data = (await boatFetch("/saved-snapshots")) as Record<string, unknown>;
  const allowance = (data?.allowance ?? {}) as Record<string, unknown>;
  return {
    included: Number(allowance.included) || 0,
    used: Number(allowance.used) || 0,
    extra: Number(allowance.extra) || 0,
    extraDailyDollars: Number(allowance.extraDailyDollars) || 0,
  };
}

/** LinkedIn's own computer. Does not resume or replace the email computer. */
export async function ensureLinkedinBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (saved?.linkedinSandboxId && saved.linkedinSandboxId !== saved.sandboxId) {
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

export async function linkedinBoatStatus(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.linkedinSandboxId || saved.linkedinSandboxId === saved.sandboxId) {
    return { sandbox: null };
  }
  const sandbox = await getBoatSandbox(saved.linkedinSandboxId).catch(() => null);
  return { sandbox };
}

export async function getLinkedinBoatMeta(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  return {
    sandboxId:
      saved?.linkedinSandboxId && saved.linkedinSandboxId !== saved.sandboxId
        ? saved.linkedinSandboxId
        : null,
  };
}

/** Stop the LinkedIn computer (disk is kept). */
export async function stopLinkedinBoat(projectId: ObjectId) {
  const collection = await boatLinks();
  const saved = await collection.findOne({ projectId });
  if (!saved?.linkedinSandboxId || saved.linkedinSandboxId === saved.sandboxId) {
    return { stopped: false as const, reason: "none" as const };
  }
  return stopSandboxIfRunning(saved.linkedinSandboxId);
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
  /** Use this harness instead of the default order. */
  provider?: string;
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
  provider?: string,
) {
  const prompt = strict
    ? `${STRICT_TASK_PREFACE}${task.trim()}`
    : `${DESKTOP_TASK_PREFACE}${task.trim()}\n\nWhen you finish, report the rows you read, who you emailed, and any row that failed.`;
  let lastError: unknown;
  for (const providerName of provider ? [provider] : agentProviders()) {
    try {
      const data = await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          provider: providerName,
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
  let streaming = "";
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
    if (!body) continue;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) continue;
    if (body.is_streaming === true) {
      if (/^(?:PENDING|REJECTED|CONNECTED|REPLIED|SENT|STATUS)\s*:/im.test(content)) {
        streaming = content;
      }
      continue;
    }
    report = content;
  }
  return clip(report || streaming, 4000);
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
    queued = await queueBoatPrompt(
      sandboxId,
      task,
      conversationId,
      options.strict,
      options.provider,
    );
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
