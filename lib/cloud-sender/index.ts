import { runBoatCommand, shellQuote } from "@/lib/boat";
import { SENDER_SCRIPT_SOURCE, SENDER_SCRIPT_VERSION } from "@/lib/cloud-sender/vm-script";
import { SENDER_PROXY_MARKER } from "@/lib/cloud-vpn";

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


export type SenderCommand =
  | "version"
  | "check"
  | "send"
  | "reply"
  | "focus"
  | "find_sent"
  | "read_sheet"
  | "probe_outlook"
  | "inbox_scan"
  | "read_replies";

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
/**
 * Shell function `chpids`: PIDs of the Chrome processes using this profile folder. Looks only at
 * processes named "chrome" and checks their arguments, because a `pgrep -f` on the folder name
 * would also match the shell command running it (which contains the same text) and kill itself.
 */
function chromePidsShell(dir: string) {
  return `chpids() { for p in $(pgrep -x chrome); do tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -qF -- "--user-data-dir=${dir} " && echo $p; done; };`;
}

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
  // VPN (lib/cloud-vpn): when the marker file names a proxy, this sender's Chrome (and only it)
  // goes through the NordVPN relay. A Chrome started with the other setting is restarted once.
  const command = [
    chromePidsShell(dir),
    `WANT=""; [ -s ${SENDER_PROXY_MARKER} ] && WANT=$(head -c 200 ${SENDER_PROXY_MARKER});`,
    `HAS=$(for p in $(chpids); do tr '\\0' '\\n' < /proc/$p/cmdline 2>/dev/null | grep -- '^--proxy-server='; done | head -1 | cut -d= -f2-);`,
    `if ${probe}; then if [ "$WANT" = "$HAS" ]; then echo chrome-running; exit 0; fi;`,
    `  kill $(chpids) 2>/dev/null; for i in 1 2 3 4 5 6; do [ -z "$(chpids)" ] && break; sleep 1; done; fi;`,
    `PROXY_FLAGS=""; if [ -n "$WANT" ]; then PROXY_FLAGS="--proxy-server=$WANT --proxy-bypass-list=<-loopback> --force-webrtc-ip-handling-policy=disable_non_proxied_udp"; fi;`,
    `mkdir -p ${dir};`,
    // A computer that resumed on another machine (or was rebuilt from backup) keeps Chrome's
    // profile lock from the old host, and Chrome then refuses to start. Clear it, but only
    // when no Chrome here is using this profile.
    `if [ -z "$(chpids)" ]; then rm -f ${dir}/SingletonLock ${dir}/SingletonSocket ${dir}/SingletonCookie; fi;`,
    `DISPLAY=:0 nohup google-chrome-stable --user-data-dir=${dir} --remote-debugging-port=${port}`,
    `  --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check`,
    `  --disable-dev-shm-usage --password-store=basic --window-size=1400,950 $PROXY_FLAGS ${shellQuote(openUrl)}`,
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

/**
 * Run one sender script command on the VM and parse its NXS_RESULT line.
 * `background: true` runs it detached and polls for the result, so long jobs (sends with
 * attachments) aren't cut off by the per-command time limit.
 */
export async function runSenderScript(
  sandboxId: string,
  command: SenderCommand,
  args: Record<string, unknown>,
  timeoutSeconds = 85,
  options: { background?: boolean } = {},
): Promise<SenderResult> {
  const budgetMs = Math.max(10, timeoutSeconds - 5) * 1000;
  const argsB64 = Buffer.from(JSON.stringify({ ...args, timeoutMs: budgetMs }), "utf8").toString(
    "base64",
  );
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Args go through a heredoc file, not argv/env, so big HTML bodies never hit size limits.
  const argsFile = `/tmp/nexuses-sender-args-${id}.b64`;
  const outFile = `/tmp/nexuses-sender-out-${id}.txt`;
  const wrapped = argsB64.replace(/(.{1,76})/g, "$1\n");
  const writeArgs = [`cat > ${argsFile} <<'NXS_ARGS_EOF'`, wrapped.trimEnd(), `NXS_ARGS_EOF`];
  const run = `cd ${TOOLKIT_DIR} && SENDER_ARGS_FILE=${argsFile} timeout ${Math.ceil(budgetMs / 1000) + 3} node sender.mjs ${command}`;

  const parse = (stdout: string) => {
    const line = stdout
      .split("\n")
      .reverse()
      .find((entry) => entry.startsWith("NXS_RESULT "));
    return line ? (JSON.parse(line.slice("NXS_RESULT ".length)) as SenderResult) : null;
  };

  try {
    if (!options.background) {
      const result = await runBoatCommand(
        sandboxId,
        [...writeArgs, `${run} 2>/tmp/nexuses-sender-last.err; rm -f ${argsFile}`].join("\n"),
        timeoutSeconds,
      );
      const parsed = parse(result.stdout);
      if (parsed) return parsed;
      return {
        ok: false,
        code: result.timedOut ? "COMMAND_TIMEOUT" : "NO_RESULT",
        message: (result.stdout || result.stderr || "").trim().slice(-300),
      };
    }

    await runBoatCommand(
      sandboxId,
      [
        ...writeArgs,
        `nohup sh -c ${shellQuote(`${run} > ${outFile} 2>/tmp/nexuses-sender-last.err; rm -f ${argsFile}`)} >/dev/null 2>&1 &`,
        `echo started`,
      ].join("\n"),
      20,
    );
    const deadline = Date.now() + budgetMs + 15_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await runBoatCommand(sandboxId, `cat ${outFile} 2>/dev/null | grep NXS_RESULT | tail -1`, 15).catch(
        () => null,
      );
      const parsed = poll ? parse(poll.stdout) : null;
      if (parsed) {
        await runBoatCommand(sandboxId, `rm -f ${outFile}`, 10).catch(() => undefined);
        return parsed;
      }
    }
    return { ok: false, code: "COMMAND_TIMEOUT", message: "No result from the sender in time" };
  } catch (error) {
    return {
      ok: false,
      code: "COMMAND_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Install toolkit, start the sender Chrome, and report sign-in state. No AI. */
export type SenderProvider = "gmail" | "outlook";

export function senderInboxUrl(provider: SenderProvider = "gmail") {
  return provider === "outlook" ? "https://outlook.office.com/mail/" : "https://mail.google.com/mail/u/0/#inbox";
}

export async function prepareAndCheckSender(
  sandboxId: string,
  directoryName: string,
  provider: SenderProvider = "gmail",
): Promise<SenderResult & { stage: string; port?: number; chromeStarted?: boolean }> {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) {
    return { ok: false, stage: "toolkit", code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  }
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl(provider));
  if (!chrome.ok) {
    return { ok: false, stage: "chrome", code: "CHROME_START_FAILED", message: chrome.detail };
  }
  const check = await runSenderScript(sandboxId, "check", { port: chrome.port, provider }, 85);
  return { ...check, stage: "check", port: chrome.port, chromeStarted: chrome.started };
}

/** Close this sender's Chrome and empty its folder (a brand-new sender must start signed out). */
export async function resetSenderChromeDir(sandboxId: string, directoryName: string) {
  const dir = `${CHROME_ROOT}/${senderSlug(directoryName)}`;
  const result = await runBoatCommand(
    sandboxId,
    `${chromePidsShell(dir)} kill $(chpids) 2>/dev/null; sleep 1; rm -rf ${dir} && echo reset-ok`,
    30,
  );
  return /reset-ok/.test(result.stdout);
}

/** Raise this sender's Chrome window above other senders' windows (for signing in). */
export async function focusSenderChrome(sandboxId: string, port: number, provider: SenderProvider = "gmail") {
  return runSenderScript(sandboxId, "focus", { port, provider }, 30);
}

export type ScriptSendInput = {
  provider?: SenderProvider;
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
  /** Outlook: label to pick when the org requires a sensitivity label. */
  sensitivityLabel?: string;
  /** Files already on the VM to attach (see ensureAttachmentsOnVm). */
  attachments?: { path: string; name: string }[];
};

/** Text fragments the body must contain after insertion (first lines of the pitch). */
/** Visible text of the HTML we paste (what Gmail/Outlook will show), entities decoded. */
function htmlVisibleText(html: string) {
  return String(html || "")
    .replace(/<\s*(style|script)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/**
 * What to look for in the editor after pasting. Taken from the rendered HTML, not the raw
 * sheet text: markdown (**bold**, "- " bullets, links) is formatted away when the HTML is
 * built, so the raw text would never be found and a good email would fail its check.
 */
export function bodyExpectations(plain: string, html: string) {
  const source = html ? htmlVisibleText(html) : String(plain || "");
  const lines = source
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
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
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl(input.provider));
  if (!chrome.ok) {
    return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail, sendPressed: false };
  }
  const { expectText, expectStrong } = bodyExpectations(input.plain, input.html);
  return runSenderScript(
    sandboxId,
    "send",
    {
      port: chrome.port,
      provider: input.provider || "gmail",
      to: input.to,
      subject: input.subject,
      html: input.html,
      plain: input.plain,
      expectedEmail: input.expectedEmail,
      replaceSignature: input.replaceSignature,
      dupCheck: Boolean(input.dupCheck),
      sensitivityLabel: input.sensitivityLabel || "",
      dryRun: Boolean(input.dryRun),
      attachments: input.attachments || [],
      expectText,
      expectStrong,
    },
    // Runs in the background: attachments can push a send past the 90 s command limit.
    240,
    { background: true },
  );
}

/**
 * Send a follow-up as a reply in the original thread (opened by Gmail message id when known,
 * else found in Sent by recipient + subject). No AI.
 */
export async function replyViaScript(
  sandboxId: string,
  directoryName: string,
  input: Omit<ScriptSendInput, "attachments"> & { messageId?: string },
): Promise<SenderResult> {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) {
    return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail, sendPressed: false };
  }
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl(input.provider));
  if (!chrome.ok) {
    return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail, sendPressed: false };
  }
  const { expectText, expectStrong } = bodyExpectations(input.plain, input.html);
  return runSenderScript(
    sandboxId,
    "reply",
    {
      port: chrome.port,
      provider: input.provider || "gmail",
      to: input.to,
      subject: input.subject,
      messageId: input.messageId || "",
      html: input.html,
      plain: input.plain,
      expectedEmail: input.expectedEmail,
      replaceSignature: input.replaceSignature,
      dupCheck: Boolean(input.dupCheck),
      sensitivityLabel: input.sensitivityLabel || "",
      dryRun: Boolean(input.dryRun),
      expectText,
      expectStrong,
    },
    240,
    { background: true },
  );
}

