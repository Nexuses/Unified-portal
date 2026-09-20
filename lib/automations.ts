import {
  patchDripCampaign,
  type CampaignKind,
  type DripCampaign,
} from "@/lib/drip-campaigns";

export type AutomationStatus = "draft" | "scheduled" | "running" | "completed";

export type AutomationEngagement = "opens" | "clicks" | "opens_or_clicks";
export type AutomationWhoSource = "current" | "past";

export const AUTOMATION_CAMPAIGN_TAG = "automation";
export const AUTOMATION_FOLLOW_UP_TAG = "automation-follow-up";

export type AutomationStep = {
  id: string;
  type: "email";
  campaignId?: string;
  campaignKind?: CampaignKind;
  waitDays?: number;
  waitHours?: number;
  whoSource?: AutomationWhoSource;
  pastCampaignId?: string;
  pastCampaignKind?: CampaignKind;
  pastCampaignName?: string;
  engagement?: AutomationEngagement;
};

export type PortalAutomation = {
  id: string;
  name: string;
  kind: CampaignKind;
  status: AutomationStatus;
  steps: AutomationStep[];
  createdAt: string;
  updatedAt: string;
};

export type CreateAutomationInput = {
  name?: string;
  kind?: CampaignKind;
  steps?: AutomationStep[];
  status?: AutomationStatus;
};

export type PatchAutomationInput = {
  name?: string;
  kind?: CampaignKind;
  steps?: AutomationStep[];
  status?: AutomationStatus;
};

const NO_STORE = { cache: "no-store" as const };

export async function fetchAutomations(options?: {
  nonEmptyOnly?: boolean;
}): Promise<PortalAutomation[]> {
  const params = new URLSearchParams();
  if (options?.nonEmptyOnly) {
    params.set("nonEmpty", "1");
  }
  const query = params.toString();
  const response = await fetch(
    `/api/automations${query ? `?${query}` : ""}`,
    NO_STORE,
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to load automations",
    );
  }
  return Array.isArray(data) ? (data as PortalAutomation[]) : [];
}

export async function fetchAutomation(
  id: string,
): Promise<PortalAutomation | null> {
  const response = await fetch(
    `/api/automations/${encodeURIComponent(id)}`,
    NO_STORE,
  );
  if (response.status === 404) {
    return null;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to load automation",
    );
  }
  return data as PortalAutomation;
}

export async function createAutomation(
  input: CreateAutomationInput = {},
): Promise<PortalAutomation> {
  const response = await fetch("/api/automations", {
    ...NO_STORE,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to create automation",
    );
  }
  return data as PortalAutomation;
}

export async function patchAutomation(
  id: string,
  patch: PatchAutomationInput,
): Promise<PortalAutomation> {
  const response = await fetch(`/api/automations/${encodeURIComponent(id)}`, {
    ...NO_STORE,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to update automation",
    );
  }
  return data as PortalAutomation;
}

export async function deleteAutomation(id: string): Promise<void> {
  const response = await fetch(`/api/automations/${encodeURIComponent(id)}`, {
    ...NO_STORE,
    method: "DELETE",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to delete automation",
    );
  }
}

export function portalAutomationRoute(id: string) {
  return `/portal/marketing/automation/${encodeURIComponent(id)}`;
}

export function portalAutomationHistoryRoute() {
  return "/portal/marketing/automation-history";
}

export function campaignHasAutomationTag(
  campaign: Pick<DripCampaign, "tags"> | null | undefined,
) {
  const tags = campaign?.tags ?? [];
  return (
    tags.includes(AUTOMATION_CAMPAIGN_TAG) ||
    tags.includes(AUTOMATION_FOLLOW_UP_TAG)
  );
}

export async function collectAutomationCampaignIds(): Promise<Set<string>> {
  const list = await fetchAutomations();
  const ids = new Set<string>();
  for (const automation of list) {
    for (const step of automation.steps ?? []) {
      if (step.campaignId) {
        ids.add(step.campaignId);
      }
    }
  }
  return ids;
}

/** Tag campaigns that are linked from Automation steps but missing the badge tag. */
export async function ensureAutomationCampaignTags(
  campaigns: DripCampaign[],
  kind?: CampaignKind,
): Promise<DripCampaign[]> {
  if (campaigns.length === 0) {
    return campaigns;
  }
  let linkedIds: Set<string>;
  try {
    linkedIds = await collectAutomationCampaignIds();
  } catch {
    return campaigns;
  }
  if (linkedIds.size === 0) {
    return campaigns;
  }

  return Promise.all(
    campaigns.map(async (campaign) => {
      if (!linkedIds.has(campaign.id) || campaignHasAutomationTag(campaign)) {
        return campaign;
      }
      const tags = [
        ...new Set([...(campaign.tags ?? []), AUTOMATION_CAMPAIGN_TAG]),
      ];
      try {
        return await patchDripCampaign(
          campaign.id,
          { tags },
          kind ?? (campaign.kind === "oneone" ? "oneone" : "drip"),
        );
      } catch {
        return { ...campaign, tags };
      }
    }),
  );
}
