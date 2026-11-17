import { ObjectId } from "mongodb";
import {
  backupProjectSoon,
  boatConfigured,
  ensureCloudBoat,
  getCloudBoatMeta,
  isBoatRunning,
  openBoatDesktop,
  refreshBoatTask,
  runBoatCommand,
  interruptBoatAgent,
  runBoatDesktopTask,
  shellQuote,
  stopCloudBoat,
  type BoatSandbox,
} from "@/lib/boat";
import {
  formatBoatMemoryBlock,
  getProjectBoatMemory,
} from "@/lib/boat-memory";
import {
  CLOUD_SHEET_COLUMNS,
  cloudMailInboxUrl,
  cloudMailProductName,
  type CloudSenderProvider,
  type CloudSheetSample,
} from "@/lib/cloud-campaigns";
import {
  buildCloudPitchHtml,
  CLOUD_FIELDS,
  CLOUD_REQUIRED_FIELDS,
  columnMapStats,
  reconcileColumnMap,
  rowIssue,
  type CloudColumnMap,
  CLOUD_CSV_MAX_CHARS,
  parseCloudCsvText,
  resolveCloudRowFields,
} from "@/lib/cloud-sheet-csv";
import { applyContactVariables } from "@/lib/email-variables";
import { nextAllowedTime, type CloudSchedule } from "@/lib/cloud-schedule";
import { ensureAttachmentsOnVm } from "@/lib/cloud-attachments";
import {
  cloudSentEmails,
  deleteCloudSends,
  discardCloudSend,
  recordCloudInboxEvents,
  markCloudSendSent,
  prepareCloudSend,
  trackCloudHtml,
} from "@/lib/cloud-campaign-tracking";
import {
  prepareAndCheckSender,
  probeOutlookViaScript,
  readSheetViaScript,
  scanInboxViaScript,
  sendViaScript,
  type SenderResult,
} from "@/lib/cloud-sender";
import {
  getBoatDesktopLock,
  getChromeProfile,
  getCloudCampaignDoc,
  lockBoatDesktop,
  markChromeProfileScriptState,
  markChromeProfileVerified,
  setChromeProfileSensitivity,
  getChromeProfileDefaults,
  saveChromeProfileDefaults,
  patchCloudCampaignDoc,
  unlockBoatDesktop,
  type CloudCampaignDoc,
} from "@/lib/cloud-campaigns-server";

const WATCH_MS = 120_000;
const AUTH_WATCH_MS = 180_000;
/** Short watch for sheet → text dump (no compose). */
const READ_ROW_WATCH_MS = 75_000;
/** Compose-only watch once To/Subject/Body are known. */
const COMPOSE_WATCH_MS = 180_000;

export type CloudAuthOutcome = {
  sandbox: BoatSandbox;
  profile: NonNullable<Awaited<ReturnType<typeof getChromeProfile>>>;
  needsLogin: boolean;
  needsOtp: boolean;
  needsUserInput: boolean;
  email: string;
  report: string;
  done: boolean;
  desktopUrl?: string;
};

function resolveSenderProvider(value?: string | null): CloudSenderProvider {
  return value === "outlook" ? "outlook" : "gmail";
}

