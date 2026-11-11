import { ObjectId } from "mongodb";
import {
  boatConfigured,
  ensureProjectBoat,
  isBoatRunning,
  openBoatDesktop,
  refreshBoatTask,
  runBoatCommand,
  runBoatDesktopTask,
  shellQuote,
  type BoatSandbox,
} from "@/lib/boat";
import {
  CLOUD_SHEET_COLUMNS,
  cloudMailInboxUrl,
  cloudMailProductName,
  type CloudSenderProvider,
  type CloudSheetSample,
} from "@/lib/cloud-campaigns";
import {
  getBoatDesktopLock,
  getChromeProfile,
  getCloudCampaignDoc,
  lockBoatDesktop,
  markChromeProfileVerified,
  patchCloudCampaignDoc,
  unlockBoatDesktop,
  type CloudCampaignDoc,
} from "@/lib/cloud-campaigns-server";

const WATCH_MS = 120_000;
const AUTH_WATCH_MS = 180_000;

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
  if (/needs_otp|needs_user_input/.test(status)) return true;
  return /needs_otp|needs_user_input|2\s*fa|verification code|authenticator|sms code/i.test(
    report,
  );
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
  if (status.includes("needs_otp") || parseNeedsOtp(report)) {
    return { needsLogin: false, needsOtp: true, needsUserInput: false };
  }
  if (status.includes("needs_user_input") || parseNeedsUserInput(report)) {
    return { needsLogin: false, needsOtp: false, needsUserInput: true };
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
    `The LinkedIn computer is busy with cloud campaign "${lock.campaignName}". Pause or finish that campaign first.`,
  );
}

async function readySandbox(projectId: ObjectId, allowCampaignId?: string) {
  if (!boatConfigured()) {
    throw new Error("Boat is not set up. An admin needs to add BOAT_API_KEY.");
  }
  await assertBoatUnlocked(projectId, allowCampaignId);
  const sandbox = await ensureProjectBoat(projectId);
  if (!isBoatRunning(sandbox.state)) {
    throw new Error(`The computer is ${sandbox.state}. Try again in a few seconds.`);
  }
  return sandbox;
}

export async function openChromeProfile(
  sandboxId: string,
  directoryName: string,
  url: string,
) {
  const directory = shellQuote(directoryName);
  const target = shellQuote(url);
  const command = [
    "if ! command -v google-chrome-stable >/dev/null; then echo chrome-missing; exit 1; fi;",
    `DISPLAY=:0 nohup google-chrome-stable --no-first-run --profile-directory=${directory} --new-window ${target}`,
    ">/tmp/boat-chrome-cloud.log 2>&1 & echo started",
  ].join(" ");
  return runBoatCommand(sandboxId, command, 20);
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
  const result = await runBoatDesktopTask(sandbox.id, task, null, WATCH_MS);
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

  const result = await runBoatDesktopTask(sandbox.id, task, null, AUTH_WATCH_MS);
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

  const result = await runBoatDesktopTask(sandbox.id, task, null, AUTH_WATCH_MS);
  return finishChromeAuthResult(
    projectId,
    profileId,
    profile,
    sandbox,
    result,
    profile.gmail,
  );
}

