import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AssistantExtraTools } from "@/lib/assistant-server";

/**
 * Composio (connected apps) for AI bots: one Composio "tool router" session per project, REST v3.1.
 * People connect HubSpot, Apollo, Notion, Gmail… from the chatbot's Apps drawer; every bot of the project can
 * then use them through three tools (search tools, get schemas, run tools). The Composio key only lives on
 * the server: computer bots reach these tools through the portal's own MCP endpoint, never Composio directly.
 */

const BASE = "https://backend.composio.dev/api/v3.1";
const LEGACY_BASE = "https://backend.composio.dev/api/v3";

/** The apps offered in the Apps drawer, in this order. */
export const COMPOSIO_TOOLKITS = [
  "hubspot",
  "apollo",
  "salesforce",
  "notion",
  "gmail",
  "googlesheets",
  "linkedin",
  "slack",
];
const TOOLKITS_KEY = COMPOSIO_TOOLKITS.join(",");

export type ComposioApp = {
  slug: string;
  name: string;
  logo: string;
  description: string;
  connected: boolean;
  accountId: string | null;
};

type SessionDoc = {
  projectId: ObjectId;
  sessionId: string;
  toolkits: string;
  createdAt: Date;
};

export function composioConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

function userIdFor(projectId: ObjectId) {
  return `nexuses-project-${projectId.toHexString()}`;
}

class ComposioError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call(path: string, init: RequestInit = {}, base = BASE) {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) throw new ComposioError("Connected apps aren't set up. An admin needs to add COMPOSIO_API_KEY.", 503);
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "x-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!response.ok) {
    const error = data.error as { message?: string } | string | undefined;
    const message =
      (typeof error === "string" ? error : error?.message) ||
      (typeof data.message === "string" ? data.message : `Composio request failed (${response.status})`);
    throw new ComposioError(message, response.status);
  }
  return data;
}

async function sessions() {
  const db = await getDb();
  const collection = db.collection<SessionDoc>("ai_bot_composio_sessions");
  await collection.createIndex({ projectId: 1 }, { unique: true });
  return collection;
}

async function createSession(projectId: ObjectId) {
  const data = await call("/tool_router/session", {
    method: "POST",
    body: JSON.stringify({
      user_id: userIdFor(projectId),
      toolkits: { enable: COMPOSIO_TOOLKITS },
      // Connections are made in the Apps drawer, and bots already have computers for running code.
      manage_connections: { enable: false },
      workbench: { enable: false },
    }),
  });
  const sessionId = String(data.session_id ?? "");
  if (!sessionId) throw new ComposioError("Composio did not return a session.", 502);
  const collection = await sessions();
  await collection.updateOne(
    { projectId },
    { $set: { sessionId, toolkits: TOOLKITS_KEY, createdAt: new Date() } },
    { upsert: true },
  );
  return sessionId;
}

async function sessionId(projectId: ObjectId) {
  const collection = await sessions();
  const saved = await collection.findOne({ projectId });
  if (saved && saved.toolkits === TOOLKITS_KEY) return saved.sessionId;
  return createSession(projectId);
}

/** Runs a session call; a session Composio no longer knows is made again once. */
async function withSession<T>(projectId: ObjectId, run: (id: string) => Promise<T>) {
  const id = await sessionId(projectId);
  try {
    return await run(id);
  } catch (error) {
    if (error instanceof ComposioError && (error.status === 404 || error.status === 410)) {
      return run(await createSession(projectId));
    }
    throw error;
  }
}

export async function listApps(projectId: ObjectId): Promise<ComposioApp[]> {
  const data = await withSession(projectId, (id) => call(`/tool_router/session/${id}/toolkits?limit=50`));
  const items = (Array.isArray(data.items) ? data.items : []) as Array<Record<string, unknown>>;
  const apps = items.map((item) => {
    const meta = (item.meta ?? {}) as Record<string, unknown>;
    const account = (item.connected_account ?? null) as Record<string, unknown> | null;
    const status = String(account?.status ?? "").toUpperCase();
    return {
      slug: String(item.slug ?? ""),
      name: String(item.name ?? item.slug ?? ""),
      logo: typeof meta.logo === "string" ? meta.logo : "",
      description: typeof meta.description === "string" ? meta.description : "",
      connected: Boolean(account) && (!status || status === "ACTIVE"),
      accountId: account && typeof account.id === "string" ? account.id : null,
    };
  });
  return apps.sort((a, b) => COMPOSIO_TOOLKITS.indexOf(a.slug) - COMPOSIO_TOOLKITS.indexOf(b.slug));
}