/** Look for a recipient + subject in Gmail Sent (duplicate guard / audits). */
export async function findInSentViaScript(
  sandboxId: string,
  directoryName: string,
  to: string,
  subject: string,
  days = 7,
  provider: SenderProvider = "gmail",
) {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl(provider));
  if (!chrome.ok) return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail };
  return runSenderScript(sandboxId, "find_sent", { port: chrome.port, to, subject, days, provider }, 70);
}

/** Read a VM file back in base64 chunks (command output is size-limited). */
async function readVmFile(sandboxId: string, path: string, maxBytes = 2_000_000) {
  const sizeResult = await runBoatCommand(sandboxId, `wc -c < ${shellQuote(path)}`, 15);
  const size = Number(sizeResult.stdout.trim()) || 0;
  if (size <= 0) return "";
  if (size > maxBytes) throw new Error(`The sheet is larger than ${Math.round(maxBytes / 1e6)} MB`);
  const chunk = 120_000;
  const parts: Buffer[] = [];
  for (let offset = 0; offset < size; offset += chunk) {
    const result = await runBoatCommand(
      sandboxId,
      `tail -c +${offset + 1} ${shellQuote(path)} | head -c ${chunk} | base64 -w0`,
      30,
      chunk * 2,
    );
    const b64 = result.stdout.trim();
    if (!b64 || /truncated/.test(b64)) throw new Error("Could not read the sheet back from the computer");
    parts.push(Buffer.from(b64, "base64"));
  }
  const buffer = Buffer.concat(parts);
  if (buffer.length !== size) throw new Error("Sheet read back incompletely; try again");
  return buffer.toString("utf8");
}

