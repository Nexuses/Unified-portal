import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  BoatError,
  boatConfigured,
  ensureProjectBoat,
  getBoatSandbox,
  getSavedBoatSandboxId,
  isBoatRunning,
  runBoatCommand,
  waitForBoat,
} from "@/lib/boat";
import type { AiLogin, AiLoginProvider } from "@/lib/ai-bots";

/**
 * AI subscription sign-ins for a project's bots (ChatGPT plan, SuperGrok plan), instead of API keys.
 *
 * The sign-in happens on the project's computer with the provider's own CLI and its device-code flow:
 * the computer prints a link and a short code, a person approves it on openai.com or x.ai, and the CLI keeps
 * the login in its home folder (~/.codex, ~/.grok). Every bot working on that computer uses that login.
 * The portal never sees a password or a token.
 */

type LoginDoc = {
  projectId: ObjectId;
  provider: AiLoginProvider;
  state: "pending" | "connected" | "none" | "error";
  sandboxId?: string;
  url?: string;
  code?: string;
  expiresAt?: Date;
  account?: string;
  error?: string | null;
  connectedAt?: Date;
  updatedAt: Date;
};

const PATH = 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"';
const CODE_LIFETIME_MS = 15 * 60 * 1000;

const PROVIDERS: Record<
  AiLoginProvider,
  { label: string; plan: string; install: string; login: string; logout: string; status: string }
> = {
  chatgpt: {
    label: "ChatGPT",
    plan: "ChatGPT Plus, Pro, Business or Enterprise",
    install: "command -v codex >/dev/null || npm install -g --no-fund --no-audit @openai/codex >/tmp/ai-install-codex.log 2>&1",
    login: "codex login --device-auth",
    logout: "codex logout",
    // "Logged in using ChatGPT" is the subscription; "using an API key" is not what we want here.
    status: "codex login status 2>&1 | head -3",
  },
  grok: {
    label: "Grok",
    plan: "SuperGrok or X Premium+",
    // xAI's official installer. Download first: `curl | bash </dev/null` would run nothing.
    install:
      "command -v grok >/dev/null || { curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install.sh && bash /tmp/grok-install.sh </dev/null >/tmp/ai-install-grok.log 2>&1; }",
    login: "grok login --device-auth",
    logout: "grok logout",
    // Grok has no status command; its stored sign-in is the check.
    status: "test -s ~/.grok/auth.json && echo GROK_SIGNED_IN || echo GROK_SIGNED_OUT",
  },
};

export const AI_LOGIN_PROVIDERS = Object.keys(PROVIDERS) as AiLoginProvider[];

async function logins() {
  const db = await getDb();
  const collection = db.collection<LoginDoc>("ai_bot_logins");
  await collection.createIndex({ projectId: 1, provider: 1 }, { unique: true });
  return collection;
}

function strip(text: string) {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

function logFile(provider: AiLoginProvider) {
  return `/tmp/ai-login-${provider}.log`;
}

/** Reads the link and code the CLI printed. */
function parsePrompt(provider: AiLoginProvider, output: string) {
  const text = strip(output);
  if (provider === "grok") {
    const url = text.match(/https:\/\/accounts\.x\.ai\/\S*user_code=[A-Z0-9-]+/)?.[0];
    const code = url?.match(/user_code=([A-Z0-9-]+)/)?.[1] ?? text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
    return url && code ? { url, code } : null;
  }
  const url = text.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0];
  const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
  return url && code ? { url, code } : null;
}

/** "connected", "none", or the account it is signed in as. */
function parseStatus(provider: AiLoginProvider, output: string) {
  const text = strip(output);
  if (provider === "grok") return text.includes("GROK_SIGNED_IN") ? { connected: true } : { connected: false };
  if (/not logged in/i.test(text)) return { connected: false };
  if (/logged in using chatgpt/i.test(text)) return { connected: true };
  // Signed in with an API key: that is not a plan sign-in.
  return { connected: false, apiKey: /api key/i.test(text) };
}

