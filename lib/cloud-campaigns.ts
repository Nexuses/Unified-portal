import type { CloudColumnMap, CloudColumnStats } from "@/lib/cloud-sheet-csv";
import type { CloudSchedule } from "@/lib/cloud-schedule";
/** Cloud campaigns send from Gmail or Outlook on the project's Boat desktop. */

export type CloudSenderProvider = "gmail" | "outlook";

export type CloudCampaignStatus = "draft" | "ready" | "scheduled" | "sending" | "paused" | "sent";

export function cloudMailInboxUrl(provider: CloudSenderProvider) {
  return provider === "outlook" ? "https://outlook.office.com/mail/" : "https://mail.google.com/";
}

export function cloudMailProductName(provider: CloudSenderProvider) {
  return provider === "outlook" ? "Outlook" : "Gmail";
}

export function formatCloudSenderProvider(provider?: CloudSenderProvider) {
  return cloudMailProductName(provider === "outlook" ? "outlook" : "gmail");
}

/** How every email in the campaign looks (pitch and follow-ups). */
export type CloudEmailStyle = {
  fontFamily: string;
  /** px */
  fontSize: number;
  color: string;
  lineHeight: number;
  linkColor: string;
  /** auto: highlight company/key phrases · markdown: only **text** you wrote · none: no bold */
  bold: "auto" | "markdown" | "none";
  /** Use the body font in the signature too (sizes and colours there are kept). */
  signatureFont: boolean;
  savedAt?: string;
};

/** Email-safe fonts (each with fallbacks every mail app has). */
export const CLOUD_FONT_OPTIONS = [
  { label: "Arial", value: "Arial,Helvetica,sans-serif" },
  { label: "Helvetica", value: "Helvetica,Arial,sans-serif" },
  { label: "Verdana", value: "Verdana,Geneva,sans-serif" },
  { label: "Tahoma", value: "Tahoma,Verdana,sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS',Arial,sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI',Arial,sans-serif" },
  { label: "Calibri", value: "Calibri,Carlito,Arial,sans-serif" },
  { label: "Georgia", value: "Georgia,'Times New Roman',serif" },
  { label: "Times New Roman", value: "'Times New Roman',Times,serif" },
] as const;

/** The one-click "standard": plain, readable, looks like a normal hand-written email. */
export const CLOUD_STANDARD_STYLE: CloudEmailStyle = {
  fontFamily: "Arial,Helvetica,sans-serif",
  fontSize: 14,
  color: "#222222",
  lineHeight: 1.5,
  linkColor: "#1a5fd0",
  bold: "markdown",
  signatureFont: true,
};

/** Look used before the style step existed (older campaigns keep rendering the same). */
export const CLOUD_LEGACY_STYLE: CloudEmailStyle = {
  fontFamily: "Arial,Helvetica,sans-serif",
  fontSize: 15,
  color: "#222",
  lineHeight: 1.6,
  linkColor: "#1a5fd0",
  bold: "auto",
  signatureFont: false,
};

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Validate a style from the page (unknown values fall back to the standard). */
export function normalizeEmailStyle(raw: unknown): CloudEmailStyle {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const std = CLOUD_STANDARD_STYLE;
  const font = CLOUD_FONT_OPTIONS.find((option) => option.value === input.fontFamily)?.value;
  const size = Math.round(Number(input.fontSize));
  const line = Number(input.lineHeight);
  const color = String(input.color || "");
  const link = String(input.linkColor || "");
  const bold = input.bold === "auto" || input.bold === "none" || input.bold === "markdown" ? input.bold : std.bold;
  return {
    fontFamily: font || std.fontFamily,
    fontSize: size >= 11 && size <= 20 ? size : std.fontSize,
    color: HEX.test(color) ? color : std.color,
    lineHeight: line >= 1.1 && line <= 2.2 ? Math.round(line * 10) / 10 : std.lineHeight,
    linkColor: HEX.test(link) ? link : std.linkColor,
    bold,
    signatureFont: input.signatureFont !== false,
  };
}

/** One automatic follow-up: sent `delayDays` after the previous email if there's no reply. */
export type CloudFollowupStep = {
  id: string;
  delayDays: number;
  /** Sheet column with this follow-up's text; empty cells (or no column) fall back to AI. */
  column?: string;
  /** Optional guidance for the AI writer ("mention the case study", "keep it to 2 lines"). */
  instructions?: string;
};