/**
 * Read a (possibly private) Google Sheet as CSV through the sender's signed-in Chrome. No AI.
 * Returns the CSV text, or a coded failure (e.g. SHEET_ACCESS_DENIED, LOGIN_REQUIRED).
 */
export async function readSheetViaScript(
  sandboxId: string,
  directoryName: string,
  sheetUrl: string,
): Promise<{ ok: true; csv: string; how: string } | { ok: false; code: string; message?: string }> {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  const chrome = await ensureSenderChrome(sandboxId, directoryName);
  if (!chrome.ok) return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail };
  const outPath = `/tmp/nexuses-sheet-${Date.now()}.csv`;
  const result = await runSenderScript(sandboxId, "read_sheet", { port: chrome.port, sheetUrl, outPath }, 85);
  if (!result.ok) {
    return { ok: false, code: String(result.code || "SHEET_READ_FAILED"), message: result.message };
  }
  try {
    const csv = await readVmFile(sandboxId, outPath);
    return { ok: true, csv, how: String(result.how || "") };
  } catch (error) {
    return {
      ok: false,
      code: "SHEET_READ_BACK_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await runBoatCommand(sandboxId, `rm -f ${shellQuote(outPath)}`, 10).catch(() => undefined);
  }
}

/** Diagnostics: list Outlook compose controls (no send). */
export async function probeOutlookViaScript(sandboxId: string, directoryName: string, to: string) {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl("outlook"));
  if (!chrome.ok) return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail };
  return runSenderScript(sandboxId, "probe_outlook", { port: chrome.port, to }, 85);
}

