import { randomUUID } from "node:crypto";
import { runBoatCommand, shellQuote } from "@/lib/boat";

/**
 * Runs a bot's turn with the provider's own agent on the computer: Codex for ChatGPT, Grok Build for Grok.
 * They use the plan sign-in kept on the computer (AI accounts), never an API key, and they drive the
 * computer themselves: shell, files, browser and desktop (Boat's desktop tool is registered as MCP).
 *
 * A turn runs in the background in ~/.ai-runs/<runId>/: prompt.txt in, answer + exit code + session id out.
 * The portal starts it and reads the result later (the bots worker and open chats poll).
 */

export type AgentEngine = "chatgpt" | "grok";

const HOME = "/home/user";
const PATH = `export PATH="${HOME}/.local/bin:${HOME}/.grok/bin:$PATH"`;
/** Plan sign-ins only: an API key in the environment would bill the API (and flips SuperGrok to pay-as-you-go). */
const NO_API_KEYS = "unset OPENAI_API_KEY OPENAI_BASE_URL XAI_API_KEY XAI_BASE_URL";
const SETUP_VERSION = "1";

function runDir(runId: string) {
  return `${HOME}/.ai-runs/${runId}`;
}

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

/** "connected" when the agent's plan sign-in is on this computer. */
export async function agentSignedIn(sandboxId: string, engine: AgentEngine) {
  const check =
    engine === "chatgpt"
      ? `${PATH}; codex login status 2>&1 | grep -qi "logged in using chatgpt" && echo SIGNED_IN`
      : `test -s ${HOME}/.grok/auth.json && echo SIGNED_IN`;
  const result = await runBoatCommand(sandboxId, check, 20).catch(() => null);
  return Boolean(result?.stdout.includes("SIGNED_IN"));
}

/**
 * One-time setup per computer: Grok gets the same desktop tool Codex has (Boat registers it for Codex),
 * and the portal's MCP tools when there is a URL for them.
 */
export async function ensureAgentSetup(sandboxId: string, portalMcpUrl: string | null) {
  const marker = `${HOME}/.ai-runs/.setup-v${SETUP_VERSION}${portalMcpUrl ? "-mcp" : ""}`;
  const done = await runBoatCommand(sandboxId, `test -f ${marker} && echo READY`, 20).catch(() => null);
  if (done?.stdout.includes("READY")) return;
  const script = [
    PATH,
    `mkdir -p ${HOME}/.ai-runs`,
    // Desktop control for Grok: copy the command Boat's agent server writes for Codex.
    `if command -v grok >/dev/null && grep -q "mcp_servers.computer" ${HOME}/.codex/config.toml 2>/dev/null; then`,
    `  CMD=$(python3 -c 'import tomllib;c=tomllib.load(open("${HOME}/.codex/config.toml","rb"))["mcp_servers"]["computer"];import shlex;print(shlex.quote(c["command"])+" -- "+" ".join(shlex.quote(a) for a in c.get("args",[])))' 2>/dev/null)`,
    `  [ -n "$CMD" ] && eval "grok mcp add computer -s user $CMD" >/dev/null 2>&1 || true`,
    "fi",
    portalMcpUrl
      ? `command -v grok >/dev/null && grok mcp add portal ${shellQuote(portalMcpUrl)} -t http -s user >/dev/null 2>&1 || true`
      : "",
    `touch ${marker}`,
  ]
    .filter(Boolean)
    .join("\n");
  await runBoatCommand(sandboxId, script, 60).catch(() => null);
}

/**
 * Starts one turn in the background. `sessionId` continues an earlier conversation; without it a new one
 * starts (Grok takes the id we choose; Codex reports its own, read later).
 */