export async function verifyCloudSheet(
  projectId: ObjectId,
  campaignId: string,
  sheetUrl: string,
) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc?.profileDirectory) {
    throw new Error("Pick a sender profile before verifying the sheet");
  }
  const sandbox = await readySandbox(projectId, campaignId);
  await openChromeProfile(sandbox.id, doc.profileDirectory, sheetUrl);
  const expected = CLOUD_SHEET_COLUMNS.join(", ");
  const task = `In the Chrome window for profile "${doc.profileDirectory}", open this Google Sheet if it is not already open:
${sheetUrl}

Discover the sheet. There is NO fixed template.
Read the header row exactly as written, then the people/data rows under it.
Recommended (but NOT required) columns people often use: ${expected}.
Also accept close variants (e.g. first name, e-mail, dept, department, industry, body, message).

Reply exactly in this shape:
STATUS: ready OR needs_login OR error
HEADERS: comma-separated header names you see, in left-to-right order
ROW_COUNT: number of people rows excluding the header
SAMPLE_1: pipe-separated cell values for the first data row, same order as HEADERS
SAMPLE_2: pipe-separated cell values for the second data row, same order as HEADERS (or blank if only one row)
REPORT: one short sentence about what you found

Do not fail just because a recommended column is missing.
Do not send email. Do not edit the sheet.`;
  const result = await runBoatDesktopTask(sandbox.id, task, null, WATCH_MS);
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
      const values = line.split("|").map((part) => part.trim());
      const cells: Record<string, string> = {};
      headers.forEach((header, index) => {
        cells[header] = values[index] ?? "";
      });
      return { cells };
    });

  const normalizedHeaders = headers.map((item) => item.toLowerCase().replace(/\s+/g, ""));
  const missingExpected = CLOUD_SHEET_COLUMNS.filter((column) => {
    const key = column.toLowerCase();
    return !normalizedHeaders.some(
      (header) =>
        header === key ||
        header.includes(key) ||
        key.includes(header) ||
        (key === "industry" && (header.includes("dept") || header.includes("department"))) ||
        (key === "pitch" && (header.includes("body") || header.includes("message"))) ||
        (key === "firstname" && header.includes("first")) ||
        (key === "lastname" && header.includes("last")),
    );
  });

  const ok =
    headers.length > 0 &&
    rowCount > 0 &&
    !parseNeedsLogin(report) &&
    !status.includes("needs_login") &&
    !status.startsWith("error");

  await patchCloudCampaignDoc(projectId, campaignId, {
    sheetUrl,
    sheetHeaders: headers,
    sheetRowCount: rowCount,
    sheetSamples: samples,
    sheetVerifiedAt: ok ? new Date() : undefined,
    lastReport: report,
    lastError: ok
      ? undefined
      : parseTagged(report, "REPORT") || "Sheet could not be verified",
    status: ok ? "ready" : doc.status === "ready" ? "draft" : doc.status,
  });

  const desktopUrl = await openBoatDesktop(sandbox.id).catch(() => "");
  return {
    ok,
    needsLogin: parseNeedsLogin(report) || status.includes("needs_login"),
    headers,
    rowCount,
    samples,
    missingExpected,
    report,
    desktopUrl: desktopUrl || undefined,
  };
}

