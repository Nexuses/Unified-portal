export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused";

export type RecipientMode = "list" | "individual";

export type CampaignIndividualContact = {
  id: string;
  email: string;
  fullName: string;
};

export type DripCampaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt?: string;
  sentAt?: string;
  tags: string[];
  recipients: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
  conversions: number;
  delivered?: number;
  senderId?: string;
  senderName?: string;
  senderEmail?: string;
  listId?: string;
  listName?: string;
  recipientMode?: RecipientMode;
  individualContacts?: CampaignIndividualContact[];
  subject?: string;
  previewText?: string;
  hasDesign?: boolean;
  designHtml?: string;
  designSourceCampaignId?: string;
  replyToEnabled?: boolean;
  replyToEmail?: string;
  attachmentEnabled?: boolean;
  attachmentName?: string;
  timezoneEnabled?: boolean;
  timezone?: string;
  listDisplayId?: number;
  shareToken?: string;
  timeline?: Array<{
    id: string;
    type: "draft" | "scheduled" | "sent";
    title: string;
    description: string;
    at: string;
  }>;
};

export function formatCampaignStatus(campaign: DripCampaign) {
  if (campaign.status === "scheduled" && campaign.scheduledAt) {
    return { label: "Scheduled", detail: `Scheduled for ${campaign.scheduledAt}` };
  }
  if (campaign.status === "sending") {
    return { label: "Sending", detail: "Campaign is running" };
  }
  if (campaign.status === "sent" && campaign.sentAt) {
    const sent = formatCampaignClock(campaign.sentAt, campaign.timezone);
    return { label: "Sent", detail: `Sent on ${sent}` };
  }
  if (campaign.status === "draft") {
    return { label: "Draft", detail: "Not scheduled yet" };
  }
  if (campaign.status === "paused") {
    return { label: "Paused", detail: "Campaign paused" };
  }
  return { label: "Draft", detail: "Not scheduled yet" };
}

export function formatCampaignClock(
  value: string | Date,
  timeZone = "Asia/Kolkata",
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

export function zonedDateTimeToIso(
  date: string,
  hour: string,
  minute: string,
  timeZone: string,
) {
  const asUtc = new Date(`${date}T${hour}:${minute}:00.000Z`);
  const tzStamp = asUtc.toLocaleString("sv-SE", { timeZone });
  const tzAsUtc = new Date(`${tzStamp.replace(" ", "T")}Z`);
  return new Date(asUtc.getTime() + (asUtc.getTime() - tzAsUtc.getTime())).toISOString();
}

export function mergeBlastReport(
  campaign: DripCampaign,
  report: {
    campaignId: string;
    status: "scheduled" | "sending" | "sent";
    recipients: number;
    opens: number;
    clicks: number;
    unsubscribed: number;
    conversions: number;
    delivered?: number;
    sentAt?: string;
    scheduledFor?: string;
    listDisplayId?: number;
    listName?: string;
    subject?: string;
    timeline?: DripCampaign["timeline"];
  },
): DripCampaign {
  const timezone = campaign.timezone || "Asia/Kolkata";
  return {
    ...campaign,
    status:
      report.status === "scheduled"
        ? "scheduled"
        : report.status === "sending"
          ? "sending"
          : "sent",
    recipients: report.recipients,
    opens: report.opens,
    clicks: report.clicks,
    unsubscribed: report.unsubscribed,
    conversions: report.conversions,
    delivered: report.delivered ?? campaign.delivered,
    sentAt: report.sentAt || campaign.sentAt,
    scheduledAt: report.scheduledFor
      ? formatCampaignClock(report.scheduledFor, timezone)
      : campaign.scheduledAt,
    listDisplayId: report.listDisplayId ?? campaign.listDisplayId,
    listName: report.listName ?? campaign.listName,
    subject: report.subject ?? campaign.subject,
    timeline: report.timeline ?? campaign.timeline,
  };
}

export function mergeBlastReports(
  campaigns: DripCampaign[],
  reports: Array<Parameters<typeof mergeBlastReport>[1]>,
) {
  return campaigns.map((campaign) => {
    const report = reports.find((item) => item.campaignId === campaign.id);
    return report ? mergeBlastReport(campaign, report) : campaign;
  });
}

export function formatMetric(value: number, total: number) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const label = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
  return { value, pct: label };
}

export const EMAIL_PLAN_LIMIT = 50000;
export const MAX_INDIVIDUAL_CONTACTS = 10;

const NO_STORE: RequestInit = { cache: "no-store" };

export function getRemainingEmailCredits(
  campaigns: DripCampaign[],
  planLimit = EMAIL_PLAN_LIMIT,
) {
  const used = campaigns.reduce(
    (sum, campaign) => sum + (campaign.status === "sent" ? campaign.recipients : 0),
    0,
  );
  return Math.max(0, planLimit - used);
}

export async function fetchDripCampaigns(): Promise<DripCampaign[]> {
  const response = await fetch("/api/campaigns", NO_STORE);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to load campaigns",
    );
  }
  return Array.isArray(data) ? (data as DripCampaign[]) : [];
}

export async function fetchDripCampaign(
  id: string,
): Promise<DripCampaign | null> {
  const response = await fetch(
    `/api/campaigns/${encodeURIComponent(id)}`,
    NO_STORE,
  );
  if (response.status === 404) {
    return null;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to load campaign",
    );
  }
  return data as DripCampaign;
}

export async function createDripCampaign(name: string): Promise<DripCampaign> {
  const response = await fetch("/api/campaigns", {
    ...NO_STORE,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to create campaign",
    );
  }
  return data as DripCampaign;
}

export async function patchDripCampaign(
  id: string,
  patch: Partial<DripCampaign>,
): Promise<DripCampaign> {
  const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
    ...NO_STORE,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to update campaign",
    );
  }
  return data as DripCampaign;
}

export async function deleteDripCampaign(id: string): Promise<void> {
  const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
    ...NO_STORE,
    method: "DELETE",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to delete campaign",
    );
  }
}
