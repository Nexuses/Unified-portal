import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  BoatError,
  boatConfigured,
  getBoatMachineUsage,
  getBoatSandbox,
  isBoatRunning,
  runBoatCommand,
  shellQuote,
  stopBoatSandbox,
  waitForBoat,
} from "@/lib/boat";
import type {
  GtmBotComputer,
  GtmBotPhase,
  GtmBotStatus,
} from "@/lib/gtm-bot";

/**
 * GTM Bot: one OpenMausBot workspace per project, on that project's own Boat computer.
 *
 * - The home computer runs `openmausbot serve` as a systemd service, reached at a public Boat HTTPS address.
 *   It is created with `noEnv`, so none of our account's AI keys or tokens reach it. Users bring their own
 *   AI (SuperGrok sign-in) inside the workspace.
 * - Bots inside the workspace can ask for their own extra computers. Those requests go through the portal's
 *   relay (`/api/gtm-bot/relay/v1`), which holds the real Boat key and only lets a project see and use the
 *   computers it created, up to a cap.
 */

const BOAT_API_BASE = process.env.BOAT_API_BASE?.trim() || "https://boat.dev/api/v1";
const OMB_PORT = 8799;
const SERVICE = "gtm-bot";
/** Pinned so a new upstream release never changes a running workspace by surprise. */
const OMB_VERSION = process.env.GTM_BOT_OMB_VERSION?.trim() || "0.1.170";
/** Auto-stop for the home computer when "Always on" is off. Reset every time someone opens the workspace. */
const HOME_TTL_SECONDS = 4 * 60 * 60;
const SETUP_CLAIM_MS = 4 * 60 * 1000;

export function gtmBotMaxComputers() {
  const value = Number(process.env.GTM_BOT_MAX_BOT_COMPUTERS);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 3;
}

type WorkspaceDoc = {
  projectId: ObjectId;
  sandboxId?: string;
  url?: string;
  phase: GtmBotPhase;
  phaseDetail?: string;
  error?: string | null;
  relayTokenHash?: string;
  relayEnabled?: boolean;
  ombVersion?: string;
  alwaysOn?: boolean;
  setupClaimUntil?: Date;
  readyAt?: Date;
  lastOpenedAt?: Date;
  lastOpenedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};

type ComputerDoc = {
  projectId: ObjectId;
  sandboxId: string;
  name?: string;
  createdAt: Date;
  deletedAt?: Date | null;
};

let indexed = false;