export async function startAgentRun(input: {
  sandboxId: string;
  engine: AgentEngine;
  cwd: string;
  prompt: string;
  model?: string;
  sessionId?: string | null;
}) {
  const runId = randomUUID();
  const dir = runDir(runId);
  const model = input.model ? ` -m ${shellQuote(input.model)}` : "";
  let agent: string;
  let newSessionId: string | null = null;
  if (input.engine === "chatgpt") {
    const flags = `--json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox${model} -o ${dir}/answer.md`;
    agent = input.sessionId
      ? `codex exec resume ${shellQuote(input.sessionId)} ${flags} "$(cat ${dir}/prompt.txt)" > ${dir}/events.jsonl 2> ${dir}/err.log`
      : `codex exec ${flags} "$(cat ${dir}/prompt.txt)" > ${dir}/events.jsonl 2> ${dir}/err.log`;
  } else {
    newSessionId = input.sessionId ? null : randomUUID();
    const session = input.sessionId ? `-r ${shellQuote(input.sessionId)}` : `-s ${newSessionId}`;
    agent = `grok -p "$(cat ${dir}/prompt.txt)" --output-format json --always-approve --no-alt-screen ${session}${model} --cwd ${shellQuote(input.cwd)} > ${dir}/answer.json 2> ${dir}/err.log`;
  }
  const runner = [
    "#!/bin/bash",
    PATH,
    NO_API_KEYS,
    `cd ${shellQuote(input.cwd)} || cd ${HOME}`,
    agent,
    `echo $? > ${dir}/exit`,
  ].join("\n");
  const start = await runBoatCommand(
    input.sandboxId,
    [
      `mkdir -p ${dir} ${shellQuote(input.cwd)}`,
      `echo ${b64(input.prompt)} | base64 -d > ${dir}/prompt.txt`,
      `echo ${b64(runner)} | base64 -d > ${dir}/run.sh`,
      `(nohup bash ${dir}/run.sh > ${dir}/runner.log 2>&1 &)`,
      "echo STARTED",
    ].join("\n"),
    30,
  );
  if (!start.stdout.includes("STARTED")) throw new Error("The agent did not start on the computer.");
  return { runId, sessionId: newSessionId };
}

/** Grok's JSON output: take the final answer text, whatever the exact field. */
function grokAnswer(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  try {
    const data = JSON.parse(text) as unknown;
    const pick = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      const record = value as Record<string, unknown>;
      for (const key of ["result", "response", "text", "content", "message", "output", "final"]) {
        const found = pick(record[key]);
        if (found) return found;
      }
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          const found = pick(value[i]);
          if (found) return found;
        }
      }
      return "";
    };
    return pick(data) || text;
  } catch {
    // Several JSON lines or plain text: the last non-empty line is the answer.
    return text;
  }
}

export type AgentRunResult =
  | { done: false }
  | { done: true; ok: boolean; answer: string; sessionId: string | null; error: string };

/** Reads a turn's outcome; `done: false` while the agent still works. */
export async function readAgentRun(sandboxId: string, engine: AgentEngine, runId: string): Promise<AgentRunResult> {
  const dir = runDir(runId);
  const result = await runBoatCommand(
    sandboxId,
    [
      `if [ ! -f ${dir}/exit ]; then echo "@@RUNNING"; exit 0; fi`,
      `echo "@@EXIT"; cat ${dir}/exit`,
      `echo "@@SESSION"; grep -m1 -oE '"thread_id":"[^"]+"' ${dir}/events.jsonl 2>/dev/null`,
      `echo "@@ERR"; tail -c 1200 ${dir}/err.log 2>/dev/null; grep -E '"type":"(error|turn.failed)"' ${dir}/events.jsonl 2>/dev/null | tail -2`,
      `echo "@@ANSWER"; cat ${dir}/answer.md 2>/dev/null || cat ${dir}/answer.json 2>/dev/null`,
    ].join("\n"),
    30,
    60_000,
  );
  const out = result.stdout;
  if (out.includes("@@RUNNING") || !out.includes("@@EXIT")) return { done: false };
  const part = (name: string) => out.split(`@@${name}`)[1]?.split(/\n@@[A-Z]+/)[0]?.trim() ?? "";
  const exit = Number(part("EXIT"));
  const rawAnswer = out.split("@@ANSWER")[1]?.trim() ?? "";
  const answer = engine === "grok" ? grokAnswer(rawAnswer) : rawAnswer;
  const sessionId = part("SESSION").match(/"thread_id":"([^"]+)"/)?.[1] ?? null;
  const error = part("ERR").slice(-800);
  return { done: true, ok: exit === 0 && Boolean(answer), answer, sessionId, error };
}

/** Stops a turn that runs too long. */
export async function stopAgentRun(sandboxId: string, runId: string) {
  await runBoatCommand(sandboxId, `pkill -f "[a]i-runs/${runId}/run.sh"; echo 124 > ${runDir(runId)}/exit`, 20).catch(() => null);
}

/** Copies the plan sign-in from the project computer to a bot's own computer. */
export async function copySignIn(fromSandboxId: string, toSandboxId: string, engine: AgentEngine) {
  const file = engine === "chatgpt" ? `${HOME}/.codex/auth.json` : `${HOME}/.grok/auth.json`;
  const read = await runBoatCommand(fromSandboxId, `test -s ${file} && base64 -w0 ${file}`, 20, 60_000).catch(() => null);
  const content = read?.stdout.trim();
  if (!content) return false;
  const dir = file.slice(0, file.lastIndexOf("/"));
  const write = await runBoatCommand(
    toSandboxId,
    `mkdir -p ${dir} && echo ${content} | base64 -d > ${file} && chmod 600 ${file} && echo COPIED`,
    20,
  ).catch(() => null);
  return Boolean(write?.stdout.includes("COPIED"));
}