export type CloudFollowupSettings = {
  enabled: boolean;
  steps: CloudFollowupStep[];
  /** Set when the user saves the follow-up step (on or off): the step counts as done. */
  savedAt?: string;
};

/** Practical ceiling so a typo can't book hundreds of emails per person; raise it if needed. */
export const CLOUD_FOLLOWUP_MAX_STEPS = 20;

const FOLLOWUP_WORD = "(?:follow ?up|followup|fu|f/u|fup)";
const FOLLOWUP_TEXT_WORD = "(?:body|email|mail|message|msg|text|content|copy|pitch)";
const FOLLOWUP_HEADER_RE = new RegExp(
  `^(?:${FOLLOWUP_TEXT_WORD} )?${FOLLOWUP_WORD}(?: ${FOLLOWUP_TEXT_WORD}){0,2} ?(?:no |number )?(\\d{1,2})(?: ${FOLLOWUP_TEXT_WORD}){0,2}$`,
);

/**
 * Follow-up number a sheet header holds, or null. Accepts "Follow-up 1", "Followup body 2",
 * "follow_up_email_3", "FU4", "F/U #5 message", "Follow up 6 body", "Body follow-up 7".
 */
export function followupColumnNumber(header: string): number | null {
  const key = String(header || "")
    .toLowerCase()
    .replace(/f\/u/g, "fu")
    .replace(/[_\-:#().[\]]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bfollow ?up\b/g, "followup")
    .replace(/\bfu ?p\b/g, "fu");
  const match = key.match(FOLLOWUP_HEADER_RE);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= CLOUD_FOLLOWUP_MAX_STEPS ? n : null;
}

/** Follow-up columns in a sheet, in order: [{ n: 1, header: "Followup body 1" }, …]. */
export function detectFollowupColumns(headers: string[]) {
  const byNumber = new Map<number, string>();
  for (const header of headers) {
    const n = followupColumnNumber(header);
    if (n && !byNumber.has(n)) byNumber.set(n, header);
  }
  return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([n, header]) => ({ n, header }));
}

export type CloudFollowupStatus = "scheduled" | "sending" | "sent" | "skipped" | "failed";

/** Recommended sheet columns — expected hints, not hard requirements. */
export const CLOUD_SHEET_COLUMNS = [
  "firstname",
  "lastname",
  "email",
  "company",
  "position",
  "industry",
  "subject",
  "pitch",
] as const;

export type CloudSheetColumn = (typeof CLOUD_SHEET_COLUMNS)[number];

/** Flexible sample row keyed by discovered header names. */
export type CloudSheetSample = {
  cells: Record<string, string>;
};

export type CloudChromeProfile = {
  id: string;
  label: string;
  provider: CloudSenderProvider;
  gmail: string;
  directoryName: string;
  verifiedAt?: string;
  /** Account signed in to this sender's dedicated script Chrome. */
  scriptEmail?: string;
  scriptCheckedAt?: string;
  sensitivityLabel?: string;
  sensitivityLabels?: string[];
  /** Sender has a remembered signature or column mapping. */
  hasDefaults?: boolean;
  createdAt: string;
};

/** Gmail and Outlook senders both use the no-AI script sender (dedicated Chrome sign-in). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function usesScriptSender(provider?: CloudSenderProvider) {
  return true;
}

export type CloudSendLogEntry = {
  row: number;
  email: string;
  status: "sent" | "failed" | "skipped";
  message?: string;
  at: string;
};

export type CloudCampaign = {
  id: string;
  name: string;
  status: CloudCampaignStatus;
  profileId?: string;
  profileProvider?: CloudSenderProvider;
  profileGmail?: string;
  profileDirectory?: string;
  signatureHtml?: string;
  signatureReady?: boolean;
  customPrompt?: string;
  customPromptReady?: boolean;
  sheetUrl?: string;
  /** How people rows were loaded — sheet (Boat read) or csv upload. */
  sheetSource?: "csv" | "sheet";
  sheetFileName?: string;
  sheetHeaders?: string[];
  sheetRowCount?: number;
  sheetSamples?: CloudSheetSample[];
  /** Which people-list column feeds each email field, and how many rows are ready. */
  columnMap?: CloudColumnMap;
  columnStats?: CloudColumnStats;
  trackOpens?: boolean;
  trackClicks?: boolean;
  unsubscribeFooter?: boolean;
  inboxCheckedAt?: string;
  /** Start time, timezone, excluded weekdays and daily window. */
  schedule?: CloudSchedule;
  /** Automatic follow-ups (replies in the same thread). */
  followups?: CloudFollowupSettings;
  /** Font, size, colours and bold for every email. */
  emailStyle?: CloudEmailStyle;
  /** Set when sending stopped on its own: signed-out sender, an error, or the schedule. */
  stopKind?: "signed_out" | "error" | "schedule";
  stoppedAt?: string;
  /** When the server will send the next email (respects gap, days and window). */
  nextSendAt?: string;
  attachments?: { id: string; name: string; size: number; type: string }[];
  sheetVerifiedAt?: string;
  computerReady?: boolean;
  gapMinutes: number;
  nextRow: number;
  sentCount: number;
  failedCount: number;
  lastError?: string;
  lastReport?: string;
  sendLog: CloudSendLogEntry[];
  createdAt: string;
  updatedAt: string;
};