function clipReport(value: string, max = 4000) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…truncated`;
}

function parseTagged(report: string, tag: string) {
  const match = report.match(new RegExp(`${tag}\\s*[:=]\\s*(.+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

/** Prefer the last tagged line — agents often narrate, then end with STATUS/EMAIL/REPORT. */
function parseLastTagged(report: string, tag: string) {
  const re = new RegExp(`${tag}\\s*[:=]\\s*(.+)`, "gi");
  let match: RegExpExecArray | null;
  let last = "";
  while ((match = re.exec(report)) !== null) {
    last = match[1].trim();
  }
  return last;
}

function campaignHasPeopleList(doc: CloudCampaignDoc) {
  if (!doc.sheetVerifiedAt) return false;
  if (Math.max(0, doc.sheetRowCount || 0) <= 0) return false;
  // CSV uploads have rows stored in the campaign and no sheet URL.
  if (doc.sheetSource === "csv") {
    return Array.isArray(doc.sheetRows) && doc.sheetRows.length > 0;
  }
  return Boolean(doc.sheetUrl?.trim());
}

/** Google's CSV export works without a browser only when the sheet is link-viewable. */
function googleSheetCsvExportUrl(sheetUrl: string) {
  const id = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) return null;
  const gid = sheetUrl.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** Free read of a shared sheet (no desktop agent, no credits). Null when private or unreachable. */
async function tryFetchSheetCsv(sheetUrl: string) {
  const exportUrl = googleSheetCsvExportUrl(sheetUrl);
  if (!exportUrl) return null;
  try {
    const response = await fetch(exportUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (/text\/html/i.test(type)) return null; // login wall
    const text = await response.text();
    if (!text.trim() || text.length > CLOUD_CSV_MAX_CHARS) return null;
    const parsed = parseCloudCsvText(text);
    return parsed.rowCount > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function parseNeedsLogin(report: string) {
  // Prefer STATUS tags. Avoid matching phrases like "signed in" / "sign-in complete".
  const status = parseTagged(report, "STATUS").toLowerCase();
  if (status.includes("needs_login")) return true;
  if (status.startsWith("ready") || status.startsWith("sent")) return false;
  return /needs_login|login wall|not signed in|please sign in|password (prompt|page|required)/i.test(
    report,
  );
}

function parseNeedsOtp(report: string) {
  const status = parseTagged(report, "STATUS").toLowerCase();
  // Do not treat needs_user_input as OTP — that mislabels "missing pitch / help me" pauses.
  if (status.includes("needs_otp")) return true;
  if (status.includes("needs_user_input") || status.includes("needs_login")) return false;
  return /needs_otp|2\s*fa|verification code|authenticator|sms code/i.test(report);
}

function parseNeedsUserInput(report: string) {
  const status = parseTagged(report, "STATUS").toLowerCase();
  if (/needs_user_input/.test(status)) return true;
  return /confirm.*(phone|device)|approve.*(phone|device)|captcha|verify it.?s you/i.test(
    report,
  );
}

function resolveAuthFlags(report: string) {
  const status = parseTagged(report, "STATUS").toLowerCase();
  if (status.startsWith("ready")) {
    return {
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      ready: true,
    };
  }
  const needsUserInput =
    status.includes("needs_user_input") || parseNeedsUserInput(report);
  if (needsUserInput) {
    return {
      needsLogin: false,
      needsOtp: false,
      needsUserInput: true,
      ready: false,
    };
  }
  const needsOtp =
    status.includes("needs_otp") ||
    (!status.includes("needs_login") && parseNeedsOtp(report));
  if (needsOtp) {
    return {
      needsLogin: false,
      needsOtp: true,
      needsUserInput: false,
      ready: false,
    };
  }
  const needsLogin =
    status.includes("needs_login") ||
    status.startsWith("error") ||
    status === "" ||
    parseNeedsLogin(report);
  return {
    needsLogin,
    needsOtp: false,
    needsUserInput: false,
    ready: false,
  };
}

function resolveSendAuthBlock(report: string) {
  const status = parseTagged(report, "STATUS").toLowerCase();
  if (
    status.startsWith("sent") ||
    status.startsWith("failed") ||
    status.startsWith("skipped")
  ) {
    return {
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
    };
  }
  // Check user_input before OTP so STATUS: needs_user_input is not remapped to OTP.
  if (status.includes("needs_user_input") || parseNeedsUserInput(report)) {
    return { needsLogin: false, needsOtp: false, needsUserInput: true };
  }
  if (status.includes("needs_otp") || parseNeedsOtp(report)) {
    return { needsLogin: false, needsOtp: true, needsUserInput: false };
  }
  if (status.includes("needs_login") || parseNeedsLogin(report)) {
    return { needsLogin: true, needsOtp: false, needsUserInput: false };
  }
  return { needsLogin: false, needsOtp: false, needsUserInput: false };
}

export async function assertBoatUnlocked(
  projectId: ObjectId,
  allowCampaignId?: string,
) {
  const lock = await getBoatDesktopLock(projectId);
  if (!lock) return;
  if (allowCampaignId && lock.campaignId === allowCampaignId) return;
  throw new Error(
    `The cloud computer is busy with campaign "${lock.campaignName}". Stop or finish that campaign first — one campaign sends at a time per project.`,
  );
}

async function readySandbox(projectId: ObjectId, allowCampaignId?: string) {
  if (!boatConfigured()) {
    throw new Error("Boat is not set up. An admin needs to add BOAT_API_KEY.");
  }
  await assertBoatUnlocked(projectId, allowCampaignId);
  // Cloud campaigns' own computer; resumes archived disks, poll until running after stop/restart.
  let sandbox = await ensureCloudBoat(projectId);
  for (let attempt = 0; attempt < 8 && !isBoatRunning(sandbox.state); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    sandbox = await ensureCloudBoat(projectId);
  }
  if (!isBoatRunning(sandbox.state)) {
    throw new Error(
      `The computer is ${sandbox.state}. Wait a few seconds, then try Start computer or Resume again.`,
    );
  }
  return sandbox;
}

async function withProjectMemory(projectId: ObjectId, task: string) {
  const memory = await getProjectBoatMemory(projectId).catch(() => null);
  const block = memory ? formatBoatMemoryBlock(memory) : "";
  return block ? `${block}\n${task}` : task;
}

async function runCloudDesktopTask(
  projectId: ObjectId,
  sandboxId: string,
  task: string,
  conversationId: string | null,
  watchMs = WATCH_MS,
  /** Unattended send/read turns: tight prompt, and kill the turn if it overruns. */
  unattended = false,
) {
  const fullTask = await withProjectMemory(projectId, task);
  return runBoatDesktopTask(sandboxId, fullTask, conversationId, watchMs, projectId, {
    strict: unattended,
    interruptOnTimeout: unattended,
  });
}

async function stopBoatAfterCampaignWork(projectId: ObjectId) {
  await stopCloudBoat(projectId).catch((error) => {
    console.warn(
      "Could not stop Boat after campaign work:",
      error instanceof Error ? error.message : error,
    );
  });
  // Keep the saved snapshot (sender logins) fresh; throttled to once every few hours.
  backupProjectSoon(projectId);
}

/**
 * Open a URL in the sender Chrome profile without forcing a new window.
 * If that profile is already running, Chrome reuses the existing window (new tab).
 * Never pkill Chrome or toggle GPU flags — those blank the Boat desktop.
 */
export async function openChromeProfile(
  sandboxId: string,
  directoryName: string,
  url: string,
) {
  const directory = shellQuote(directoryName);
  const target = shellQuote(url);
  const command = [
    "if ! command -v google-chrome-stable >/dev/null; then echo chrome-missing; exit 1; fi;",
    // Reuse a running Chrome; a second cold start often blanks the VNC desktop.
    `if pgrep -f '/opt/google/chrome/chrome' >/dev/null 2>&1; then`,
    `  DISPLAY=:0 google-chrome-stable --profile-directory=${directory} ${target}`,
    `    >/tmp/boat-chrome-cloud.log 2>&1 & echo reused;`,
    `else`,
    `  DISPLAY=:0 nohup google-chrome-stable --no-first-run --disable-dev-shm-usage`,
    `    --profile-directory=${directory} ${target}`,
    `    >/tmp/boat-chrome-cloud.log 2>&1 & echo started;`,
    `  sleep 2;`,
    `fi`,
  ].join(" ");
  return runBoatCommand(sandboxId, command, 20);
}

/** True when a sheet dump looks like a real pitch, not a truncated greeting. */
function pitchLooksComplete(pitch: string) {
  const text = String(pitch || "").trim();
  if (text.length < 80) return false;
  if (/cut off on screen|truncated|layout shifted/i.test(text)) return false;
  // "Hi Name," alone is not enough to send.
  if (/^hi\b[^.]{0,40},?\s*$/i.test(text)) return false;
  return true;
}

function cloudComposeUrl(
  provider: CloudSenderProvider,
  email: string,
  subject: string,
  body = "",
) {
  if (provider === "outlook") {
    const params = new URLSearchParams({ to: email, subject });
    if (body) params.set("body", body);
    return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
  }
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: email,
    su: subject,
  });
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Put rich HTML on the desktop clipboard (text/html) so a Ctrl+V into Gmail/Outlook keeps
 * paragraphs, bold terms, bullet lists and the signature.
 * Boat's image ships xdotool but not xclip, so install it once (the disk keeps it).
 */
async function setBoatClipboardHtml(sandboxId: string, html: string) {
  const b64 = Buffer.from(html, "utf8").toString("base64");
  const command = [
    `if ! command -v xclip >/dev/null; then`,
    `  sudo -n apt-get install -y -qq xclip >/dev/null 2>&1 ||`,
    `  { sudo -n apt-get update -qq >/dev/null 2>&1 && sudo -n apt-get install -y -qq xclip >/dev/null 2>&1; };`,
    `fi;`,
    `command -v xclip >/dev/null || { echo clipboard-tool-missing; exit 1; };`,
    `printf '%s' ${shellQuote(b64)} | base64 -d > /tmp/boat-cloud-clip.html;`,
    // setsid keeps xclip serving the selection after this command returns.
    `DISPLAY=:0 setsid xclip -selection clipboard -t text/html -i /tmp/boat-cloud-clip.html >/dev/null 2>&1 < /dev/null;`,
    `sleep 0.3;`,
    `DISPLAY=:0 xclip -selection clipboard -t text/html -o 2>/dev/null | head -c 20 | grep -q . && echo clipped:$(wc -c < /tmp/boat-cloud-clip.html) || { echo clipboard-verify-failed; exit 1; }`,
  ].join(" ");
  try {
    const result = await runBoatCommand(sandboxId, command, 85);
    const ok = result.exitCode === 0 && /clipped:\d+/.test(result.stdout);
    return {
      ok,
      detail: ok
        ? ""
        : (result.stdout || result.stderr || `exit ${result.exitCode}`).trim().slice(0, 200),
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reuse the already-open Chrome window: navigate its active tab to `url` instead of opening a
 * new tab every row (those stacked up forever). Falls back to a normal open when Chrome is not
 * running yet or no window can be found.
 */
async function navigateChromeActiveTab(
  sandboxId: string,
  directoryName: string,
  url: string,
) {
  const target = shellQuote(url);
  const command = [
    `export DISPLAY=:0;`,
    `W=$(xdotool search --onlyvisible --class chrom 2>/dev/null | head -1);`,
    `if pgrep -f '/opt/google/chrome/chrome' >/dev/null 2>&1 && [ -n "$W" ]; then`,
    `  xdotool windowactivate --sync $W 2>/dev/null; sleep 0.4;`,
    `  xdotool key --clearmodifiers ctrl+l; sleep 0.3;`,
    `  xdotool type --delay 6 --clearmodifiers -- ${target};`,
    `  xdotool key --clearmodifiers Return; echo navigated;`,
    `else echo fallback; fi`,
  ].join(" ");
  const result = await runBoatCommand(sandboxId, command, 30).catch(() => null);
  if (result && /navigated/.test(result.stdout)) return "navigated" as const;
  await openChromeProfile(sandboxId, directoryName, url);
  return "opened" as const;
}

type SentCheck = "confirmed" | "not_found" | "unknown" | "unsupported";

/**
 * Independent proof that the email left: search the Gmail Sent folder in the same Chrome tab,
 * copy the page text and look for the subject. The desktop agent's own "sent" is not trusted.
 */
async function verifyEmailInSentFolder(
  sandboxId: string,
  provider: CloudSenderProvider,
  email: string,
  subject: string,
): Promise<{ state: SentCheck; detail: string }> {
  if (provider !== "gmail" || process.env.CLOUD_VERIFY_SENT === "off") {
    return { state: "unsupported", detail: "" };
  }
  const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(
    `in:sent to:${email} newer_than:1d`,
  )}`;
  const command = [
    `export DISPLAY=:0;`,
    `W=$(xdotool search --onlyvisible --class chrom 2>/dev/null | head -1);`,
    `[ -n "$W" ] || { echo no-window; exit 3; };`,
    `xdotool windowactivate --sync $W 2>/dev/null; sleep 0.4;`,
    `xdotool key --clearmodifiers ctrl+l; sleep 0.3;`,
    `xdotool type --delay 6 --clearmodifiers -- ${shellQuote(searchUrl)};`,
    `xdotool key --clearmodifiers Return; sleep 8;`,
    `xdotool key --clearmodifiers ctrl+a; sleep 0.4; xdotool key --clearmodifiers ctrl+c; sleep 0.6;`,
    `command -v xclip >/dev/null || { echo no-xclip; exit 4; };`,
    `xclip -selection clipboard -o -t text/plain 2>/dev/null | head -c 20000`,
  ].join(" ");
  try {
    const result = await runBoatCommand(sandboxId, command, 60);
    const text = result.stdout.replace(/\s+/g, " ").toLowerCase();
    if (!text.trim() || /^no-(window|xclip)/.test(text.trim())) {
      return { state: "unknown", detail: text.trim().slice(0, 80) || "empty page text" };
    }
    const needle = subject.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);
    if (needle && text.includes(needle)) return { state: "confirmed", detail: "" };
    return { state: "not_found", detail: "" };
  } catch (error) {
    return { state: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Script sender (no AI): install the toolkit on the email VM, start the sender's dedicated
 * Chrome, and report whether it is signed in to Gmail as the campaign's sender.
 */
export async function checkScriptSender(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  if (!doc.profileDirectory) throw new Error("Pick a sender profile first");
  const sandbox = await readySandbox(projectId, campaignId);
  const result = await prepareAndCheckSender(
    sandbox.id,
    doc.profileDirectory,
    resolveSenderProvider(doc.profileProvider),
  );
  const expected = String(doc.profileGmail || "").trim().toLowerCase();
  const email = String(result.email || "").toLowerCase();
  // First sign-in on a brand-new sender has no expected address yet: accept what Gmail shows.
  const matches = Boolean(email && (!expected || expected === email));
  if (doc.profileId && result.ok && result.status === "ready" && matches) {
    const before = await getChromeProfile(projectId, doc.profileId);
    await markChromeProfileScriptState(projectId, doc.profileId, email);
    // A fresh sign-in is exactly what we don't want to lose: back it up now.
    if (before?.scriptEmail !== email) backupProjectSoon(projectId, true);
    await markChromeProfileVerified(projectId, doc.profileId, email);
    if (!expected) await patchCloudCampaignDoc(projectId, campaignId, { profileGmail: email });
  } else if (doc.profileId && result.ok && result.status === "login_required") {
    await markChromeProfileScriptState(projectId, doc.profileId, null);
  }
  const desktopUrl = await openBoatDesktop(sandbox.id).catch(() => "");
  return {
    ...result,
    expectedEmail: expected || undefined,
    accountMatches: result.status === "ready" ? matches : undefined,
    sandboxId: sandbox.id,
    desktopUrl: desktopUrl || undefined,
  };
}

/** Pre-send failures that are safe to retry once right away (nothing was sent). */
const SCRIPT_RETRYABLE = new Set([
  "CDP_UNREACHABLE",
  "CHROME_START_FAILED",
  "COMPOSE_NOT_LOADED",
  "GMAIL_NAVIGATION_FAILED",
  "BODY_INSERT_FAILED",
  "SENT_LIST_NOT_LOADED",
  "NO_BROWSER_CONTEXT",
  "ATTACHMENT_NOT_READY",
]);

function scriptFailureMessage(result: SenderResult, email: string, sender: string) {
  const detail = result.message ? ` (${String(result.message).slice(0, 160)})` : "";
  switch (result.code) {
    case "LOGIN_REQUIRED":
      return `The sender Chrome is signed out. Take control, sign in as ${sender || "the sender"}, then Resume. Nothing was sent.`;
    case "WRONG_ACCOUNT":
      return `The sender Chrome is signed in to a different account${detail}. Sign in as ${sender}, then Resume. Nothing was sent.`;
    case "RECIPIENT_MISMATCH":
    case "SUBJECT_MISMATCH":
      return `The recipient/subject for ${email} didn't fill in correctly${detail}. Nothing was sent; Resume to retry.`;
    case "BODY_VERIFY_FAILED":
    case "BODY_INSERT_FAILED":
      return `The formatted email didn't paste correctly for ${email}${detail}. Nothing was sent; Resume to retry.`;
    case "SENSITIVITY_LABEL_REQUIRED":
      return `Your Outlook organisation requires a sensitivity label on every email. Pick one for this sender in step 2, then Resume. Nothing was sent.`;
    case "SENSITIVITY_LABEL_NOT_FOUND":
      return `The sensitivity label saved for this sender isn't offered by Outlook any more. Pick another in step 2, then Resume. Nothing was sent.`;
    case "ATTACH_INPUT_MISSING":
    case "ATTACHMENT_NOT_READY":
    case "ATTACHMENTS_COPY_FAILED":
      return `Attachments couldn't be added for ${email}${detail}. Nothing was sent; Resume to retry.`;
    case "TOOLKIT_INSTALL_FAILED":
      return `Could not set up the sender on the computer${detail}. Nothing was sent; Resume to retry.`;
    default:
      return `Sending to ${email} stopped before Send (${result.code || "error"})${detail}. Nothing was sent; Resume to retry.`;
  }
}

/**
 * One row through the script sender, with a single safe retry for pre-send failures.
 * A row that might have been sent is never retried blindly: it stays "in flight" and the next
 * attempt checks Gmail Sent first.
 */
async function sendRowWithScript(input: {
  projectId: ObjectId;
  campaignId: string;
  doc: CloudCampaignDoc;
  sandbox: BoatSandbox;
  nextRow: number;
  total: number;
  to: string;
  subject: string;
  html: string;
  plain: string;
  replaceSignature: boolean;
  contact: { firstname: string; lastname: string; company: string; position: string };
  phase: (text: string) => Promise<unknown>;
}) {
  const { projectId, campaignId, doc, sandbox, nextRow, total, to } = input;
  const mailName = cloudMailProductName(resolveSenderProvider(doc.profileProvider));
  const sender = String(doc.profileGmail || "").trim().toLowerCase();
  const dupCheck = doc.inflightRow === nextRow;
  const profile = doc.profileId ? await getChromeProfile(projectId, doc.profileId) : null;
  await patchCloudCampaignDoc(projectId, campaignId, { inflightRow: nextRow });

  // Tracking record for the Report tab (reused if this row is being retried).
  const record = await prepareCloudSend({
    projectId,
    campaignObjectId: doc._id,
    campaignId,
    row: nextRow,
    email: to,
    firstName: input.contact.firstname,
    lastName: input.contact.lastname,
    companyName: input.contact.company,
    position: input.contact.position,
    subject: input.subject,
  });
  const trackedHtml = await trackCloudHtml(
    input.html,
    record.token,
    {
      trackOpens: doc.trackOpens !== false,
      trackClicks: doc.trackClicks === true,
      unsubscribeFooter: doc.unsubscribeFooter === true,
    },
    doc.name,
  );

  let attachments: { path: string; name: string }[] = [];
  if (doc.attachments?.length) {
    await input.phase(`copying ${doc.attachments.length} attachment(s) to the computer…`);
    try {
      attachments = await ensureAttachmentsOnVm(sandbox.id, doc.attachments);
    } catch (error) {
      await discardCloudSend(record.sendId);
      const lastError = scriptFailureMessage(
        { ok: false, code: "ATTACHMENTS_COPY_FAILED", message: error instanceof Error ? error.message : String(error) },
        to,
        sender,
      );
      const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
        status: "paused",
        lastError,
        inflightRow: undefined,
      });
      await unlockBoatDesktop(projectId, campaignId);
      return { campaign, sandbox, done: false, needsLogin: false, needsOtp: false, needsUserInput: false, report: lastError };
    }
  }

  const attempt = (withDupCheck: boolean) =>
    sendViaScript(sandbox.id, doc.profileDirectory || "", {
      attachments,
      provider: resolveSenderProvider(doc.profileProvider),
      to,
      subject: input.subject,
      html: trackedHtml,
      plain: input.plain,
      expectedEmail: sender || undefined,
      replaceSignature: input.replaceSignature,
      dupCheck: withDupCheck,
      sensitivityLabel: profile?.sensitivityLabel,
    });

  await input.phase(
    dupCheck
      ? `checking ${mailName} Sent for ${to} before retrying, then sending…`
      : `sending to ${to} in ${mailName} (no AI)…`,
  );
  let result = await attempt(dupCheck);
  if (!result.ok && !result.sendPressed && SCRIPT_RETRYABLE.has(String(result.code))) {
    await input.phase(`retrying ${to} once (${result.code})…`);
    result = await attempt(dupCheck);
  }

  // Keep the tracking record in step with what really happened.
  const sentForSure = result.ok && (result.status === "sent" || result.status === "already_sent");
  const possiblySent =
    result.sendPressed === true ||
    result.code === "COMMAND_TIMEOUT" ||
    result.code === "NO_RESULT" ||
    result.code === "COMMAND_FAILED";
  if (sentForSure) await markCloudSendSent(record.sendId);
  else if (!possiblySent) await discardCloudSend(record.sendId);

  // Restart/pause while we were working: don't overwrite that state.
  const fresh = await getCloudCampaignDoc(projectId, campaignId);
  if (!fresh || fresh.status !== "sending" || (fresh.nextRow || 0) !== nextRow) {
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {});
    return {
      campaign,
      sandbox,
      done: false,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      report: "Campaign changed while this row was running; result discarded.",
    };
  }

  if (Array.isArray(result.labels) && doc.profileId) {
    await setChromeProfileSensitivity(projectId, doc.profileId, { labels: result.labels as string[] });
  }
  const definitive = result.ok && (result.status === "sent" || result.status === "already_sent");
  if (!definitive) {
    // sendPressed (or unknown because the command died) => possibly sent: keep in-flight.
    const maybeSent = possiblySent;
    const lastError = maybeSent
      ? `Send to ${to} may or may not have gone out (${result.code || "unconfirmed"}). Resume checks ${mailName} Sent first and will not send it twice.`
      : scriptFailureMessage(result, to, sender);
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      status: "paused",
      lastError,
      lastReport: JSON.stringify(result).slice(0, 800),
      inflightRow: maybeSent ? nextRow : undefined,
    });
    await unlockBoatDesktop(projectId, campaignId);
    const needsLogin = result.code === "LOGIN_REQUIRED" || result.code === "WRONG_ACCOUNT";
    return {
      campaign,
      sandbox,
      done: false,
      needsLogin,
      needsOtp: false,
      needsUserInput: false,
      report: lastError,
    };
  }

  const alreadySent = result.status === "already_sent";
  const entry = {
    row: nextRow,
    email: to,
    status: "sent" as const,
    message: alreadySent
      ? `Already in ${mailName} Sent; not sent again.`
      : `Sent via ${mailName}${result.inSent === true ? " · confirmed in Sent" : ""}.`,
    at: new Date().toISOString(),
  };
  const sendLog = [...(fresh.sendLog ?? []), entry].slice(-500);
  const advanced = nextRow + 1;
  const finished = total > 0 && advanced >= total;
  const patch: Partial<CloudCampaignDoc> = {
    nextRow: advanced,
    lastSentAt: new Date(),
    sentCount: fresh.sentCount + (alreadySent ? 0 : 1),
    sendLog,
    lastReport: `Row ${nextRow + 1}${total ? ` of ${total}` : ""}: ${entry.message}`,
    lastError: undefined,
    inflightRow: undefined,
    lockPromptId: undefined,
    lockConversationId: null,
  };
  if (finished) {
    patch.status = "sent";
    await unlockBoatDesktop(projectId, campaignId);
    await stopBoatAfterCampaignWork(projectId);
  }
  const campaign = await patchCloudCampaignDoc(projectId, campaignId, patch);
  return {
    campaign,
    sandbox,
    done: finished,
    needsLogin: false,
    needsOtp: false,
    needsUserInput: false,
    report: entry.message,
  };
}