function parseSendResult(report: string) {
  const status = parseTagged(report, "STATUS").toLowerCase();
  const email = parseTagged(report, "EMAIL").replace(/[<>]/g, "").trim().toLowerCase();
  const row = Number(parseTagged(report, "ROW")) || 0;
  if (status.startsWith("sent")) {
    return { status: "sent" as const, email, row, message: parseTagged(report, "REPORT") };
  }
  if (status.startsWith("skipped")) {
    return { status: "skipped" as const, email, row, message: parseTagged(report, "REPORT") };
  }
  return {
    status: "failed" as const,
    email,
    row,
    message: parseTagged(report, "REPORT") || report.slice(0, 240),
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
  if (!doc.sheetUrl || !doc.profileDirectory) {
    throw new Error("Campaign is missing a sheet or sender profile");
  }
  const provider = resolveSenderProvider(doc.profileProvider);
  const mailName = cloudMailProductName(provider);
  const inboxUrl = cloudMailInboxUrl(provider);

  const sandbox = await readySandbox(projectId, campaignId);
  await lockBoatDesktop(projectId, campaignId, doc.name);

  const nextRow = Math.max(0, doc.nextRow || 0);
  const total = Math.max(0, doc.sheetRowCount || 0);
  if (total > 0 && nextRow >= total) {
    const campaign = await patchCloudCampaignDoc(projectId, campaignId, {
      status: "sent",
      lastError: undefined,
      lastReport: "All rows finished.",
    });
    await unlockBoatDesktop(projectId, campaignId);
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

  await openChromeProfile(sandbox.id, doc.profileDirectory, inboxUrl);
  await openChromeProfile(sandbox.id, doc.profileDirectory, doc.sheetUrl);

  const sheetHeaders =
    Array.isArray(doc.sheetHeaders) && doc.sheetHeaders.length
      ? doc.sheetHeaders.map(String)
      : [...CLOUD_SHEET_COLUMNS];
  const headersList = sheetHeaders.join(", ");

  const signatureHtml = String(doc.signatureHtml || "").trim();
  const signatureInstructions = signatureHtml
    ? `Signature HTML (append after the email body; preserve links/images; do not invent extra signature text):
-----SIGNATURE_HTML_START-----
${signatureHtml.slice(0, 12_000)}
-----SIGNATURE_HTML_END-----

After the body, add a blank line, then the signature HTML rendered as rich text/HTML if the client allows it. If only plain text is available, paste a readable plain-text version of the signature.`
    : "No campaign signature is configured. Do not invent a signature.";

  const customPrompt = String(doc.customPrompt || "").trim();
  const customPromptInstructions = customPrompt
    ? `ADDITIONAL_INSTRUCTIONS (follow these while composing; do not invent sheet data):
-----CUSTOM_PROMPT_START-----
${customPrompt.slice(0, 4000)}
-----CUSTOM_PROMPT_END-----`
    : "No additional campaign instructions. Prefer subject/pitch columns when present; otherwise compose carefully from available cells.";

  const task = `You are sending one email for a Cloud campaign.

Chrome profile directory: ${doc.profileDirectory}
Mail client: ${mailName} (${inboxUrl})
Google Sheet: ${doc.sheetUrl}
Discovered sheet columns (use these; order may vary): ${headersList}
People rows are numbered from 0 (first person under the header).
Send ONLY row ${nextRow}. Total people rows: ${total || "unknown"}.

${signatureInstructions}

${customPromptInstructions}

Steps:
1. In the sheet tab, read row ${nextRow} using the discovered columns above. Map cells by header name (case-insensitive). Prefer email/e-mail, subject, pitch/body/message, firstname/first name, lastname/last name, company, position/title, industry/department/dept when those headers exist. Use whatever else is present if useful. Do not invent values.
2. In the ${mailName} tab for this same Chrome profile, compose a new email.
3. To = the email cell if present. Subject = subject cell if present, otherwise a short subject consistent with ADDITIONAL_INSTRUCTIONS and the row. Body = pitch/body/message if present, personalized with available name/company fields and ADDITIONAL_INSTRUCTIONS; then the campaign signature if provided above.
4. Send the email.
5. Reply in this exact shape:

STATUS: sent OR failed OR skipped OR needs_login OR needs_otp OR needs_user_input
ROW: ${nextRow}
EMAIL: address
REPORT: one short sentence

If ${mailName} asks you to sign in with email/password, stop and use STATUS: needs_login.
If a 2FA / OTP / SMS / authenticator code is required, stop and use STATUS: needs_otp.
If the user must confirm on a phone, pass a captcha, or finish another human step, use STATUS: needs_user_input.
If the row has no usable recipient email, use STATUS: skipped.
Do not send any other rows.`;

  const conversationId = doc.lockConversationId ?? null;
  const result = await runBoatDesktopTask(
    sandbox.id,
    task,
    conversationId,
    WATCH_MS,
  );
  const report = clipReport(result.report || result.status);
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

  const parsed = parseSendResult(report);
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

export async function startCloudSending(projectId: ObjectId, campaignId: string) {
  const doc = await getCloudCampaignDoc(projectId, campaignId);
  if (!doc) throw new Error("Campaign not found");
  if (!doc.computerReady) throw new Error("Start the computer first");
  if (!doc.profileId || !doc.profileDirectory) {
    throw new Error("Pick a sender profile first");
  }
  if (!doc.profileGmail || !doc.profileGmail.includes("@")) {
    throw new Error("Confirm the inbox sign-in before starting (I’ve signed in — check inbox)");
  }
  if (!doc.signatureReady) {
    throw new Error("Save the email signature step first (you can leave it empty)");
  }
  if (!doc.sheetUrl || !doc.sheetVerifiedAt) {
    throw new Error("Verify the Google Sheet first");
  }
  if (!doc.customPromptReady) {
    throw new Error("Save the extra prompt step first (you can leave it empty)");
  }
  await assertBoatUnlocked(projectId, campaignId);
  await readySandbox(projectId, campaignId);
  await lockBoatDesktop(projectId, campaignId, doc.name);
  return patchCloudCampaignDoc(projectId, campaignId, {
    status: "sending",
    lastError: undefined,
  });
}

export async function pauseCloudSending(projectId: ObjectId, campaignId: string) {
  await unlockBoatDesktop(projectId, campaignId);
  return patchCloudCampaignDoc(projectId, campaignId, {
    status: "paused",
  });
}

export async function resumeCloudSending(projectId: ObjectId, campaignId: string) {
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