export function formatCloudStatus(status: CloudCampaignStatus) {
  switch (status) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready";
    case "scheduled":
      return "Scheduled";
    case "sending":
      return "Sending";
    case "paused":
      return "Paused";
    case "sent":
      return "Sent";
    default:
      return status;
  }
}

export function formatCloudCampaignStatus(campaign: CloudCampaign) {
  switch (campaign.status) {
    case "ready":
      return {
        label: "Ready",
        detail: campaign.sheetRowCount
          ? `${campaign.sheetRowCount} people in sheet`
          : "Setup complete",
      };
    case "scheduled":
      return {
        label: "Scheduled",
        detail: campaign.schedule?.startAt
          ? `Starts ${new Date(campaign.schedule.startAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
          : "Starts at the next allowed time",
      };
    case "sending":
      return {
        label: "Sending",
        detail: `${campaign.sentCount} sent · row ${campaign.nextRow + 1}`,
      };
    case "sent":
      return {
        label: "Sent",
        detail: `${campaign.sentCount} sent${campaign.failedCount ? ` · ${campaign.failedCount} failed` : ""}`,
      };
    case "paused":
      return { label: "Paused", detail: "Resume when the inbox is ready" };
    case "draft":
    default:
      return { label: "Draft", detail: "Finish setup to start" };
  }
}

export async function fetchCloudCampaigns(): Promise<CloudCampaign[]> {
  const response = await fetch("/api/cloud-campaigns", { cache: "no-store" });
  const data = (await response.json().catch(() => null)) as
    | { campaigns?: CloudCampaign[]; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(data?.error || "Could not load cloud campaigns");
  }
  return data?.campaigns ?? [];
}

export async function createCloudCampaign(name: string): Promise<CloudCampaign> {
  const response = await fetch("/api/cloud-campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await response.json().catch(() => null)) as
    | { campaign?: CloudCampaign; error?: string }
    | null;
  if (!response.ok || !data?.campaign) {
    throw new Error(data?.error || "Could not create the campaign");
  }
  return data.campaign;
}

export async function duplicateCloudCampaign(id: string): Promise<CloudCampaign> {
  const response = await fetch(
    `/api/cloud-campaigns/${encodeURIComponent(id)}/duplicate`,
    { method: "POST" },
  );
  const data = (await response.json().catch(() => null)) as
    | { campaign?: CloudCampaign; error?: string }
    | null;
  if (!response.ok || !data?.campaign) {
    throw new Error(data?.error || "Could not duplicate the campaign");
  }
  return data.campaign;
}

export async function fetchCloudCampaign(id: string): Promise<CloudCampaign> {
  const response = await fetch(`/api/cloud-campaigns/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as
    | { campaign?: CloudCampaign; error?: string }
    | null;
  if (!response.ok || !data?.campaign) {
    throw new Error(data?.error || "Campaign not found");
  }
  return data.campaign;
}

export async function patchCloudCampaign(
  id: string,
  patch: Partial<
    Pick<
      CloudCampaign,
      | "name"
      | "sheetUrl"
      | "gapMinutes"
      | "profileId"
      | "status"
      | "signatureHtml"
      | "signatureReady"
      | "customPrompt"
      | "customPromptReady"
      | "trackOpens"
      | "trackClicks"
      | "unsubscribeFooter"
      | "schedule"
      | "followups"
      | "emailStyle"
    >
  >,
): Promise<CloudCampaign> {
  const response = await fetch(`/api/cloud-campaigns/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await response.json().catch(() => null)) as
    | { campaign?: CloudCampaign; error?: string }
    | null;
  if (!response.ok || !data?.campaign) {
    throw new Error(data?.error || "Could not save the campaign");
  }
  return data.campaign;
}

export async function deleteCloudCampaign(id: string) {
  const response = await fetch(`/api/cloud-campaigns/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(data?.error || "Could not delete the campaign");
  }
}

export async function fetchCloudProfiles(): Promise<CloudChromeProfile[]> {
  const response = await fetch("/api/cloud-campaigns/profiles", { cache: "no-store" });
  const data = (await response.json().catch(() => null)) as
    | { profiles?: CloudChromeProfile[]; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(data?.error || "Could not load Gmail profiles");
  }
  return data?.profiles ?? [];
}

export async function deleteCloudProfile(profileId: string): Promise<void> {
  const response = await fetch(
    `/api/cloud-campaigns/profiles?profileId=${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
  );
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(data?.error || "Could not delete the sender profile");
  }
}

export async function renameCloudProfile(
  profileId: string,
  label: string,
): Promise<CloudChromeProfile> {
  const response = await fetch("/api/cloud-campaigns/profiles", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, label }),
  });
  const data = (await response.json().catch(() => null)) as
    | { profile?: CloudChromeProfile; error?: string }
    | null;
  if (!response.ok || !data?.profile) {
    throw new Error(data?.error || "Could not rename the sender");
  }
  return data.profile;
}

export async function setCloudProfileSensitivityLabel(
  profileId: string,
  sensitivityLabel: string,
): Promise<CloudChromeProfile> {
  const response = await fetch("/api/cloud-campaigns/profiles", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, sensitivityLabel }),
  });
  const data = (await response.json().catch(() => null)) as
    | { profile?: CloudChromeProfile; error?: string }
    | null;
  if (!response.ok || !data?.profile) {
    throw new Error(data?.error || "Could not save the sensitivity label");
  }
  return data.profile;
}

export async function createCloudProfile(
  provider: CloudSenderProvider = "gmail",
  label?: string,
  campaignId?: string,
): Promise<{
  profile: CloudChromeProfile;
  needsLogin: boolean;
  report?: string;
  desktopUrl?: string;
}> {
  const response = await fetch("/api/cloud-campaigns/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, campaignId, provider }),
  });
  const data = (await response.json().catch(() => null)) as {
    profile?: CloudChromeProfile;
    needsLogin?: boolean;
    report?: string;
    desktopUrl?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.profile) {
    throw new Error(data?.error || "Could not create a Gmail profile");
  }
  return {
    profile: data.profile,
    needsLogin: data.needsLogin === true,
    report: data.report,
    desktopUrl: data.desktopUrl,
  };
}

/** The project's cloud computer VPN (NordVPN), as the campaign page shows it. */
export type CloudVpnInfo = {
  enabled: boolean;
  country: string;
  configured: boolean;
  status: {
    connected: boolean;
    country?: string;
    city?: string;
    ip?: string;
    checkedAt: string;
    error?: string;
  } | null;
};

export async function runCloudCampaignAction(
  id: string,
  action:
    | "start_computer"
    | "vpn_status"
    | "vpn_enable"
    | "vpn_disable"
    | "verify_sender"
    | "verify_sheet"
    | "sign_in_sender"
    | "submit_auth_code"
    | "start"
    | "pause"
    | "stop"
    | "resume"
    | "restart"
    | "clear_send_log"
    | "sender_check"
    | "sender_test_send"
    | "verify_csv"
    | "save_column_map"
    | "preview_row"
    | "check_inbox"
    | "schedule"
    | "cancel_schedule"
    | "followup_preview"
    | "followup_dry_run"
    | "followup_send_now"
    | "tick",
  body?: Record<string, unknown>,
) {
  const response = await fetch(
    `/api/cloud-campaigns/${encodeURIComponent(id)}/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(body ?? {}) }),
    },
  );
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Cloud campaign action failed",
    );
  }
  return data ?? {};
}