/**
 * Look in the sender's own inbox for replies from, and bounces for, this campaign's recipients.
 * Read-only; runs on the email computer through the sender's signed-in Chrome (no AI).
 */
export async function checkCloudInbox(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  if (!doc.profileDirectory) throw new Error("This campaign has no sender");
  if (doc.status === "sending") {
    throw new Error("Wait until sending stops — replies are checked on the same computer.");
  }
  const sent = await cloudSentEmails(projectId, campaignId);
  if (!sent.length) {
    await patchCloudCampaignDoc(projectId, campaignId, { inboxCheckedAt: new Date() });
    return { checked: 0, newReplies: 0, newBounces: 0 };
  }
  const earliest = Math.min(...sent.map((s) => (s.sentAt ? new Date(s.sentAt).getTime() : Date.now())));
  const sinceDate = new Date(earliest - 24 * 60 * 60 * 1000);
  const since = `${sinceDate.getUTCFullYear()}/${sinceDate.getUTCMonth() + 1}/${sinceDate.getUTCDate()}`;
  const provider = resolveSenderProvider(doc.profileProvider);
  // The sender's own address can't "reply" (self-sent tests would all look like replies).
  const sender = String(doc.profileGmail || "").trim().toLowerCase();
  const emails = Array.from(new Set(sent.map((s) => s.email))).filter((email) => email !== sender);
  const chunk = provider === "outlook" ? 8 : 60;
  const sandbox = await readySandbox(projectId, campaignId);
  let newReplies = 0;
  let newBounces = 0;
  for (let i = 0; i < emails.length; i += chunk) {
    const result = await scanInboxViaScript(
      sandbox.id,
      doc.profileDirectory,
      provider,
      emails.slice(i, i + chunk),
      since,
    );
    if (!result.ok) {
      const reason =
        result.code === "LOGIN_REQUIRED"
          ? "The sender Chrome is signed out — sign in (step 2), then check again."
          : `Couldn't check the inbox (${result.code || "error"}).`;
      throw new Error(reason);
    }
    const counts = await recordCloudInboxEvents(projectId, campaignId, {
      replied: result.replied || [],
      bounced: result.bounced || [],
    });
    newReplies += counts.replied;
    newBounces += counts.bounced;
  }
  await patchCloudCampaignDoc(projectId, campaignId, { inboxCheckedAt: new Date() });
  return { checked: emails.length, newReplies, newBounces };
}

