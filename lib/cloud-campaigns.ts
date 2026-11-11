/** Cloud campaigns send from Gmail or Outlook on the project's Boat desktop. */

export type CloudSenderProvider = "gmail" | "outlook";

export type CloudCampaignStatus = "draft" | "ready" | "sending" | "paused" | "sent";

export function cloudMailInboxUrl(provider: CloudSenderProvider) {
  return provider === "outlook" ? "https://outlook.office.com/mail/" : "https://mail.google.com/";
}

export function cloudMailProductName(provider: CloudSenderProvider) {
  return provider === "outlook" ? "Outlook" : "Gmail";
}

export function formatCloudSenderProvider(provider?: CloudSenderProvider) {
  return cloudMailProductName(provider === "outlook" ? "outlook" : "gmail");
}

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
  createdAt: string;
};

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
  sheetHeaders?: string[];
  sheetRowCount?: number;
  sheetSamples?: CloudSheetSample[];
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

export async function runCloudCampaignAction(
  id: string,
  action:
    | "start_computer"
    | "verify_sender"
    | "verify_sheet"
    | "sign_in_sender"
    | "submit_auth_code"
    | "start"
    | "pause"
    | "resume"
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