/** Look in the sender's inbox for replies from, and bounces for, these addresses. Read-only. */
export async function scanInboxViaScript(
  sandboxId: string,
  directoryName: string,
  provider: SenderProvider,
  emails: string[],
  since: string,
): Promise<SenderResult & { replied?: string[]; bounced?: string[]; bounceDetails?: { email: string; reason: string }[] }> {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl(provider));
  if (!chrome.ok) return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail };
  return runSenderScript(sandboxId, "inbox_scan", { port: chrome.port, provider, emails, since }, 88) as Promise<
    SenderResult & { replied?: string[]; bounced?: string[]; bounceDetails?: { email: string; reason: string }[] }
  >;
}

export type CloudReplyMessage = {
  fromEmail: string;
  fromName: string;
  /** As the mail app shows it (e.g. "Wed, Nov 19, 2026, 10:32 AM"); may be empty. */
  date: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Read the newest reply from each address (quoted history removed). Read-only; a thread that was
 * unread is marked unread again. `done` lists the addresses it got through in this call.
 */
export async function readRepliesViaScript(
  sandboxId: string,
  directoryName: string,
  provider: SenderProvider,
  emails: string[],
  since: string,
): Promise<SenderResult & { replies?: CloudReplyMessage[]; done?: string[] }> {
  const toolkit = await ensureSenderToolkit(sandboxId);
  if (!toolkit.ok) return { ok: false, code: "TOOLKIT_INSTALL_FAILED", message: toolkit.detail };
  const chrome = await ensureSenderChrome(sandboxId, directoryName, senderInboxUrl(provider));
  if (!chrome.ok) return { ok: false, code: "CHROME_START_FAILED", message: chrome.detail };
  return runSenderScript(sandboxId, "read_replies", { port: chrome.port, provider, emails, since }, 88) as Promise<
    SenderResult & { replies?: CloudReplyMessage[]; done?: string[] }
  >;
}