/** Diagnostics: list Outlook compose controls for this campaign's sender (no send). */
export async function probeOutlookSender(projectId: ObjectId, campaignId: string, to: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc?.profileDirectory) throw new Error("Pick a sender first");
  const sandbox = await readySandbox(projectId, campaignId);
  return probeOutlookViaScript(sandbox.id, doc.profileDirectory, to);
}

/** Diagnostics: read a sheet through the sender Chrome without storing anything. */
export async function readSheetThroughSender(projectId: ObjectId, campaignId: string, sheetUrl: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc?.profileDirectory) throw new Error("Pick a sender first");
  const sandbox = await readySandbox(projectId, campaignId);
  const read = await readSheetViaScript(sandbox.id, doc.profileDirectory, sheetUrl);
  if (!read.ok) return read;
  const parsed = parseCloudCsvText(read.csv);
  return { ok: true as const, how: read.how, rowCount: parsed.rowCount, headers: parsed.headers };
}

/** Save the user's column mapping and recount which rows are ready. */
export async function saveCloudColumnMap(
  projectId: ObjectId,
  campaignId: string,
  input: Record<string, unknown>,
) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  const headers = Array.isArray(doc.sheetHeaders) ? doc.sheetHeaders.map(String) : [];
  const rows = Array.isArray(doc.sheetRows) ? doc.sheetRows : [];
  const columnMap: CloudColumnMap = {};
  for (const field of CLOUD_FIELDS) {
    const header = typeof input[field] === "string" ? String(input[field]).trim() : "";
    if (!header) continue;
    if (!headers.includes(header)) throw new Error(`Column "${header}" isn't in the people list.`);
    columnMap[field] = header;
  }
  if (doc.profileId) await saveChromeProfileDefaults(projectId, doc.profileId, { columnMap });
  return patchCloudCampaignDoc(projectId, campaignId, {
    columnMap,
    columnStats: columnMapStats(rows, columnMap),
  });
}

/** Render one row exactly as it would be sent (subject + HTML), or say why it can't be. */
export async function previewCloudRow(projectId: ObjectId, campaignId: string, rowIndex?: number) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  const rows = Array.isArray(doc.sheetRows) ? doc.sheetRows : [];
  if (!rows.length) throw new Error("Add people first");
  const columnMap: CloudColumnMap = doc.columnMap || {};
  const index =
    typeof rowIndex === "number" && rowIndex >= 0 && rowIndex < rows.length
      ? rowIndex
      : Math.max(0, rows.findIndex((r) => r?.cells && !rowIssue(r.cells, columnMap)));
  const cells = rows[index]?.cells || {};
  const issue = rowIssue(cells, columnMap);
  const { fields, html } = buildRowEmail(cells, String(doc.signatureHtml || "").trim(), columnMap);
  return { row: index, total: rows.length, to: fields.email, subject: fields.subject, html, issue };
}

/** Build the exact HTML/plain body the campaign would send for a row. */
function buildRowEmail(
  rowCells: Record<string, string>,
  signatureHtml: string,
  columnMap: CloudColumnMap = {},
) {
  const fields = resolveCloudRowFields(rowCells, columnMap);
  const html = buildCloudPitchHtml(rowCells, signatureHtml, columnMap);
  const plain = applyContactVariables(
    fields.pitch,
    {
      firstName: fields.firstname,
      lastName: fields.lastname,
      email: fields.email,
      companyName: fields.company,
      position: fields.position,
    },
    false,
  ).trim();
  return { fields, html, plain };
}

/**
 * Send row 1's email to the sender's own address through the script sender.
 * dryRun fills and verifies compose without pressing Send.
 */
export async function testScriptSend(
  projectId: ObjectId,
  campaignId: string,
  options: { dryRun?: boolean; to?: string } = {},
) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  if (!doc.profileDirectory) throw new Error("Pick a sender profile first");
  const sender = String(doc.profileGmail || "").trim().toLowerCase();
  if (!sender.includes("@")) throw new Error("Confirm the sender inbox first");
  const requested = String(options.to || "").trim().toLowerCase();
  if (requested && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested)) {
    throw new Error("Enter a valid email address for the test.");
  }
  const self = requested || sender;
  const columnMap: CloudColumnMap = doc.columnMap || {};
  const rowCells = Array.isArray(doc.sheetRows)
    ? doc.sheetRows.find((r) => r?.cells && !rowIssue(r.cells, columnMap))?.cells
    : null;
  if (!rowCells) throw new Error("No ready people row to build a test email from — check the column mapping (step 4).");
  const signatureHtml = String(doc.signatureHtml || "").trim();
  const { fields, html, plain } = buildRowEmail(rowCells, signatureHtml, columnMap);
  const sandbox = await readySandbox(projectId, campaignId);
  const profile = doc.profileId ? await getChromeProfile(projectId, doc.profileId) : null;
  const attachments = doc.attachments?.length ? await ensureAttachmentsOnVm(sandbox.id, doc.attachments) : [];
  const result = await sendViaScript(sandbox.id, doc.profileDirectory, {
    attachments,
    sensitivityLabel: profile?.sensitivityLabel,
    provider: resolveSenderProvider(doc.profileProvider),
    to: self,
    subject: `[Test] ${fields.subject || "Cloud campaign test"}`,
    html,
    plain,
    expectedEmail: sender,
    replaceSignature: Boolean(signatureHtml),
    dryRun: Boolean(options.dryRun),
  });
  if (Array.isArray(result.labels) && doc.profileId) {
    await setChromeProfileSensitivity(projectId, doc.profileId, { labels: result.labels as string[] });
  }
  const desktopUrl = await openBoatDesktop(sandbox.id).catch(() => "");
  return { ...result, to: self, desktopUrl: desktopUrl || undefined };
}

export async function startCloudComputer(projectId: ObjectId, campaignId: string) {
  const sandbox = await readySandbox(projectId, campaignId);
  const desktopUrl = await openBoatDesktop(sandbox.id);
  await patchCloudCampaignDoc(projectId, campaignId, {
    computerReady: true,
    lastError: undefined,
  });
  return {
    sandbox,
    desktopUrl,
    replacedDeletedDisk: sandbox.replacedDeletedDisk === true,
    restoredFromSnapshot: (sandbox as { restoredFromSnapshot?: boolean }).restoredFromSnapshot === true,
  };
}

export async function prepareChromeProfileLogin(
  projectId: ObjectId,
  profileId: string,
  campaignId?: string,
) {
  const profile = await getChromeProfile(projectId, profileId);
  if (!profile) {
    throw new Error("Sender profile not found");
  }
  const provider = resolveSenderProvider(profile.provider);
  const mailName = cloudMailProductName(provider);
  const inboxUrl = cloudMailInboxUrl(provider);
  const sandbox = await readySandbox(projectId, campaignId);
  await openChromeProfile(sandbox.id, profile.directoryName, inboxUrl);
  const task = `Open ${mailName} web mail in the Chrome window for profile directory "${profile.directoryName}".
URL if needed: ${inboxUrl}
If you see a sign-in page or password prompt, stop and reply with:
STATUS: needs_login
EMAIL: (blank or the address shown)
REPORT: short note for the user

If the ${mailName} inbox is already open and logged in, reply with:
STATUS: ready
EMAIL: the signed-in email address
REPORT: one short sentence confirming the inbox is open

Do not create drafts or send mail.`;
  const result = await runCloudDesktopTask(projectId, sandbox.id, task, null, WATCH_MS);
  const report = clipReport(result.report || result.status);
  const flags = resolveAuthFlags(report);
  const email =
    parseTagged(report, "EMAIL").replace(/[<>]/g, "").trim().toLowerCase() ||
    profile.gmail ||
    "";
  if (flags.ready && email.includes("@")) {
    await markChromeProfileVerified(projectId, profileId, email);
  }
  const desktopUrl = await openBoatDesktop(sandbox.id).catch(() => "");
  return {
    sandbox,
    profile,
    needsLogin: flags.needsLogin,
    needsOtp: flags.needsOtp,
    needsUserInput: flags.needsUserInput,
    email,
    report,
    done: result.done,
    desktopUrl: desktopUrl || undefined,
  };
}

async function finishChromeAuthResult(
  projectId: ObjectId,
  profileId: string,
  profile: NonNullable<Awaited<ReturnType<typeof getChromeProfile>>>,
  sandbox: BoatSandbox,
  result: Awaited<ReturnType<typeof runBoatDesktopTask>>,
  fallbackEmail: string,
): Promise<CloudAuthOutcome> {
  const report = clipReport(result.report || result.status);
  const flags = resolveAuthFlags(report);
  const email =
    parseTagged(report, "EMAIL").replace(/[<>]/g, "").trim().toLowerCase() ||
    fallbackEmail;
  if (flags.ready && email.includes("@")) {
    await markChromeProfileVerified(projectId, profileId, email);
  }
  const desktopUrl = await openBoatDesktop(sandbox.id).catch(() => "");
  return {
    sandbox,
    profile,
    needsLogin: flags.needsLogin,
    needsOtp: flags.needsOtp,
    needsUserInput: flags.needsUserInput,
    email,
    report,
    done: result.done,
    desktopUrl: desktopUrl || undefined,
  };
}