async function runningComputer(projectId: ObjectId) {
  const id = await getSavedBoatSandboxId(projectId);
  if (!id) return null;
  const sandbox = await getBoatSandbox(id).catch(() => null);
  return sandbox && isBoatRunning(sandbox.state) ? sandbox : null;
}

async function wakeComputer(projectId: ObjectId) {
  if (!boatConfigured()) throw new BoatError("Cloud computers aren't set up. An admin needs to add BOAT_API_KEY.", 503, "not_configured");
  const sandbox = await ensureProjectBoat(projectId);
  if (isBoatRunning(sandbox.state)) return sandbox;
  const ready = await waitForBoat(sandbox.id, 45, 120_000);
  if (!isBoatRunning(ready.state)) throw new BoatError(`The computer is ${ready.state}. Try again in a minute.`, 409, "not_ready");
  return ready;
}

function toLogin(provider: AiLoginProvider, doc: LoginDoc | null | undefined): AiLogin {
  const pending = doc?.state === "pending" && doc.expiresAt && doc.expiresAt > new Date();
  return {
    provider,
    label: PROVIDERS[provider].label,
    plan: PROVIDERS[provider].plan,
    state: pending ? "pending" : doc?.state === "connected" ? "connected" : doc?.state === "error" ? "error" : "none",
    ...(pending ? { url: doc?.url, code: doc?.code, expiresAt: doc?.expiresAt?.toISOString() } : {}),
    ...(doc?.connectedAt && doc.state === "connected" ? { connectedAt: doc.connectedAt.toISOString() } : {}),
    ...(doc?.error && doc.state === "error" ? { error: doc.error } : {}),
  };
}

async function save(projectId: ObjectId, provider: AiLoginProvider, values: Partial<LoginDoc>) {
  const collection = await logins();
  await collection.updateOne(
    { projectId, provider },
    { $set: { ...values, updatedAt: new Date() }, $setOnInsert: { projectId, provider } },
    { upsert: true },
  );
}

/**
 * The sign-ins of the project. Checks the computer only when it is already running (never wakes it for a
 * status), so a sleeping computer shows the last known state.
 */
export async function listLogins(projectId: ObjectId): Promise<AiLogin[]> {
  const collection = await logins();
  const docs = new Map<AiLoginProvider, LoginDoc>(
    (await collection.find({ projectId }).toArray()).map((doc) => [doc.provider, doc]),
  );
  const sandbox = await runningComputer(projectId);
  if (sandbox) {
    const result = await runBoatCommand(
      sandbox.id,
      [PATH, ...AI_LOGIN_PROVIDERS.map((p) => `echo "@@${p}"; ${PROVIDERS[p].status}`)].join("\n"),
      30,
    ).catch(() => null);
    if (result) {
      for (const provider of AI_LOGIN_PROVIDERS) {
        const section = result.stdout.split(`@@${provider}`)[1]?.split("@@")[0] ?? "";
        const status = parseStatus(provider, section);
        const doc = docs.get(provider);
        if (status.connected && doc?.state !== "connected") {
          await save(projectId, provider, { state: "connected", sandboxId: sandbox.id, connectedAt: new Date(), error: null });
          docs.set(provider, { ...(doc ?? { projectId, provider, updatedAt: new Date() }), state: "connected", connectedAt: new Date() });
        } else if (!status.connected && doc?.state === "connected") {
          await save(projectId, provider, { state: "none" });
          docs.set(provider, { ...doc, state: "none" });
        }
      }
    }
  }
  return AI_LOGIN_PROVIDERS.map((provider) => toLogin(provider, docs.get(provider)));
}

const CLI_NAME: Record<AiLoginProvider, string> = { chatgpt: "codex", grok: "grok" };

/**
 * Installs the provider's CLI when missing. A first install can outlast one command's time window, so it
 * runs in the background and we wait for the CLI to appear.
 */
