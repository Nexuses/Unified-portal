import type { CampaignKind } from "@/lib/drip-campaigns";

export type KanbanStageRule = "delivered" | "opened" | "clicked";

export type KanbanStage = {
  id: string;
  name: string;
  color: string;
  system?: boolean;
  rule?: KanbanStageRule;
};

export const KANBAN_DOT_COLORS = [
  "#3b82f6",
  "#f97316",
  "#8b5cf6",
  "#22c55e",
  "#ef4444",
  "#eab308",
  "#14b8a6",
  "#64748b",
] as const;

export const DEFAULT_STAGE_COLOR = KANBAN_DOT_COLORS[3];

export type KanbanCampaignRef = {
  campaignId: string;
  kind: CampaignKind;
  name: string;
};

export type KanbanPerson = {
  id: string;
  email: string;
  fullName: string;
  companyName: string;
  /** Corporate domain used to resolve a brand logo. */
  companyDomain?: string;
  /** Primary brand logo URL (Clearbit). */
  companyLogoUrl?: string;
  contactId?: string;
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
  campaigns: string[];
  lastActivityAt?: string;
};

const FREE_EMAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "mail.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "yandex.com",
  "gmx.com",
  "zoho.com",
]);

export function isFreeEmailHost(domain: string) {
  return FREE_EMAIL_HOSTS.has(domain.trim().toLowerCase());
}

export function companyDomainFromEmail(email: string) {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || isFreeEmailHost(domain) || !domain.includes(".")) {
    return undefined;
  }
  return domain;
}

/** Real brand mark via Clearbit Logo API. */
export function companyBrandLogoUrl(domain: string) {
  return `https://logo.clearbit.com/${encodeURIComponent(domain)}`;
}

/** Favicon fallback when Clearbit has no mark. */
export function companyFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

export type KanbanList = {
  id: string;
  name: string;
  campaigns: KanbanCampaignRef[];
  createdAt: string;
  updatedAt: string;
};

export type KanbanBoard = KanbanList & {
  stages: KanbanStage[];
  placements: Record<string, string>;
  people: KanbanPerson[];
};

export const DEFAULT_KANBAN_STAGES: KanbanStage[] = [
  {
    id: "prospect",
    name: "Prospect",
    color: "#3b82f6",
    system: true,
    rule: "delivered",
  },
  {
    id: "engage",
    name: "Engage",
    color: "#f97316",
    system: true,
    rule: "opened",
  },
  {
    id: "cold",
    name: "Cold",
    color: "#8b5cf6",
    system: true,
    rule: "clicked",
  },
];

export function autoStageId(person: KanbanPerson): string {
  if (person.clicked) {
    return "cold";
  }
  if (person.opened) {
    return "engage";
  }
  return "prospect";
}

export function stageIdForPerson(
  person: KanbanPerson,
  placements: Record<string, string>,
  stages: KanbanStage[],
) {
  const email = person.email.trim().toLowerCase();
  const placed = placements[email];
  if (placed && stages.some((stage) => stage.id === placed)) {
    return placed;
  }
  return autoStageId(person);
}

export function portalKanbanRoute(id: string) {
  return `/portal/analytics/kanban/${encodeURIComponent(id)}`;
}

export async function fetchKanbanLists(): Promise<KanbanList[]> {
  const response = await fetch("/api/analytics/kanban", { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to load lists",
    );
  }
  return Array.isArray(data) ? (data as KanbanList[]) : [];
}

export async function createKanbanList(input: {
  name: string;
  campaigns: KanbanCampaignRef[];
}): Promise<KanbanBoard> {
  const response = await fetch("/api/analytics/kanban", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to create list",
    );
  }
  return data as KanbanBoard;
}

export async function fetchKanbanBoard(id: string): Promise<KanbanBoard> {
  const response = await fetch(
    `/api/analytics/kanban/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to load kanban",
    );
  }
  return data as KanbanBoard;
}

export async function patchKanbanBoard(
  id: string,
  patch: {
    stages?: KanbanStage[];
    placements?: Record<string, string>;
    campaigns?: KanbanCampaignRef[];
  },
): Promise<KanbanBoard> {
  const response = await fetch(`/api/analytics/kanban/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to save kanban",
    );
  }
  return data as KanbanBoard;
}

export async function chatKanbanBoard(
  id: string,
  input: { message: string; history?: Array<{ role: string; content: string }> },
): Promise<{ reply: string; board: KanbanBoard }> {
  const response = await fetch(
    `/api/analytics/kanban/${encodeURIComponent(id)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to chat",
    );
  }
  return data as { reply: string; board: KanbanBoard };
}

export async function deleteKanbanList(id: string): Promise<void> {
  const response = await fetch(`/api/analytics/kanban/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to delete list",
    );
  }
}