export async function signInChromeProfileOnBoat(
  projectId: ObjectId,
  profileId: string,
  campaignId: string | undefined,
  credentials: { email: string; password: string },
): Promise<CloudAuthOutcome> {
  const email = credentials.email.trim().toLowerCase();
  const password = credentials.password;
  if (!email.includes("@") || !password) {
    throw new Error("Email and password are required");
  }
  const profile = await getChromeProfile(projectId, profileId);
  if (!profile) {
    throw new Error("Sender profile not found");
  }
  const provider = resolveSenderProvider(profile.provider);
  const mailName = cloudMailProductName(provider);
  const inboxUrl = cloudMailInboxUrl(provider);
  const sandbox = await readySandbox(projectId, campaignId);
  await openChromeProfile(sandbox.id, profile.directoryName, inboxUrl);

  const task = `Sign in to ${mailName} web mail in the Chrome window for profile directory "${profile.directoryName}".
URL if needed: ${inboxUrl}

Use these credentials exactly once (type them into the sign-in form; do not store them):
EMAIL_TO_TYPE: ${email}
PASSWORD_TO_TYPE: ${password}

Steps:
1. If already signed into the ${mailName} inbox for ${email}, skip typing and go to ready.
2. Otherwise complete the email/password sign-in for that account on the page you see.
3. If a 2FA / SMS / authenticator / email verification CODE field appears, stop immediately. Do not invent a code.
4. If the page asks the user to confirm on a phone, approve a device prompt, solve a captcha, or otherwise needs a human outside this computer, stop with needs_user_input.
5. If the ${mailName} inbox loads successfully, stop with ready.

Reply exactly in this shape (never repeat the password or any verification code in REPORT):
STATUS: ready OR needs_otp OR needs_user_input OR needs_login OR error
EMAIL: the signed-in address if known, else ${email}
REPORT: one short sentence for the user

Do not create drafts or send mail.`;

  const result = await runCloudDesktopTask(
    projectId,
    sandbox.id,
    task,
    null,
    AUTH_WATCH_MS,
  );
  return finishChromeAuthResult(
    projectId,
    profileId,
    profile,
    sandbox,
    result,
    email || profile.gmail,
  );
}

export async function submitChromeProfileAuthCode(
  projectId: ObjectId,
  profileId: string,
  campaignId: string | undefined,
  input: { code: string },
): Promise<CloudAuthOutcome> {
  const code = input.code.trim();
  if (!code) {
    throw new Error("Verification code is required");
  }
  const profile = await getChromeProfile(projectId, profileId);
  if (!profile) {
    throw new Error("Sender profile not found");
  }
  const provider = resolveSenderProvider(profile.provider);
  const mailName = cloudMailProductName(provider);
  const inboxUrl = cloudMailInboxUrl(provider);
  const sandbox = await readySandbox(projectId, campaignId);

  const task = `Continue ${mailName} sign-in in the Chrome window for profile directory "${profile.directoryName}".
The page should already show a verification / 2FA / OTP / SMS / authenticator code field.
CODE_TO_TYPE: ${code}

Steps:
1. Focus the code field, type the code exactly, and click Next / Verify / Continue as needed.
2. If another code is requested, stop with needs_otp.
3. If a phone confirmation, captcha, or other human step is required, stop with needs_user_input.
4. If password is needed again, stop with needs_login.
5. If the ${mailName} inbox is open (${inboxUrl}), stop with ready.

Reply exactly in this shape (never repeat the code in REPORT):
STATUS: ready OR needs_otp OR needs_user_input OR needs_login OR error
EMAIL: the signed-in address if known
REPORT: one short sentence for the user

Do not create drafts or send mail.`;

  const result = await runCloudDesktopTask(
    projectId,
    sandbox.id,
    task,
    null,
    AUTH_WATCH_MS,
  );
  return finishChromeAuthResult(
    projectId,
    profileId,
    profile,
    sandbox,
    result,
    profile.gmail,
  );
}

/** Parse and store a CSV people list (no Boat / no Google Sheet vision). */
export async function verifyCloudCsv(
  projectId: ObjectId,
  campaignId: string,
  input: { csvText: string; fileName?: string },
) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) {
    throw new Error("Campaign not found");
  }

  const { parseCloudCsvText } = await import("@/lib/cloud-sheet-csv");
  const parsed = parseCloudCsvText(input.csvText);
  // The sender's last confirmed mapping is reused when the columns match.
  const senderMap = (await getChromeProfileDefaults(projectId, doc.profileId))?.columnMap;
  const fileName = (input.fileName || "").trim().slice(0, 200) || "upload.csv";
  const report = `CSV ${fileName}: ${parsed.rowCount} rows · columns ${parsed.headers.join(", ")}`;

  await patchCloudCampaignDoc(projectId, campaignId, {
    sheetSource: "csv",
    sheetFileName: fileName,
    sheetUrl: undefined,
    sheetHeaders: parsed.headers,
    ...(() => {
      const columnMap = reconcileColumnMap(doc.columnMap || senderMap, parsed.headers, parsed.rows);
      return { columnMap, columnStats: columnMapStats(parsed.rows, columnMap) };
    })(),
    sheetRowCount: parsed.rowCount,
    sheetSamples: parsed.samples,
    sheetRows: parsed.rows,
    sheetVerifiedAt: new Date(),
    nextRow: 0,
    sentCount: 0,
    failedCount: 0,
    inflightRow: undefined,
    lastReport: report,
    lastError: undefined,
    status: doc.status === "sending" ? doc.status : "ready",
  });

  return {
    ok: true as const,
    needsLogin: false,
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    samples: parsed.samples,
    missingExpected: parsed.missingExpected,
    report,
    fileName,
  };
}

/** Verify a Google Sheet link via Boat (visible columns only). */
export async function verifyCloudSheet(
  projectId: ObjectId,
  campaignId: string,
  sheetUrl: string,
) {
  const url = sheetUrl.trim();
  if (!url) {
    throw new Error("Paste a Google Sheet link first");
  }
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc?.profileDirectory) {
    throw new Error("Pick a sender profile before verifying the sheet");
  }

  const senderMap = (await getChromeProfileDefaults(projectId, doc.profileId))?.columnMap;
  // 1) Link-shared sheets: read server-side. Free, instant.
  // 2) Private sheets: read through the sender's signed-in Chrome as CSV (no AI).
  let exported = await tryFetchSheetCsv(url);
  if (!exported && process.env.CLOUD_SENDER !== "agent") {
    const sandbox = await readySandbox(projectId, campaignId);
    const read = await readSheetViaScript(sandbox.id, doc.profileDirectory, url);
    const sender = String(doc.profileGmail || "the sender").trim();
    if (!read.ok) {
      const lastError =
        read.code === "LOGIN_REQUIRED"
          ? `The sender Chrome isn't signed in to Google. Sign in (step 2), then verify again — or upload a CSV.`
          : read.code === "SHEET_ACCESS_DENIED"
            ? `${sender} can't open this sheet. Share it with ${sender} (or set "anyone with the link can view"), then verify again — or upload a CSV.`
            : `Couldn't read the sheet (${read.code}${read.message ? `: ${String(read.message).slice(0, 120)}` : ""}). Try again, or upload a CSV.`;
      await patchCloudCampaignDoc(projectId, campaignId, { lastError, lastReport: lastError });
      return {
        ok: false as const,
        needsLogin: false,
        needsOtp: false,
        needsUserInput: false,
        headers: [] as string[],
        rowCount: 0,
        samples: [] as CloudSheetSample[],
        report: lastError,
        sheetUrl: url,
      };
    }
    const parsed = parseCloudCsvText(read.csv);
    if (parsed.rowCount <= 0) {
      const lastError = "The sheet has no people rows (only a header, or empty).";
      await patchCloudCampaignDoc(projectId, campaignId, { lastError, lastReport: lastError });
      return {
        ok: false as const,
        needsLogin: false,
        needsOtp: false,
        needsUserInput: false,
        headers: parsed.headers,
        rowCount: 0,
        samples: [] as CloudSheetSample[],
        report: lastError,
        sheetUrl: url,
      };
    }
    exported = parsed;
  }
  if (exported) {
    const summary = `Sheet verified: ${exported.rowCount} rows · columns ${exported.headers.join(", ")}`;
    await patchCloudCampaignDoc(projectId, campaignId, {
      sheetSource: "sheet",
      sheetUrl: url,
      sheetFileName: undefined,
      sheetHeaders: exported.headers,
      ...(() => {
        const columnMap = reconcileColumnMap(doc.columnMap || senderMap, exported.headers, exported.rows);
        return { columnMap, columnStats: columnMapStats(exported.rows, columnMap) };
      })(),
      sheetRowCount: exported.rowCount,
      sheetSamples: exported.samples,
      sheetRows: exported.rows,
      sheetVerifiedAt: new Date(),
      nextRow: 0,
      sentCount: 0,
      failedCount: 0,
      inflightRow: undefined,
      lastReport: summary,
      lastError: undefined,
      status: doc.status === "sending" ? doc.status : "ready",
    });
    return {
      ok: true as const,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      headers: exported.headers,
      rowCount: exported.rowCount,
      samples: exported.samples,
      report: summary,
      sheetUrl: url,
    };
  }

  const sandbox = await readySandbox(projectId, campaignId);
  await openChromeProfile(sandbox.id, doc.profileDirectory, url);
  const expected = CLOUD_SHEET_COLUMNS.join(", ");
  const task = `In the Chrome window for profile "${doc.profileDirectory}", open this Google Sheet if it is not already open:
${url}

Discover the sheet carefully.
READ RULES (critical):
- Read ONLY visible columns. Ignore hidden, greyed-out, or collapsed columns.
- Use the first header row only, left-to-right, one cell per visible header.
- Do not invent merged spans or combine adjacent cells.
- There is NO fixed template.

Recommended (but NOT required) columns people often use: ${expected}.
Also accept close variants (e.g. first name, e-mail, dept, department, industry, body, message).

Reply exactly in this shape:
STATUS: ready OR needs_login OR error
HEADERS: comma-separated visible header names, in left-to-right order
ROW_COUNT: number of people rows excluding the header
SAMPLE_1: cell values for the first data row, same order as HEADERS, separated by " %% " (space-percent-percent-space). Do NOT use pipe | as a separator.
SAMPLE_2: cell values for the second data row, same order as HEADERS, separated by " %% " (or blank if only one row)
REPORT: one short sentence about what you found

Do not fail just because a recommended column is missing.
Do not send email. Do not edit the sheet.`;

  const result = await runCloudDesktopTask(projectId, sandbox.id, task, null, WATCH_MS, true);
  const report = clipReport(result.report || result.status);
  const status = parseTagged(report, "STATUS").toLowerCase() || "error";
  const headers = parseTagged(report, "HEADERS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const rowCount = Math.max(0, Number(parseTagged(report, "ROW_COUNT")) || 0);
  const samples = [parseTagged(report, "SAMPLE_1"), parseTagged(report, "SAMPLE_2")]
    .filter(Boolean)
    .map((line): CloudSheetSample => {
      const values = /\s*%%\s*/.test(line)
        ? line.split(/\s*%%\s*/).map((part) => part.trim())
        : line.split("|").map((part) => part.trim());
      const cells: Record<string, string> = {};
      headers.forEach((header, index) => {
        cells[header] = values[index] ?? "";
      });
      return { cells };
    });

  const flags = resolveAuthFlags(report);
  if (flags.needsLogin || flags.needsOtp || flags.needsUserInput) {
    return {
      ok: false as const,
      needsLogin: flags.needsLogin,
      needsOtp: flags.needsOtp,
      needsUserInput: flags.needsUserInput,
      headers,
      rowCount,
      samples,
      report,
      sheetUrl: url,
    };
  }

  if (!status.startsWith("ready") || headers.length === 0 || rowCount <= 0) {
    await patchCloudCampaignDoc(projectId, campaignId, {
      lastReport: report,
      lastError: "Could not verify the Google Sheet. Check the link and try again.",
    });
    return {
      ok: false as const,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      headers,
      rowCount,
      samples,
      report,
      sheetUrl: url,
    };
  }

  const summary = `Sheet verified: ${rowCount} rows · columns ${headers.join(", ")}`;
  await patchCloudCampaignDoc(projectId, campaignId, {
    sheetSource: "sheet",
    sheetUrl: url,
    sheetFileName: undefined,
    sheetHeaders: headers,
    sheetRowCount: rowCount,
    sheetSamples: samples,
    sheetRows: undefined,
    sheetVerifiedAt: new Date(),
    nextRow: 0,
    lastReport: summary,
    lastError: undefined,
    status: doc.status === "sending" ? doc.status : "ready",
  });

  return {
    ok: true as const,
    needsLogin: false,
    needsOtp: false,
    needsUserInput: false,
    headers,
    rowCount,
    samples,
    report: summary,
    sheetUrl: url,
  };
}

