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

const STORAGE_KEY = "portal_drip_campaigns_v2";
export const LAUNCH_NOTICE_KEY = "portal_campaign_launch_notice";
export const EMAIL_PLAN_LIMIT = 50000;
export const MAX_INDIVIDUAL_CONTACTS = 10;

export function getRemainingEmailCredits(
  campaigns = loadDripCampaigns(),
  planLimit = EMAIL_PLAN_LIMIT,
) {
  const used = campaigns.reduce(
    (sum, campaign) => sum + (campaign.status === "sent" ? campaign.recipients : 0),
    0,
  );
  return Math.max(0, planLimit - used);
}

export function loadDripCampaigns(): DripCampaign[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as DripCampaign[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDripCampaigns(campaigns: DripCampaign[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(campaigns));
}

export function getDripCampaign(id: string, campaigns = loadDripCampaigns()) {
  return campaigns.find((campaign) => campaign.id === id) ?? null;
}

export function updateDripCampaign(
  id: string,
  patch: Partial<DripCampaign>,
): DripCampaign | null {
  const campaigns = loadDripCampaigns();
  let updated: DripCampaign | null = null;

  const next = campaigns.map((campaign) => {
    if (campaign.id !== id) {
      return campaign;
    }
    updated = { ...campaign, ...patch };
    return updated;
  });

  saveDripCampaigns(next);
  return updated;
}

export function createCampaignId(existing: DripCampaign[]) {
  const maxId = existing.reduce(
    (max, campaign) => Math.max(max, Number(campaign.id) || 0),
    0,
  );
  return String(maxId + 1);
}