async function collections() {
  const db = await getDb();
  const workspaces = db.collection<WorkspaceDoc>("gtm_bot_workspaces");
  const computers = db.collection<ComputerDoc>("gtm_bot_computers");
  if (!indexed) {
    await Promise.all([
      workspaces.createIndex({ projectId: 1 }, { unique: true }),
      workspaces.createIndex({ relayTokenHash: 1 }, { sparse: true }),
      computers.createIndex({ sandboxId: 1 }, { unique: true }),
      computers.createIndex({ projectId: 1, deletedAt: 1 }),
    ]);
    indexed = true;
  }
  return { workspaces, computers };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Where the VM reaches the portal's Boat relay. Null when the portal has no public address (local dev). */
function relayBaseUrl() {
  const base = (process.env.GTM_BOT_RELAY_ORIGIN || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) return null;
  return `${base}/api/gtm-bot/relay/v1`;
}

/** Raw Boat call: never throws on an HTTP error, so the relay can pass Boat's answer through as it is. */
export async function boatRaw(path: string, init: RequestInit = {}) {
  const key = process.env.BOAT_API_KEY?.trim();
  if (!key) throw new BoatError("Boat is not set up. Add BOAT_API_KEY on the server.", 503, "not_configured");
  return fetch(`${BOAT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function boatJson(path: string, init: RequestInit = {}) {
  const response = await boatRaw(path, init);
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!response.ok) {
    const error = (data.error ?? {}) as { message?: string; code?: string };
    throw new BoatError(
      error.message || (typeof data.message === "string" ? data.message : `Boat request failed (${response.status})`),
      response.status,
      error.code || "boat_error",
    );
  }
  return data;
}

async function setPhase(projectId: ObjectId, phase: GtmBotPhase, phaseDetail: string, extra: Partial<WorkspaceDoc> = {}) {
  const { workspaces } = await collections();
  await workspaces.updateOne(
    { projectId },
    { $set: { phase, phaseDetail, updatedAt: new Date(), ...extra } },
  );
}

async function createHomeComputer(projectId: ObjectId, alwaysOn: boolean) {
  const data = await boatJson("/sandboxes", {
    method: "POST",
    body: JSON.stringify({
      type: "default",
      noEnv: true,
      ttlSeconds: alwaysOn ? null : HOME_TTL_SECONDS,
      labels: { gtmProject: projectId.toHexString(), gtmRole: "home" },
    }),
  });
  const sandbox = (data.sandbox ?? data) as { id?: string };
  if (!sandbox.id) throw new BoatError("Boat did not return a computer id", 502, "missing_sandbox");
  return sandbox.id;
}

/** Resume (or recreate when its disk is gone) and wait until it runs. Returns the id that now runs. */
async function bringUpHome(projectId: ObjectId, doc: WorkspaceDoc): Promise<{ sandboxId: string; fresh: boolean }> {
  if (doc.sandboxId) {
    try {
      const current = await getBoatSandbox(doc.sandboxId);
      if (!isBoatRunning(current.state)) {
        if (current.state === "cancelled" || current.state === "deleted") {
          throw new BoatError("removed", 404, "not_found");
        }
        await boatJson(`/sandboxes/${encodeURIComponent(doc.sandboxId)}/resume`, { method: "POST", body: "{}" });
      }
      const ready = await waitForBoat(doc.sandboxId, 45, 120_000);
      if (!isBoatRunning(ready.state)) {
        throw new BoatError(`The computer is ${ready.state}. Try again in a minute.`, 409, "not_ready");
      }
      return { sandboxId: doc.sandboxId, fresh: false };
    } catch (error) {
      const gone =
        error instanceof BoatError &&
        (error.status === 404 || error.status === 410 || /data was deleted|snapshot_data_expired/i.test(`${error.code} ${error.message}`));
      if (!gone) throw error;
    }
  }
  const sandboxId = await createHomeComputer(projectId, Boolean(doc.alwaysOn));
  await setPhase(projectId, "creating", "Starting a new computer", { sandboxId, url: undefined });
  const ready = await waitForBoat(sandboxId, 45, 120_000);
  if (!isBoatRunning(ready.state)) {
    throw new BoatError(`The new computer is ${ready.state}. Try again in a minute.`, 409, "not_ready");
  }
  return { sandboxId, fresh: true };
}

async function hostHome(sandboxId: string) {
  const data = await boatJson(`/sandboxes/${encodeURIComponent(sandboxId)}/host`, {
    method: "POST",
    body: JSON.stringify({ port: OMB_PORT, localhost: true, public: true }),
  });
  const url = typeof data.url === "string" ? data.url.replace(/\/+$/, "") : "";
  if (!url.startsWith("https://")) throw new BoatError("Boat did not return a public address", 502, "missing_url");
  return url;
}

async function run(sandboxId: string, command: string, timeoutSeconds = 60) {
  const result = await runBoatCommand(sandboxId, command, timeoutSeconds, 4000);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ");
    throw new Error(detail || `A setup step failed (exit ${result.exitCode ?? "timeout"})`);
  }
  return result.stdout;
}

/** Installs OpenMausBot (pinned) and xAI's Grok CLI when missing. Safe to run again. */
async function installSoftware(sandboxId: string) {
  await run(
    sandboxId,
    [
      "set -e",
      'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"',
      `if [ "$(openmausbot --version 2>/dev/null)" != ${shellQuote(OMB_VERSION)} ]; then`,
      `  npm install -g --no-fund --no-audit ${shellQuote(`openmausbot@${OMB_VERSION}`)} > /tmp/gtm-bot-install.log 2>&1 || { tail -5 /tmp/gtm-bot-install.log; exit 1; }`,
      "fi",
      "openmausbot --version",
    ].join("\n"),
    90,
  );
  // Grok Build is what lets a SuperGrok subscription sign in (grok login --device-auth). Not fatal: an
  // xAI API key still works without it, and the next setup tries again.
  // Download first: with `curl | bash </dev/null` the redirect replaces the piped script and nothing runs.
  const grok = await runBoatCommand(
    sandboxId,
    [
      'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"',
      "command -v grok >/dev/null && exit 0",
      "curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install.sh",
      "bash /tmp/grok-install.sh </dev/null > /tmp/gtm-bot-grok.log 2>&1",
      "command -v grok >/dev/null",
    ].join("\n"),
    90,
  ).catch(() => null);
  if (grok?.exitCode !== 0) {
    console.warn("GTM Bot: Grok CLI install did not finish; SuperGrok sign-in waits for the next start.");
  }
}

/** Writes the systemd service (it comes back by itself after every resume) and (re)starts it. */
async function startService(sandboxId: string, url: string, relayToken: string | null, label: string) {
  const relay = relayToken ? relayBaseUrl() : null;
  const envLines = [
    "HOME=/home/user",
    "PATH=/home/user/.local/bin:/home/user/.grok/bin:__NODE_BIN__:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ...(relay && relayToken ? [`OMB_CLOUD_BOAT_URL=${relay}`, `OMB_CLOUD_BOAT_TOKEN=${relayToken}`] : []),
  ].join("\n");
  const unit = [
    "[Unit]",
    "Description=GTM Bot workspace (OpenMausBot)",
    "After=network-online.target",
    "",
    "[Service]",
    "User=user",
    "WorkingDirectory=/home/user",
    `EnvironmentFile=/etc/${SERVICE}.env`,
    `ExecStart=__OMB_BIN__ serve --port ${OMB_PORT} --public-url ${url} --label ${label}`,
    "Restart=always",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  await run(
    sandboxId,
    [
      "set -e",
      'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"',
      'NODE_BIN="$(dirname "$(command -v node)")"',
      'OMB_BIN="$(command -v openmausbot)"',
      `echo ${b64(envLines)} | base64 -d | sed "s#__NODE_BIN__#$NODE_BIN#" | sudo tee /etc/${SERVICE}.env > /dev/null`,
      `sudo chmod 600 /etc/${SERVICE}.env`,
      `echo ${b64(unit)} | base64 -d | sed "s#__OMB_BIN__#$OMB_BIN#" | sudo tee /etc/systemd/system/${SERVICE}.service > /dev/null`,
      // A server started by hand earlier would hold the port. "[o]" keeps pkill from matching this shell.
      'pkill -u user -f "[o]penmausbot serve" 2>/dev/null || true',
      "sudo systemctl daemon-reload",
      `sudo systemctl enable ${SERVICE} > /dev/null 2>&1`,
      `sudo systemctl restart ${SERVICE}`,
    ].join("\n"),
    60,
  );
}

async function waitForHealth(url: string, maxMs = 60_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await healthy(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return false;
}

async function healthy(url: string) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { app?: string } | null;
    return body?.app === "openmausbot";
  } catch {
    return false;
  }
}

async function setTtl(sandboxId: string, alwaysOn: boolean) {
  await boatJson(`/sandboxes/${encodeURIComponent(sandboxId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ttlSeconds: alwaysOn ? null : HOME_TTL_SECONDS }),
  }).catch((error) => console.warn("GTM Bot: could not set auto-stop", error instanceof Error ? error.message : error));
}