/** Boat/Claude/Codex quota or provider failures — agent cannot drive the desktop. */
function detectAgentProviderFailure(report: string) {
  const text = String(report || "").trim();
  if (!text) return null;
  if (
    /reached your specified API usage limits/i.test(text) ||
    /API usage limits/i.test(text) ||
    /rate limit/i.test(text) ||
    /insufficient[_ ]quota/i.test(text) ||
    /you will regain access on/i.test(text)
  ) {
    const until = text.match(/regain access on ([^.]+)/i)?.[1]?.trim();
    return until
      ? `Desktop agent hit its API usage limit (regains access ${until}). Raise the limit in Boat / the model provider, or wait — Chrome tabs can still open, but mail will not send until the agent works again.`
      : "Desktop agent hit its API usage limit. Raise the limit in Boat / the model provider, or wait — Chrome tabs can still open, but mail will not send until the agent works again.";
  }
  if (/API Error:\s*4\d\d/i.test(text) || /^API Error:/i.test(text)) {
    return `Desktop agent API error: ${text.slice(0, 280)}`;
  }
  if (/provider_not_configured|desktop agent is not connected/i.test(text)) {
    return text.slice(0, 280);
  }
  return null;
}

function parseSendResult(report: string) {
  let status = parseLastTagged(report, "STATUS").toLowerCase();
  // "sent OR failed OR skipped…" is the prompt's own template, not an answer.
  if (/\bor\b|\|/.test(status)) status = "";
  const email = parseLastTagged(report, "EMAIL").replace(/[<>]/g, "").trim().toLowerCase();
  const row = Number(parseLastTagged(report, "ROW")) || 0;
  const message = parseLastTagged(report, "REPORT");
  if (status.startsWith("sent")) {
    return { status: "sent" as const, email, row, message };
  }
  if (status.startsWith("skipped")) {
    return { status: "skipped" as const, email, row, message };
  }
  if (status.startsWith("failed")) {
    return {
      status: "failed" as const,
      email,
      row,
      message: message || report.slice(0, 240),
    };
  }
  const providerFailure = detectAgentProviderFailure(report);
  if (providerFailure) {
    return {
      status: "incomplete" as const,
      email,
      row,
      message: providerFailure,
    };
  }
  // Mid-task narration / timeout without a final STATUS — do not treat as a real failure.
  return {
    status: "incomplete" as const,
    email,
    row,
    message:
      message ||
      "Send did not finish with STATUS: sent/failed/skipped. The row was not advanced — resume to retry.",
  };
}

