export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused";

export type CampaignKind = "drip" | "oneone";

export type RecipientMode = "list" | "individual";

export type CampaignSequence = {
  id: string;
  delayDays: number;
  subject?: string;
  previewText?: string;
  hasDesign?: boolean;
  designHtml?: string;
  designSourceCampaignId?: string;
};

export type CampaignIndividualContact = {
  id: string;
  email: string;
  fullName: string;
};

export type CampaignSequenceProgress = {
  current: number;
  total: number;
  sent: number;
  contacts: number;
};

export type DripCampaign = {
  id: string;
  name: string;
  kind?: CampaignKind;
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
  sequences?: CampaignSequence[];
  windowStart?: string;
  windowEnd?: string;
  emailGapMinutes?: number;
  sequenceProgress?: CampaignSequenceProgress;
  timeline?: Array<{
    id: string;
    type: "draft" | "scheduled" | "sent";
    title: string;
    description: string;
    at: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
};

export function createEmptySequence(index = 0): CampaignSequence {
  return {
    id: `seq-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    delayDays: index === 0 ? 0 : 1,
  };
}

export function isOneOneCampaign(campaign: Pick<DripCampaign, "kind">) {
  return campaign.kind === "oneone";
}

export function campaignSequences(campaign: DripCampaign) {
  if (campaign.sequences && campaign.sequences.length > 0) {
    return campaign.sequences;
  }
  if (!isOneOneCampaign(campaign)) {
    return [];
  }
  return [
    {
      ...createEmptySequence(0),
      subject: campaign.subject,
      previewText: campaign.previewText,
      hasDesign: campaign.hasDesign,
      designHtml: campaign.designHtml,
      designSourceCampaignId: campaign.designSourceCampaignId,
    },
  ];
}

export function sequencesReady(campaign: DripCampaign) {
  const sequences = campaignSequences(campaign);
  if (sequences.length === 0) {
    return false;
  }
  if (!campaign.windowStart?.trim() || !campaign.windowEnd?.trim()) {
    return false;
  }
  return sequences.every(
    (sequence, index) =>
      Boolean(sequence.subject?.trim()) &&
      Boolean(sequence.hasDesign && sequence.designHtml?.trim()) &&
      (index === 0 || Number(sequence.delayDays) >= 0),
  );
}

export function overlaySequenceOnCampaign(
  campaign: DripCampaign,
  sequence?: CampaignSequence,
): DripCampaign {
  if (!sequence) {
    return campaign;
  }
  return {
    ...campaign,
    subject: sequence.subject,
    previewText: sequence.previewText,
    hasDesign: sequence.hasDesign,
    designHtml: sequence.designHtml,
    designSourceCampaignId: sequence.designSourceCampaignId,
  };
}

export function sequenceCampaignPatch(
  sequences: CampaignSequence[],
  windowStart: string,
  windowEnd: string,
  emailGapMinutes: number,
): Partial<DripCampaign> {
  const first = sequences[0];
  return {
    sequences,
    windowStart,
    windowEnd,
    emailGapMinutes,
    subject: first?.subject,
    previewText: first?.previewText,
    hasDesign: first?.hasDesign,
    designHtml: first?.designHtml,
    designSourceCampaignId: first?.designSourceCampaignId,
  };
}

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
    status: "scheduled" | "sending" | "sent" | "paused";
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
    sequenceProgress?: CampaignSequenceProgress;
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
          : report.status === "paused"
            ? "paused"
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
    sequenceProgress: report.sequenceProgress ?? campaign.sequenceProgress,
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

export function formatSequenceProgress(progress?: CampaignSequenceProgress) {
  if (!progress) {
    return null;
  }
  return {
    sequence: `${progress.current}/${progress.total}`,
    sent: `${progress.sent}/${progress.contacts}`,
  };
}

export const EMAIL_PLAN_LIMIT = 50000;
export const MAX_INDIVIDUAL_CONTACTS = 10;

const NO_STORE: RequestInit = { cache: "no-store" };

export function parseCampaignKind(value?: string | null): CampaignKind | undefined {
  return value === "oneone" || value === "drip" ? value : undefined;
}

function campaignKindSearch(kind?: CampaignKind) {
  return kind ? `?kind=${encodeURIComponent(kind)}` : "";
}

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

export async function fetchDripCampaigns(kind?: CampaignKind): Promise<DripCampaign[]> {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  const response = await fetch(`/api/campaigns${query}`, NO_STORE);
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
  kind?: CampaignKind,
): Promise<DripCampaign | null> {
  const response = await fetch(
    `/api/campaigns/${encodeURIComponent(id)}${campaignKindSearch(kind)}`,
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

export async function createDripCampaign(
  name: string,
  kind: CampaignKind = "drip",
): Promise<DripCampaign> {
  const response = await fetch("/api/campaigns", {
    ...NO_STORE,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind }),
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
  kind?: CampaignKind,
): Promise<DripCampaign> {
  const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}${campaignKindSearch(kind)}`, {
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

export async function deleteDripCampaign(
  id: string,
  kind?: CampaignKind,
): Promise<void> {
  const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}${campaignKindSearch(kind)}`, {
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

export async function duplicateDripCampaign(
  id: string,
  kind?: CampaignKind,
): Promise<DripCampaign> {
  const response = await fetch(
    `/api/campaigns/${encodeURIComponent(id)}/duplicate${campaignKindSearch(kind)}`,
    {
      ...NO_STORE,
      method: "POST",
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "Failed to duplicate campaign",
    );
  }
  return data as DripCampaign;
}