async function ensureDoc(projectId: ObjectId) {
  const { workspaces } = await collections();
  const now = new Date();
  await workspaces.updateOne(
    { projectId },
    { $setOnInsert: { projectId, phase: "none", createdAt: now, updatedAt: now } },
    { upsert: true },
  );
  return (await workspaces.findOne({ projectId }))!;
}

/**
 * Sets up the workspace, or starts it again after a stop. Everything here is idempotent, so the same call
 * repairs a half-finished setup. Progress is written to the doc as it goes; the page polls it.
 */
export async function startGtmBot(projectId: ObjectId, label: string) {
  if (!boatConfigured()) throw new BoatError("Boat is not set up. Add BOAT_API_KEY on the server.", 503, "not_configured");
  const { workspaces } = await collections();
  const doc = await ensureDoc(projectId);
  const claimed = await workspaces.findOneAndUpdate(
    { projectId, $or: [{ setupClaimUntil: { $exists: false } }, { setupClaimUntil: { $lt: new Date() } }] },
    { $set: { setupClaimUntil: new Date(Date.now() + SETUP_CLAIM_MS), error: null, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) return; // Someone else in this project is already starting it.

  try {
    await setPhase(projectId, "creating", doc.sandboxId ? "Waking your computer" : "Creating your computer");
    const { sandboxId, fresh } = await bringUpHome(projectId, doc);
    await setPhase(projectId, "installing", "Installing GTM Bot", { sandboxId });
    const url = await hostHome(sandboxId);
    const needsInstall = fresh || doc.ombVersion !== OMB_VERSION || doc.phase === "error" || doc.phase === "none";
    if (needsInstall) await installSoftware(sandboxId);

    const running = !needsInstall && doc.url === url && (await healthy(url));
    if (!running) {
      await setPhase(projectId, "starting", "Starting the workspace", { url });
      const relayToken = relayBaseUrl() ? randomBytes(32).toString("base64url") : null;
      const safeLabel = label.replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 40).replace(/\s+/g, "-") || "gtm-bot";
      await startService(sandboxId, url, relayToken, safeLabel);
      await workspaces.updateOne(
        { projectId },
        { $set: { relayTokenHash: relayToken ? hashToken(relayToken) : undefined, relayEnabled: Boolean(relayToken) } },
      );
      if (!(await waitForHealth(url))) {
        throw new Error("The workspace did not answer after starting. Press Start again in a minute.");
      }
    }
    await setTtl(sandboxId, Boolean(doc.alwaysOn));
    await setPhase(projectId, "ready", "Ready", {
      url,
      ombVersion: OMB_VERSION,
      readyAt: new Date(),
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup failed";
    console.error("GTM Bot setup failed:", error);
    await setPhase(projectId, "error", "Setup stopped", { error: message });
    throw error;
  } finally {
    await workspaces.updateOne({ projectId }, { $unset: { setupClaimUntil: "" } });
  }
}

/** A one-time sign-in link for this browser (valid about 10 minutes, single use). */
export async function openGtmBot(projectId: ObjectId, user: { id: string; fullName: string }) {
  const { workspaces } = await collections();
  const doc = await workspaces.findOne({ projectId });
  if (!doc?.sandboxId || !doc.url || doc.phase !== "ready") {
    throw new BoatError("Start GTM Bot first.", 409, "not_ready");
  }
  const sandbox = await getBoatSandbox(doc.sandboxId);
  if (!isBoatRunning(sandbox.state) || !(await healthy(doc.url))) {
    throw new BoatError("The workspace is asleep. Press Start to wake it.", 409, "asleep");
  }
  const label = `${user.fullName || "Portal user"}`.replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 40) || "Portal user";
  const output = await run(
    doc.sandboxId,
    `export PATH="$HOME/.local/bin:$PATH"; openmausbot pair --label ${shellQuote(label)} --public-url ${shellQuote(doc.url)} 2>&1 | sed "s/\\x1b\\[[0-9;?]*[a-zA-Z]//g"`,
    45,
  );
  const link = output.match(/https:\/\/\S+\/pair#code=[A-Z0-9-]+/)?.[0];
  if (!link || !link.startsWith(doc.url)) throw new Error("Could not create a sign-in link. Try again.");
  await setTtl(doc.sandboxId, Boolean(doc.alwaysOn));
  await workspaces.updateOne(
    { projectId },
    { $set: { lastOpenedAt: new Date(), lastOpenedBy: user.id, updatedAt: new Date() } },
  );
  return link;
}

/** Stops the home computer and every extra computer its bots made. Disks are kept. */
export async function stopGtmBot(projectId: ObjectId) {
  const { workspaces, computers } = await collections();
  const doc = await workspaces.findOne({ projectId });
  const extra = await computers.find({ projectId, deletedAt: null }).toArray();
  await Promise.all(
    [doc?.sandboxId, ...extra.map((c) => c.sandboxId)]
      .filter((id): id is string => Boolean(id))
      .map((id) => stopBoatSandbox(id).catch(() => undefined)),
  );
  if (doc) await setPhase(projectId, doc.phase === "none" ? "none" : "stopped", "Asleep");
}

export async function setGtmBotAlwaysOn(projectId: ObjectId, alwaysOn: boolean) {
  const { workspaces } = await collections();
  const doc = await ensureDoc(projectId);
  await workspaces.updateOne({ projectId }, { $set: { alwaysOn, updatedAt: new Date() } });
  if (doc.sandboxId) await setTtl(doc.sandboxId, alwaysOn);
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function getGtmBotStatus(projectId: ObjectId): Promise<GtmBotStatus> {
  const configured = boatConfigured();
  const { workspaces, computers } = await collections();
  const doc = await workspaces.findOne({ projectId });
  const extra = await computers.find({ projectId, deletedAt: null }).sort({ createdAt: 1 }).toArray();
  const since = monthStartIso();

  const describe = async (sandboxId: string, role: "home" | "bot", name?: string): Promise<GtmBotComputer> => {
    const [sandbox, usage] = await Promise.all([
      getBoatSandbox(sandboxId).catch(() => null),
      getBoatMachineUsage(sandboxId, since).catch(() => null),
    ]);
    return {
      id: sandboxId,
      role,
      name: role === "home" ? "Workspace computer" : name || "Bot computer",
      state: sandbox?.state ?? "unknown",
      running: sandbox ? isBoatRunning(sandbox.state) : false,
      monthHours: usage ? Math.round((usage.seconds / 3600) * 10) / 10 : null,
      monthDollars: usage ? Math.round(usage.dollars * 100) / 100 : null,
    };
  };

  const list = await Promise.all([
    ...(doc?.sandboxId ? [describe(doc.sandboxId, "home")] : []),
    ...extra.map((c) => describe(c.sandboxId, "bot", c.name)),
  ]);
  const home = list.find((c) => c.role === "home") ?? null;

  let phase: GtmBotPhase = doc?.phase ?? "none";
  const busy = Boolean(doc?.setupClaimUntil && doc.setupClaimUntil > new Date());
  // The computer can fall asleep by itself (auto-stop); show that instead of a stale "ready".
  if (!busy && phase === "ready" && home && !home.running) phase = "stopped";
  const reachable = !busy && phase === "ready" && doc?.url ? await healthy(doc.url) : false;
  if (!busy && phase === "ready" && !reachable) phase = "stopped";

  return {
    configured,
    phase,
    phaseDetail: doc?.phaseDetail ?? "",
    busy,
    error: doc?.error ?? null,
    url: doc?.url ?? null,
    version: doc?.ombVersion ?? null,
    alwaysOn: Boolean(doc?.alwaysOn),
    relayEnabled: Boolean(doc?.relayEnabled),
    maxBotComputers: gtmBotMaxComputers(),
    lastOpenedAt: doc?.lastOpenedAt?.toISOString() ?? null,
    computers: list,
    monthDollars:
      Math.round(list.reduce((sum, c) => sum + (c.monthDollars ?? 0), 0) * 100) / 100,
  };
}

// ---- Relay: what the workspace's bots may do with extra computers ----

export async function projectForRelayToken(token: string) {
  if (!token) return null;
  const { workspaces } = await collections();
  const doc = await workspaces.findOne({ relayTokenHash: hashToken(token) });
  return doc?.projectId ?? null;
}

export async function countBotComputers(projectId: ObjectId) {
  const { computers } = await collections();
  return computers.countDocuments({ projectId, deletedAt: null });
}

export async function recordBotComputer(projectId: ObjectId, sandboxId: string, name?: string) {
  const { computers } = await collections();
  await computers.updateOne(
    { sandboxId },
    { $setOnInsert: { projectId, sandboxId, createdAt: new Date() }, $set: { name, deletedAt: null } },
    { upsert: true },
  );
}

export async function ownsBotComputer(projectId: ObjectId, sandboxId: string) {
  const { computers } = await collections();
  return Boolean(await computers.findOne({ projectId, sandboxId, deletedAt: null }));
}

export async function forgetBotComputer(sandboxId: string) {
  const { computers } = await collections();
  await computers.updateOne({ sandboxId }, { $set: { deletedAt: new Date() } });
}