export async function sendNextCloudRow(
  projectId: ObjectId,
  campaignId: string,
): Promise<{
  campaign: Awaited<ReturnType<typeof patchCloudCampaignDoc>>;
  sandbox: BoatSandbox;
  done: boolean;
  needsLogin: boolean;
  needsOtp: boolean;
  needsUserInput: boolean;
  report: string;
}> {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) {
    throw new Error("Campaign not found");
  }
  if (doc.status !== "sending") {
    throw new Error("Campaign is not sending");
  }
  if (!doc.profileDirectory) {
    throw new Error("Campaign is missing a sender profile");
  }
  const sheetUrl = String(doc.sheetUrl || "").trim();
  if (!campaignHasPeopleList(doc)) {
    throw new Error(
      doc.sheetSource === "csv" ? "Upload the people CSV first" : "Verify the Google Sheet first",
    );
  }

  const provider = resolveSenderProvider(doc.profileProvider);
  const mailName = cloudMailProductName(provider);

  const sandbox = await readySandbox(projectId, campaignId);
  await lockBoatDesktop(projectId, campaignId, doc.name);
  // A previous turn must never still be running (two agents on one screen = wasted credits).
  if (doc.lockConversationId) {
    await interruptBoatAgent(sandbox.id, doc.lockConversationId).catch(() => undefined);
  }

  const nextRow = Math.max(0, doc.nextRow || 0);
  const total = Math.max(0, doc.sheetRowCount || 0);
  // Live progress for the UI so a long step never looks like a hang.
  const phase = (text: string) =>
    patchCloudCampaignDoc(projectId, campaignId, {
      lastReport: `Row ${nextRow + 1}${total ? ` of ${total}` : ""}: ${text}`,
    }).catch(() => undefined);
  await phase("starting…");
  if (total > 0 && nextRow >= total) {
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      status: "sent",
      lastError: undefined,
      lastReport: "All rows finished.",
    });
    await unlockBoatDesktop(projectId, campaignId);
    await stopBoatAfterCampaignWork(projectId);
    return {
      campaign,
      sandbox,
      done: true,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      report: "All rows finished.",
    };
  }

  const sheetHeaders =
    Array.isArray(doc.sheetHeaders) && doc.sheetHeaders.length
      ? doc.sheetHeaders.map(String)
      : [...CLOUD_SHEET_COLUMNS];
  const headersList = sheetHeaders.join(", ");

  const signatureHtml = String(doc.signatureHtml || "").trim();
  const customPrompt = String(doc.customPrompt || "").trim();
  // The user-confirmed column mapping (falls back to header-name matching for old campaigns).
  const columnMap: CloudColumnMap = doc.columnMap || {};
  const storedCells =
    Array.isArray(doc.sheetRows) && doc.sheetRows[nextRow]?.cells ? doc.sheetRows[nextRow]!.cells : null;

  // Stored rows (CSV upload, free sheet export, or an earlier read) are complete.
  let rowCells: Record<string, string> | null =
    storedCells && !rowIssue(storedCells, columnMap) ? { ...storedCells } : null;

  // Row not stored at all (e.g. sheet changed size): re-read the shared sheet for free.
  if (!rowCells && !storedCells && sheetUrl && doc.sheetSource !== "csv") {
    const parsed = await tryFetchSheetCsv(sheetUrl);
    const cells = parsed?.rows[nextRow]?.cells;
    if (parsed && cells) {
      await patchCloudCampaignDoc(projectId, campaignId, {
        sheetRows: parsed.rows,
        sheetRowCount: parsed.rowCount,
      });
      if (!rowIssue(cells, columnMap)) rowCells = { ...cells };
    }
  }

  // Private sheet: refresh rows through the sender's signed-in Chrome (no AI).
  if (!rowCells && !storedCells && sheetUrl && doc.sheetSource !== "csv" && process.env.CLOUD_SENDER !== "agent") {
    await phase("re-reading the sheet through the sender Chrome…");
    const read = await readSheetViaScript(sandbox.id, doc.profileDirectory, sheetUrl);
    if (read.ok) {
      const parsed = parseCloudCsvText(read.csv);
      if (parsed.rowCount > 0) {
        await patchCloudCampaignDoc(projectId, campaignId, {
          sheetRows: parsed.rows,
          sheetRowCount: parsed.rowCount,
        });
        const cells = parsed.rows[nextRow]?.cells;
        if (cells && !rowIssue(cells, columnMap)) rowCells = { ...cells };
      }
    }
  }

  // Still no usable row: skip it with a reason instead of stopping the whole campaign.
  if (!rowCells && process.env.CLOUD_SENDER !== "agent") {
    const cells = storedCells || undefined;
    const preview = cells ? resolveCloudRowFields(cells, columnMap) : null;
    const reason = !cells ? "Row could not be read." : rowIssue(cells, columnMap) || "Row could not be read.";
    const entry = {
      row: nextRow,
      email: preview?.email || "",
      status: "skipped" as const,
      message: reason,
      at: new Date().toISOString(),
    };
    const advanced = nextRow + 1;
    const finished = total > 0 && advanced >= total;
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      nextRow: advanced,
      sendLog: [...(doc.sendLog ?? []), entry].slice(-500),
      lastReport: `Row ${nextRow + 1}${total ? ` of ${total}` : ""}: skipped — ${reason}`,
      lastError: undefined,
      ...(finished ? { status: "sent" as const } : {}),
    });
    if (finished) {
      await unlockBoatDesktop(projectId, campaignId);
      await stopBoatAfterCampaignWork(projectId);
    }
    return {
      campaign,
      sandbox,
      done: finished,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      report: entry.message,
    };
  }

  // Agent mode only: dump the next row as text first (no compose in that turn).
  if (!rowCells) {
    if (!sheetUrl) {
      throw new Error(`Row ${nextRow + 1} has no usable email, or its pitch is empty or only a greeting. Check which column is mapped to the pitch (Outreach Pitch / Body / Message).`);
    }
    const readTask = `Read ONE row from a Google Sheet in Chrome profile "${doc.profileDirectory}". Do not send or compose anything.
Sheet: ${sheetUrl}
Columns: ${headersList}
Row (0-based, header excluded): ${nextRow}

Reuse the open Chrome (never kill or relaunch it) and switch to the sheet tab. Get the FULL pitch text: double-click the pitch cell or copy it from the formula bar. Don't click cell by cell. Ignore the yellow "API keys are missing" banner.

Reply with exactly:
STATUS: ready | needs_login | error
EMAIL: ...
SUBJECT: ...
PITCH: ...the whole email body...
FIRSTNAME: ...
LASTNAME: ...
COMPANY: ...
POSITION: ...
REPORT: one short sentence`;

    const readResult = await runCloudDesktopTask(
      projectId,
      sandbox.id,
      readTask,
      null,
      READ_ROW_WATCH_MS,
      true,
    );
    const readReport = clipReport(readResult.report || readResult.status);
    const readAuth = resolveSendAuthBlock(readReport);
    if (readAuth.needsLogin || readAuth.needsOtp || readAuth.needsUserInput) {
      const reason = readAuth.needsOtp
        ? `${mailName} needs a verification code.`
        : readAuth.needsUserInput
          ? `${mailName} needs you to finish a step on the computer.`
          : `${mailName} needs a sign-in on the computer.`;
      const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
        status: "paused",
        lastError: reason,
        lastReport: readReport,
        lockPromptId: readResult.promptId,
        lockConversationId: null,
      });
      await unlockBoatDesktop(projectId, campaignId);
      return {
        campaign,
        sandbox,
        done: false,
        needsLogin: readAuth.needsLogin,
        needsOtp: readAuth.needsOtp,
        needsUserInput: readAuth.needsUserInput,
        report: readReport,
      };
    }

    let readStatus = parseLastTagged(readReport, "STATUS").toLowerCase();
    if (/\bor\b|\|/.test(readStatus)) readStatus = ""; // echoed template, not an answer
    const email = parseLastTagged(readReport, "EMAIL").replace(/[<>]/g, "").trim();
    const subject = parseLastTagged(readReport, "SUBJECT").trim();
    const pitch = parseLastTagged(readReport, "PITCH").trim();
    if (
      !readStatus.startsWith("ready") ||
      !email.includes("@") ||
      !pitchLooksComplete(pitch)
    ) {
      const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
        status: "paused",
        lastError:
          "Sheet row read was incomplete (pitch too short or missing). Resume to retry the text dump — do not type into Gmail yet.",
        lastReport: readReport,
        lockPromptId: readResult.promptId,
        lockConversationId: null,
      });
      await unlockBoatDesktop(projectId, campaignId);
      return {
        campaign,
        sandbox,
        done: false,
        needsLogin: false,
        needsOtp: false,
        needsUserInput: false,
        report: readReport,
      };
    }

    rowCells = {
      Email: email,
      "Subject Line": subject,
      "Outreach Pitch": pitch,
      "First Name": parseLastTagged(readReport, "FIRSTNAME").trim(),
      "Last Name": parseLastTagged(readReport, "LASTNAME").trim(),
      Company: parseLastTagged(readReport, "COMPANY").trim(),
      Position: parseLastTagged(readReport, "POSITION").trim(),
    };
    const rows = Array.isArray(doc.sheetRows) ? [...doc.sheetRows] : [];
    while (rows.length < nextRow) rows.push({ cells: {} });
    rows[nextRow] = { cells: rowCells };
    await patchCloudCampaignDoc(projectId, campaignId, { sheetRows: rows });
  }

  const fields = resolveCloudRowFields(rowCells, columnMap);
  const bodyPlain = applyContactVariables(
    fields.pitch,
    {
      firstName: fields.firstname,
      lastName: fields.lastname,
      email: fields.email,
      companyName: fields.company,
      position: fields.position,
    },
    false,
  ).trim();

  // Formatting: the pitch goes through the same pitchToHtml path as Personalise (paragraphs,
  // bold company/product terms, bullet lists, sign-off + signature) and is pasted as rich HTML.
  // To + Subject come from the compose URL (never typed into Gmail's To chips).
  const bodyHtml = buildCloudPitchHtml(rowCells, signatureHtml, columnMap);

  // Gmail: deterministic script sender (no AI). Outlook, or CLOUD_SENDER=agent, keeps the
  // desktop-agent path below.
  if (process.env.CLOUD_SENDER !== "agent") {
    return sendRowWithScript({
      projectId,
      campaignId,
      doc,
      sandbox,
      nextRow,
      total,
      to: fields.email,
      subject: fields.subject,
      html: bodyHtml,
      plain: bodyPlain,
      replaceSignature: Boolean(signatureHtml),
      contact: {
        firstname: fields.firstname,
        lastname: fields.lastname,
        company: fields.company,
        position: fields.position,
      },
      phase,
    });
  }

  await phase("preparing the formatted email (first run installs a clipboard tool, up to ~1 min)…");
  const clipboard = await setBoatClipboardHtml(sandbox.id, bodyHtml);
  if (!clipboard.ok) {
    // Never silently send an unformatted email: this feature exists for the formatting.
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      status: "paused",
      lastError: `Could not put the formatted email on the computer's clipboard (${clipboard.detail || "unknown error"}). Resume to retry; nothing was sent for this row.`,
      lastReport: "",
      lockPromptId: undefined,
      lockConversationId: null,
    });
    await unlockBoatDesktop(projectId, campaignId);
    return {
      campaign,
      sandbox,
      done: false,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      report: "Clipboard setup failed",
    };
  }
  const composeUrl = cloudComposeUrl(provider, fields.email, fields.subject);
  await phase(`opening the compose window for ${fields.email}…`);
  await navigateChromeActiveTab(sandbox.id, doc.profileDirectory, composeUrl).catch(
    (error) => {
      console.warn(
        "Could not open prefilled compose:",
        error instanceof Error ? error.message : error,
      );
    },
  );

  const extras = customPrompt
    ? `\nExtra instructions from the user:\n${customPrompt.slice(0, 4000)}\n`
    : "";
  const bodyStart = bodyPlain.replace(/\s+/g, " ").slice(0, 50);

  const bodyLine = `The formatted body (starts "${bodyStart}…") is on your clipboard as rich text: paste it into the message body with Ctrl+V. Do NOT type it out.${
    signatureHtml
      ? " It already includes the signature, so replace anything auto-added (Ctrl+A in the body first)."
      : " Keep any auto-added signature below it."
  }`;

  const task = `Send this email from Chrome profile "${doc.profileDirectory}" (${mailName}).
A compose window should already be open with To ${fields.email} and Subject "${fields.subject}". ${bodyLine}
If compose isn't open or To/Subject are wrong, open ${composeUrl} in the same Chrome (don't relaunch Chrome).
Check the body is really filled in (if it is empty, paste again), then click the blue Send button yourself. Only reply "sent" after you clicked Send and saw "Message sent": the result is checked against the Sent folder. Stay in this tab; don't open new tabs.
${extras}
Reply with:
STATUS: sent | failed | skipped | needs_login | needs_otp | needs_user_input
ROW: ${nextRow}
EMAIL: ${fields.email}
REPORT: one short sentence
(needs_* only if sign-in, a code or a captcha blocks you; skipped if the address is unusable.)`;

  await phase(`desktop agent is pasting and sending to ${fields.email} (up to 3 min)…`);
  const result = await runCloudDesktopTask(
    projectId,
    sandbox.id,
    task,
    null,
    COMPOSE_WATCH_MS,
    true,
  );
  const report = clipReport(result.report || result.status);

  // Restart/pause may have happened while the agent was working: never overwrite that state
  // with this (now stale) result.
  const fresh = await getCloudCampaignDoc(projectId, campaignId);
  if (!fresh || fresh.status !== "sending" || (fresh.nextRow || 0) !== nextRow) {
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {});
    return {
      campaign,
      sandbox,
      done: false,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      report: "Campaign changed while this row was running; result discarded.",
    };
  }

  const auth = resolveSendAuthBlock(report);
  const authBlocked = auth.needsLogin || auth.needsOtp || auth.needsUserInput;

  if (authBlocked) {
    const reason = auth.needsOtp
      ? `${mailName} needs a verification code.`
      : auth.needsUserInput
        ? `${mailName} needs you to finish a step on the computer (phone confirm or captcha).`
        : `${mailName} needs a sign-in on the computer.`;
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      status: "paused",
      lastError: reason,
      lastReport: report,
      lockPromptId: result.promptId,
      lockConversationId: result.conversationId,
    });
    await unlockBoatDesktop(projectId, campaignId);
    return {
      campaign,
      sandbox,
      done: false,
      needsLogin: auth.needsLogin,
      needsOtp: auth.needsOtp,
      needsUserInput: auth.needsUserInput,
      report,
    };
  }

  let parsed: ReturnType<typeof parseSendResult> = parseSendResult(report);

  // Never trust "sent" from the desktop agent alone (a lite model can claim it without clicking
  // Send): confirm the message is really in the Sent folder before counting it.
  if (parsed.status === "sent") {
    await phase(`verifying ${fields.email} in the Sent folder…`);
    const check = await verifyEmailInSentFolder(
      sandbox.id,
      provider,
      fields.email,
      fields.subject,
    );
    if (check.state === "not_found" || check.state === "unknown") {
      parsed = {
        status: "incomplete",
        email: fields.email,
        row: nextRow,
        message:
          check.state === "not_found"
            ? `The agent said it sent to ${fields.email}, but no matching message is in ${mailName} Sent. It was NOT counted. Check the computer, then Resume to retry this row.`
            : `Could not confirm the send to ${fields.email} in ${mailName} Sent (${check.detail}). It was NOT counted. Check Sent, then Resume (or set CLOUD_VERIFY_SENT=off to skip this check).`,
      };
    }
  }

  // Incomplete / timed-out turns: do not log as failed and do not advance the row.
  if (parsed.status === "incomplete") {
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      status: "paused",
      lastError: result.timedOut
        ? `The agent did not confirm the send to ${fields.email} in time and was stopped (${
            result.activity.responses
              ? `it made ${result.activity.toolCalls} tool call(s)${
                  result.activity.lastTool ? `, last: ${result.activity.lastTool}` : ""
                }`
              : "it produced no output at all, so it may never have started: check the model/provider in Boat"
          }). Check the ${mailName} Sent folder first: if it went out, skip this row; otherwise Resume to retry.`
        : parsed.message,
      lastReport: report,
      lockPromptId: result.promptId,
      lockConversationId: result.conversationId,
    });
    await unlockBoatDesktop(projectId, campaignId);
    return {
      campaign,
      sandbox,
      done: false,
      needsLogin: false,
      needsOtp: false,
      needsUserInput: false,
      report,
    };
  }

  const entry = {
    row: parsed.row || nextRow,
    email: parsed.email || "",
    status: parsed.status,
    message: parsed.message,
    at: new Date().toISOString(),
  };

  const sendLog = [...(doc.sendLog ?? []), entry].slice(-500);
  const sentCount = doc.sentCount + (parsed.status === "sent" ? 1 : 0);
  const failedCount = doc.failedCount + (parsed.status === "failed" ? 1 : 0);
  const advanced = nextRow + 1;
  const finished = total > 0 && advanced >= total;

  const patch: Partial<CloudCampaignDoc> = {
    nextRow: advanced,
    sentCount,
    failedCount,
    sendLog,
    lastReport: report,
    lastError: parsed.status === "failed" ? parsed.message : undefined,
    lockPromptId: result.promptId,
    lockConversationId: result.conversationId,
  };

  if (finished) {
    patch.status = "sent";
    await unlockBoatDesktop(projectId, campaignId);
    await stopBoatAfterCampaignWork(projectId);
  }

  const campaign = await patchCloudCampaignDoc(projectId, campaignId, patch);
  return {
    campaign,
    sandbox,
    done: finished,
    needsLogin: false,
    needsOtp: false,
    needsUserInput: false,
    report,
  };
}