async function ensureCli(sandboxId: string, provider: AiLoginProvider) {
  const has = `${PATH}; command -v ${CLI_NAME[provider]} >/dev/null && echo CLI_READY`;
  const check = await runBoatCommand(sandboxId, has, 20).catch(() => null);
  if (check?.stdout.includes("CLI_READY")) return;
  await runBoatCommand(sandboxId, `${PATH}; (nohup sh -c '${PROVIDERS[provider].install.replace(/'/g, `'\\''`)}' </dev/null >/dev/null 2>&1 &)`, 20);
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const again = await runBoatCommand(sandboxId, has, 20).catch(() => null);
    if (again?.stdout.includes("CLI_READY")) return;
  }
  throw new Error(`Could not install ${PROVIDERS[provider].label}'s sign-in tool on the computer. Try again in a minute.`);
}

/** Starts a device-code sign-in on the project's computer and returns the link and code to show. */
export async function startLogin(projectId: ObjectId, provider: AiLoginProvider): Promise<AiLogin> {
  if (!AI_LOGIN_PROVIDERS.includes(provider)) throw new Error("Unknown provider");
  const spec = PROVIDERS[provider];
  const sandbox = await wakeComputer(projectId);
  const log = logFile(provider);
  await ensureCli(sandbox.id, provider);
  // Stop an older sign-in that may still wait. This must be its own command: in the same script as the
  // start line below, pkill would match that line's text and kill the script itself.
  await runBoatCommand(sandbox.id, `pkill -f "[${spec.login[0]}]${spec.login.slice(1)}" 2>/dev/null; true`, 20).catch(() => null);
  // Start a fresh sign-in in the background. It keeps waiting on the computer until someone approves
  // the code (up to 15 minutes).
  const start = await runBoatCommand(
    sandbox.id,
    [
      PATH,
      `rm -f ${log}`,
      `(nohup ${spec.login} </dev/null > ${log} 2>&1 &)`,
      `for i in $(seq 1 40); do grep -qE "[A-Z0-9]{4}-[A-Z0-9]{4,6}" ${log} 2>/dev/null && break; sleep 0.5; done`,
      `cat ${log}`,
    ].join("\n"),
    90,
    8000,
  );
  const prompt = parsePrompt(provider, start.stdout);
  if (!prompt) {
    const detail = strip(start.stdout + start.stderr).trim().split("\n").slice(-2).join(" ");
    await save(projectId, provider, { state: "error", error: detail || "The sign-in did not start." });
    throw new Error(
      /device.{0,40}(disabled|not enabled|not allowed)/i.test(detail)
        ? "Device-code sign-in is turned off for this account. Turn it on in ChatGPT's security settings (or ask the workspace admin), then try again."
        : `The sign-in did not start${detail ? `: ${detail.slice(0, 200)}` : "."}`,
    );
  }
  await save(projectId, provider, {
    state: "pending",
    sandboxId: sandbox.id,
    url: prompt.url,
    code: prompt.code,
    expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
    error: null,
  });
  return (await listLogins(projectId)).find((login) => login.provider === provider)!;
}

/** Signs the CLI out on the computer and forgets the sign-in. */
export async function logout(projectId: ObjectId, provider: AiLoginProvider) {
  if (!AI_LOGIN_PROVIDERS.includes(provider)) throw new Error("Unknown provider");
  const sandbox = await wakeComputer(projectId);
  const spec = PROVIDERS[provider];
  await runBoatCommand(
    sandbox.id,
    [PATH, `pkill -f "[${spec.login[0]}]${spec.login.slice(1)}" 2>/dev/null || true`, `${spec.logout} >/dev/null 2>&1 || true`].join("\n"),
    30,
  );
  await save(projectId, provider, { state: "none", url: undefined, code: undefined, error: null });
}

/** Cancels a sign-in that is waiting for approval. */
export async function cancelLogin(projectId: ObjectId, provider: AiLoginProvider) {
  if (!AI_LOGIN_PROVIDERS.includes(provider)) throw new Error("Unknown provider");
  const sandbox = await runningComputer(projectId);
  const spec = PROVIDERS[provider];
  if (sandbox) {
    await runBoatCommand(sandbox.id, `pkill -f "[${spec.login[0]}]${spec.login.slice(1)}" 2>/dev/null || true`, 20).catch(() => null);
  }
  await save(projectId, provider, { state: "none", url: undefined, code: undefined, error: null });
}
