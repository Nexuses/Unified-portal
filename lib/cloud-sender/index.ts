import { runBoatCommand, shellQuote } from "@/lib/boat";
import { SENDER_SCRIPT_SOURCE, SENDER_SCRIPT_VERSION } from "@/lib/cloud-sender/vm-script";

/**
 * Script-first Gmail sender on the Boat email VM.
 *
 * Each sender gets its own Chrome user-data-dir with a local CDP port (Chrome 136+ refuses
 * remote debugging on the default profile). The user signs in there once; a Node script
 * (playwright-core) then drives real Gmail with no AI in the loop.
 */

/** Pinned so every VM runs the same driver. */
export const PLAYWRIGHT_CORE_VERSION = "1.64.1";

const TOOLKIT_DIR = "$HOME/nexuses-sender";
const CHROME_ROOT = "$HOME/.nexuses-chrome";
const BASE_PORT = 9301;

export type SenderResult = {
  ok: boolean;
  status?: string;
  code?: string;
  message?: string;
  email?: string;
  url?: string;
  version?: string;
  [key: string]: unknown;
};

/** "Default" -> "default", "Profile 3" -> "profile-3". Safe for paths and log names. */
export function senderSlug(directoryName: string) {
  const slug = String(directoryName || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "default";
}

/** Stable per-sender CDP port so two sender Chromes never collide. */
export function senderCdpPort(directoryName: string) {
  const match = String(directoryName || "").match(/(\d+)\s*$/);
  const index = match ? Math.min(400, Number(match[1])) : 0;
  return BASE_PORT + index;
}

function toolkitMarker() {
  return `${SENDER_SCRIPT_VERSION}+pw${PLAYWRIGHT_CORE_VERSION}`;
}

/** Install (or update) the sender script and playwright-core on the VM. Idempotent. */
export async function ensureSenderToolkit(sandboxId: string) {
  const scriptB64 = Buffer.from(SENDER_SCRIPT_SOURCE, "utf8").toString("base64");
  const pkg = Buffer.from(
    JSON.stringify({ name: "nexuses-sender", private: true, type: "module" }),
    "utf8",
  ).toString("base64");
  const marker = toolkitMarker();
  const command = [
    `set -e; mkdir -p ${TOOLKIT_DIR}; cd ${TOOLKIT_DIR};`,
    `if [ "$(cat .version 2>/dev/null)" = ${shellQuote(marker)} ] && [ -d node_modules/playwright-core ]; then echo toolkit-ok; exit 0; fi;`,
    `printf '%s' ${shellQuote(pkg)} | base64 -d > package.json;`,
    `printf '%s' ${shellQuote(scriptB64)} | base64 -d > sender.mjs;`,
    `if [ ! -d node_modules/playwright-core ] || ! grep -q '"version": "${PLAYWRIGHT_CORE_VERSION}"' node_modules/playwright-core/package.json; then`,
    `  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund --silent playwright-core@${PLAYWRIGHT_CORE_VERSION} >/tmp/nexuses-sender-npm.log 2>&1 || { echo npm-failed; tail -5 /tmp/nexuses-sender-npm.log; exit 1; };`,
    `fi;`,
    `command -v xclip >/dev/null || sudo -n apt-get install -y -qq xclip >/dev/null 2>&1 || { sudo -n apt-get update -qq >/dev/null 2>&1 && sudo -n apt-get install -y -qq xclip >/dev/null 2>&1; } || true;`,
    `printf '%s' ${shellQuote(marker)} > .version; echo toolkit-installed`,
  ].join(" ");
  const result = await runBoatCommand(sandboxId, command, 85);
  const ok = result.exitCode === 0 && /toolkit-(ok|installed)/.test(result.stdout);
  return {
    ok,
    installed: /toolkit-installed/.test(result.stdout),
    detail: ok ? "" : (result.stdout || result.stderr || `exit ${result.exitCode}`).trim().slice(-300),
  };
}

/**
 * Make sure the sender's dedicated Chrome is running with its CDP port open.
 * Starts a separate Chrome instance (own user-data-dir); never kills any other Chrome.
 */
export async function ensureSenderChrome(
  sandboxId: string,
  directoryName: string,
  openUrl = "https://mail.google.com/mail/u/0/#inbox",
) {
  const slug = senderSlug(directoryName);
  const port = senderCdpPort(directoryName);
  const dir = `${CHROME_ROOT}/${slug}`;
  const log = `/tmp/nexuses-chrome-${slug}.log`;
  const probe = `curl -s --max-time 2 http://127.0.0.1:${port}/json/version >/dev/null`;
  const command = [
    `if ${probe}; then echo chrome-running; exit 0; fi;`,
    `mkdir -p ${dir};`,
    `DISPLAY=:0 nohup google-chrome-stable --user-data-dir=${dir} --remote-debugging-port=${port}`,
    `  --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check`,
    `  --disable-dev-shm-usage --password-store=basic --window-size=1400,950 ${shellQuote(openUrl)}`,
    `  >${log} 2>&1 < /dev/null &`,
    `for i in $(seq 1 30); do sleep 1; if ${probe}; then echo chrome-started; exit 0; fi; done;`,
    `echo cdp-unreachable; tail -5 ${log}; exit 1`,
  ].join(" ");
  const result = await runBoatCommand(sandboxId, command, 60);
  const ok = result.exitCode === 0 && /chrome-(running|started)/.test(result.stdout);
  return {
    ok,
    started: /chrome-started/.test(result.stdout),
    port,
    detail: ok ? "" : (result.stdout || result.stderr || `exit ${result.exitCode}`).trim().slice(-300),
  };
}

/** Run one sender script command and parse its single NXS_RESULT line. */
export async function runSenderScript(
  sandboxId: string,
  command: "version" | "check" | "send" | "find_sent",
  args: Record<string, unknown>,
  timeoutSeconds = 85,
): Promise<SenderResult> {
  const budgetMs = Math.max(10, timeoutSeconds - 5) * 1000;
  const argsB64 = Buffer.from(JSON.stringify({ ...args, timeoutMs: budgetMs }), "utf8").toString(
    "base64",
  );
  // Args go through a heredoc file, not argv/env, so big HTML bodies never hit size limits.
  const argsFile = `/tmp/nexuses-sender-args-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.b64`;
  const wrapped = argsB64.replace(/(.{1,76})/g, "$1\n");
  const shell = [
    `cat > ${argsFile} <<'NXS_ARGS_EOF'`,
    wrapped.trimEnd(),
    `NXS_ARGS_EOF`,
    `cd ${TOOLKIT_DIR} && SENDER_ARGS_FILE=${argsFile} timeout ${Math.ceil(budgetMs / 1000) + 3} node sender.mjs ${command} 2>/tmp/nexuses-sender-last.err; rm -f ${argsFile}`,
  ].join("\n");
  try {
    const result = await runBoatCommand(sandboxId, shell, timeoutSeconds);
    const line = result.stdout
      .split("\n")
      .reverse()
      .find((entry) => entry.startsWith("NXS_RESULT "));
    if (!line) {
      return {
        ok: false,
        code: result.timedOut ? "COMMAND_TIMEOUT" : "NO_RESULT",
        message: (result.stdout || result.stderr || "").trim().slice(-300),
      };
    }
    return JSON.parse(line.slice("NXS_RESULT ".length)) as SenderResult;
  } catch (error) {
    return {
      ok: false,
      code: "COMMAND_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Install toolkit, start the sender Chrome, and report sign-in state. No AI. */
export async function prepareAndCheckSender(
  sandboxId: string,
  directoryName: string,
): Promise<SenderResult & { stage: string; port?: number; chromeStarted?: boolean }> {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) {
    return { ok: false, stage: "toolkit", code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  }
  const chrome = await ensureSenderChrome(sandboxId, directoryName);
  if (!chrome.ok) {
    return { ok: false, stage: "chrome", code: "CHROME_START_FAILED", message: chrome.detail };
  }
  const check = await runSenderScript(sandboxId, "check", { port: chrome.port }, 85);
  return { ...check, stage: "check", port: chrome.port, chromeStarted: chrome.started };
}

export type ScriptSendInput = {
  to: string;
  subject: string;
  html: string;
  /** Plain text of the pitch, used to verify the body after insertion. */
  plain: string;
  expectedEmail?: string;
  /** Campaign signature is baked into html: replace Gmail's auto-signature. */
  replaceSignature: boolean;
  /** Search Sent first and skip if this row already went out (retries/resumes). */
  dupCheck?: boolean;
  dryRun?: boolean;
};

/** Text fragments the body must contain after insertion (first lines of the pitch). */
export function bodyExpectations(plain: string, html: string) {
  const lines = String(plain || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4);
  const expectText = lines.slice(0, 2).map((line) => line.slice(0, 50));
  const expectStrong = /<(strong|b)[\s>]/i.test(html) ? 1 : 0;
  return { expectText, expectStrong };
}

/** Send one Gmail message through the sender's dedicated Chrome. No AI. */
export async function sendViaScript(
  sandboxId: string,
  directoryName: string,
  input: ScriptSendInput,
): Promise<SenderResult> {
  // Cheap when current (one marker check); installs/updates the script otherwise.
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) {
    return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail, sendPressed: false };
  }
  const chrome = await ensureSenderChrome(sandboxId, directoryName);
  if (!chrome.ok) {
    return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail, sendPressed: false };
  }
  const { expectText, expectStrong } = bodyExpectations(input.plain, input.html);
  return runSenderScript(
    sandboxId,
    "send",
    {
      port: chrome.port,
      to: input.to,
      subject: input.subject,
      html: input.html,
      plain: input.plain,
      expectedEmail: input.expectedEmail,
      replaceSignature: input.replaceSignature,
      dupCheck: Boolean(input.dupCheck),
      dryRun: Boolean(input.dryRun),
      expectText,
      expectStrong,
    },
    88,
  );
}

/** Look for a recipient + subject in Gmail Sent (duplicate guard / audits). */
export async function findInSentViaScript(
  sandboxId: string,
  directoryName: string,
  to: string,
  subject: string,
  days = 7,
) {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  const chrome = await ensureSenderChrome(sandboxId, directoryName);
  if (!chrome.ok) return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail };
  return runSenderScript(sandboxId, "find_sent", { port: chrome.port, to, subject, days }, 70);
}