/** Clear the Recent sends log without changing send progress. */
export async function clearCloudSendLog(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  return patchCloudCampaignDoc(projectId, campaignId, {
    sendLog: [],
    lastReport: "Send history cleared.",
  });
}

/** Everything that must be true before a campaign can send or be scheduled (no computer needed). */
async function assertCampaignReady(projectId: ObjectId, campaignId: string, doc: CloudCampaignDoc) {
  if (!doc.profileId || !doc.profileDirectory) {
    throw new Error("Pick a sender profile first");
  }
  if (!doc.profileGmail || !doc.profileGmail.includes("@")) {
    throw new Error("Sign in the sender and click Check sign-in (step 2) before starting.");
  }
  if (!doc.signatureReady) {
    throw new Error("Save the email signature step first (you can leave it empty)");
  }
  if (!campaignHasPeopleList(doc)) {
    throw new Error("Add people with a CSV or Google Sheet first (step 4).");
  }
  if (process.env.CLOUD_SENDER !== "agent") {
    const headers = Array.isArray(doc.sheetHeaders) ? doc.sheetHeaders.map(String) : [];
    const rows = Array.isArray(doc.sheetRows) ? doc.sheetRows : [];
    const columnMap = doc.columnMap || reconcileColumnMap(undefined, headers, rows);
    const missing = CLOUD_REQUIRED_FIELDS.filter((field) => !columnMap[field]);
    if (missing.length) {
      throw new Error(`Map the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""} in step 4 before starting.`);
    }
    const stats = columnMapStats(rows, columnMap);
    if (stats.ready === 0) throw new Error("No people rows are ready to send — check step 4.");
    if (!doc.columnMap) {
      await patchCloudCampaignDoc(projectId, campaignId, { columnMap, columnStats: stats });
    }
  }
}

/** Effective schedule (defaults: send any day, any time, UTC). */
function scheduleOf(doc: CloudCampaignDoc): CloudSchedule {
  return {
    timezone: doc.schedule?.timezone || "UTC",
    excludedDays: doc.schedule?.excludedDays || [],
    windowStart: doc.schedule?.windowStart,
    windowEnd: doc.schedule?.windowEnd,
    startAt: doc.schedule?.startAt,
  };
}

/** Schedule the campaign to start at its start time (the server starts it; no computer now). */
export async function scheduleCloudSending(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  const schedule = scheduleOf(doc);
  if (!schedule.startAt || new Date(schedule.startAt).getTime() <= Date.now() + 60_000) {
    throw new Error("Pick a start time at least a minute from now, or use Start sending.");
  }
  await assertCampaignReady(projectId, campaignId, doc);
  const next = nextAllowedTime(new Date(), schedule);
  if (!next) throw new Error("Every day is excluded — allow at least one day in the schedule.");
  return patchCloudCampaignDoc(projectId, campaignId, {
    status: "scheduled",
    nextSendAt: next,
    lastError: undefined,
    lastReport: `Scheduled to start ${next.toISOString()}.`,
  });
}

export async function cancelCloudSchedule(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  if (doc.status !== "scheduled") return patchCloudCampaignDoc(projectId, campaignId, {});
  return patchCloudCampaignDoc(projectId, campaignId, {
    status: (doc.nextRow || 0) > 0 ? "paused" : "ready",
    nextSendAt: undefined,
    lastReport: "Schedule cancelled.",
  });
}

export async function startCloudSending(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  await assertCampaignReady(projectId, campaignId, doc);
  const schedule = scheduleOf(doc);
  const firstSend = nextAllowedTime(new Date(), { ...schedule, startAt: undefined });
  if (!firstSend) throw new Error("Every day is excluded — allow at least one day in the schedule.");
  await assertBoatUnlocked(projectId, campaignId);
  const sandbox = await readySandbox(projectId, campaignId);
  // No-AI Gmail sender: make sure its dedicated Chrome is up and signed in as the sender
  // before any row runs, so a campaign never starts into a guaranteed failure.
  if (process.env.CLOUD_SENDER !== "agent") {
    const check = await prepareAndCheckSender(
      sandbox.id,
      doc.profileDirectory || "",
      resolveSenderProvider(doc.profileProvider),
    );
    const expected = String(doc.profileGmail || "").trim().toLowerCase();
    if (check.ok && check.status === "login_required") {
      if (doc.profileId) await markChromeProfileScriptState(projectId, doc.profileId, null);
      throw new Error(
        `The sender Chrome isn't signed in. In step 2, open it, sign in as ${expected}, click Check sign-in, then start again.`,
      );
    }
    if (!check.ok || check.status !== "ready") {
      throw new Error(
        `Couldn't check the sender Chrome (${check.code || "error"}${check.message ? `: ${String(check.message).slice(0, 120)}` : ""}). Try again in a moment.`,
      );
    }
    const email = String(check.email || "").toLowerCase();
    if (email !== expected) {
      throw new Error(
        `The sender Chrome is signed in as ${email}, not ${expected}. Sign in as ${expected} in step 2, then start again.`,
      );
    }
    if (doc.profileId) await markChromeProfileScriptState(projectId, doc.profileId, email);
  }
  await lockBoatDesktop(projectId, campaignId, doc.name);
  return patchCloudCampaignDoc(projectId, campaignId, {
    status: "sending",
    computerReady: true,
    // The server send worker picks it up at this time (now, or the next allowed slot).
    nextSendAt: firstSend,
    lastError: undefined,
    // Drop any mid-task conversation so Resume does not continue a frozen tab-tidy turn.
    lockPromptId: undefined,
    lockConversationId: null,
  });
}

export async function pauseCloudSending(projectId: ObjectId, campaignId: string) {
  await unlockBoatDesktop(projectId, campaignId);
  const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
    status: "paused",
  });
  await stopBoatAfterCampaignWork(projectId);
  return campaign;
}

/** Stop sending (same as pause) — unlock desktop and archive the VM. */
export async function stopCloudSending(projectId: ObjectId, campaignId: string) {
  return pauseCloudSending(projectId, campaignId);
}

export async function resumeCloudSending(projectId: ObjectId, campaignId: string) {
  return startCloudSending(projectId, campaignId);
}

/**
 * Reset progress to row 0 and start sending from the beginning.
 * Interrupts any running agent turn instead of cycling the VM: stopping and resuming the
 * computer took minutes (archive, then resume), cold-started Chrome and looked "stuck".
 */
export async function restartCloudSending(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  await unlockBoatDesktop(projectId, campaignId);
  const sandboxId = (await getCloudBoatMeta(projectId).catch(() => null))?.sandboxId;
  if (sandboxId) {
    await interruptBoatAgent(sandboxId, null).catch(() => undefined);
  }
  await deleteCloudSends(projectId, campaignId);
  await patchCloudCampaignDoc(projectId, campaignId, {
    status: "ready",
    nextRow: 0,
    sentCount: 0,
    failedCount: 0,
    sendLog: [],
    lastError: undefined,
    lastReport: "Restarted from the first people row. Send history and report cleared.",
    inflightRow: undefined,
    lockPromptId: undefined,
    lockConversationId: null,
  });
  return startCloudSending(projectId, campaignId);
}

export async function pollCloudTask(
  projectId: ObjectId,
  campaignId: string,
) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc?.lockPromptId || !doc.profileDirectory) {
    return null;
  }
  const sandbox = await readySandbox(projectId, campaignId);
  return refreshBoatTask(
    sandbox.id,
    doc.lockPromptId,
    doc.lockConversationId ?? null,
  );
}