/** A Composio-hosted sign-in link for one app. */
export async function connectApp(projectId: ObjectId, toolkit: string, callbackUrl?: string) {
  if (!COMPOSIO_TOOLKITS.includes(toolkit)) throw new ComposioError("That app isn't offered.", 400);
  const data = await withSession(projectId, (id) =>
    call(`/tool_router/session/${id}/link`, {
      method: "POST",
      body: JSON.stringify({ toolkit, ...(callbackUrl ? { callback_url: callbackUrl } : {}) }),
    }),
  );
  const url = String(data.redirect_url ?? "");
  if (!url.startsWith("https://")) throw new ComposioError("Composio did not return a sign-in link.", 502);
  return url;
}

export async function disconnectApp(projectId: ObjectId, accountId: string) {
  // Only an account that belongs to this project's session.
  const apps = await listApps(projectId);
  if (!apps.some((app) => app.accountId === accountId)) throw new ComposioError("That app isn't connected here.", 404);
  await call(`/connected_accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" }, LEGACY_BASE);
}

/* ---- Tools for bots ---- */

type ToolDef = AssistantExtraTools["tools"][number];
const toolCache = new Map<string, { at: number; tools: ToolDef[] }>();
const connectedCache = new Map<string, { at: number; connected: boolean }>();

/** True when the project has at least one app connected (cached for a minute). */
export async function hasConnectedApps(projectId: ObjectId) {
  if (!composioConfigured()) return false;
  const key = projectId.toHexString();
  const cached = connectedCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.connected;
  const connected = await listApps(projectId)
    .then((apps) => apps.some((app) => app.connected))
    .catch(() => false);
  connectedCache.set(key, { at: Date.now(), connected });
  return connected;
}

export function forgetConnectedCache(projectId: ObjectId) {
  connectedCache.delete(projectId.toHexString());
}

async function sessionTools(projectId: ObjectId): Promise<ToolDef[]> {
  const id = await sessionId(projectId);
  const cached = toolCache.get(id);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.tools;
  const data = await call(`/tool_router/session/${id}/tools?limit=50`);
  const items = (Array.isArray(data.items) ? data.items : []) as Array<Record<string, unknown>>;
  const tools: ToolDef[] = items
    .filter((item) => typeof item.slug === "string")
    .map((item) => ({
      type: "function" as const,
      function: {
        name: String(item.slug),
        description: `${String(item.description ?? "").slice(0, 1500)} (Connected apps: HubSpot, Apollo, Notion, Gmail and others the project linked.)`,
        parameters: (item.input_parameters ?? { type: "object", properties: {} }) as ToolDef["function"]["parameters"],
      },
    }));
  toolCache.set(id, { at: Date.now(), tools });
  return tools;
}

export async function runComposioTool(projectId: ObjectId, slug: string, args: Record<string, unknown>) {
  const data = await withSession(projectId, (id) =>
    call(`/tool_router/session/${id}/execute_meta`, {
      method: "POST",
      body: JSON.stringify({ slug, arguments: args }),
      signal: AbortSignal.timeout(110_000),
    }),
  );
  return data.data ?? data;
}

/** The connected-apps tools as extra tools for a portal bot. Empty when nothing is connected. */
export async function composioExtraTools(projectId: ObjectId): Promise<AssistantExtraTools | null> {
  if (!(await hasConnectedApps(projectId))) return null;
  const tools = await sessionTools(projectId).catch(() => []);
  if (!tools.length) return null;
  return {
    tools,
    run: (name, args) => runComposioTool(projectId, name, args),
  };
}

/** Joins tool sets (e.g. the Chief of Staff's tools and connected apps). */
export function mergeExtraTools(...sets: Array<AssistantExtraTools | null | undefined>): AssistantExtraTools | undefined {
  const present = sets.filter((set): set is AssistantExtraTools => Boolean(set?.tools.length));
  if (!present.length) return undefined;
  const owner = new Map<string, AssistantExtraTools>();
  for (const set of present) for (const tool of set.tools) owner.set(tool.function.name, set);
  return {
    tools: [...owner.entries()].map(([name, set]) => set.tools.find((tool) => tool.function.name === name)!),
    run: (name, args) => {
      const set = owner.get(name);
      if (!set) return Promise.resolve({ error: `Unknown tool ${name}` });
      return set.run(name, args);
    },
  };
}
