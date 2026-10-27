import type { CampaignKind } from "@/lib/drip-campaigns";

export type KanbanStageRule = "delivered" | "opened" | "clicked" | "replied";

/** Stage triggers offered when creating a list, in funnel order. */
export const KANBAN_STAGE_RULES: Array<{ value: KanbanStageRule; label: string }> = [
  { value: "delivered", label: "Sent" },
  { value: "opened", label: "Open" },
  { value: "clicked", label: "Click" },
  { value: "replied", label: "Reply" },
];

const RULE_RANK: Record<KanbanStageRule, number> = {
  delivered: 0,
  opened: 1,
  clicked: 2,
  replied: 3,
};

export function isKanbanStageRule(value: unknown): value is KanbanStageRule {
  return typeof value === "string" && value in RULE_RANK;
}

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
  replied?: boolean;
  campaigns: string[];
  /** Earliest send time across linked campaigns. */
  sentAt?: string;
  /** Earliest open time across linked campaigns. */
  openedAt?: string;
  /** Device for the earliest open (mobile / tablet / desktop). */
  openedDevice?: string;
  /** True when open was inferred from a click (image pixel blocked). */
  openPixelBlocked?: boolean;
  /** Earliest click time across linked campaigns. */
  clickedAt?: string;
  /** Device for the earliest click (mobile / tablet / desktop). */
  clickedDevice?: string;
  /** Earliest reply time across linked campaigns. */
  repliedAt?: string;
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

/** Contact added to the board by hand (not only via linked campaigns). */
export type KanbanManualPerson = {
  email: string;
  fullName: string;
  companyName: string;
  contactId?: string;
  companyDomain?: string;
  companyLogoUrl?: string;
};

export type KanbanBoard = KanbanList & {
  stages: KanbanStage[];
  placements: Record<string, string>;
  /** Leads added manually from CRM contacts. */
  manualPeople: KanbanManualPerson[];
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

function personRank(person: KanbanPerson) {
  if (person.replied) {
    return RULE_RANK.replied;
  }
  if (person.clicked) {
    return RULE_RANK.clicked;
  }
  if (person.opened) {
    return RULE_RANK.opened;
  }
  return RULE_RANK.delivered;
}

/** Furthest stage the person has reached; null when the board has no stage for their level. */
export function autoStageId(person: KanbanPerson, stages: KanbanStage[]): string | null {
  const rank = personRank(person);
  let best: KanbanStage | null = null;
  for (const stage of stages) {
    if (!stage.rule) {
      continue;
    }
    const stageRank = RULE_RANK[stage.rule];
    if (stageRank <= rank && (!best || stageRank > RULE_RANK[best.rule!])) {
      best = stage;
    }
  }
  return best?.id ?? null;
}

export function stageIdForPerson(
  person: KanbanPerson,
  placements: Record<string, string>,
  stages: KanbanStage[],
): string | null {
  const email = person.email.trim().toLowerCase();
  const placed = placements[email];
  if (placed && stages.some((stage) => stage.id === placed)) {
    return placed;
  }
  return autoStageId(person, stages);
}

export function portalKanbanRoute(id: string) {
  return `/portal/analytics/kanban/${encodeURIComponent(id)}`;
}

/** Contacts page in “pick for kanban stage” mode. */
export function portalContactsKanbanPickRoute(
  boardId: string,
  stageId: string,
  stageName?: string,
) {
  const params = new URLSearchParams({
    kanban: boardId,
    stage: stageId,
  });
  const name = String(stageName ?? "").trim();
  if (name) {
    params.set("stageName", name);
  }
  return `/portal/crm/contacts?${params.toString()}`;
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
  stages?: Array<Pick<KanbanStage, "name" | "color" | "rule">>;
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
    manualPeople?: KanbanManualPerson[];
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

/** Build a board card from a CRM contact (no campaign engagement yet). */
export function kanbanPersonFromContact(contact: {
  id: string;
  email: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}): KanbanPerson {
  const email = contact.email.trim().toLowerCase();
  const fullName =
    String(contact.fullName ?? "").trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    email;
  const companyName = String(contact.companyName ?? "").trim();
  const companyDomain = companyDomainFromEmail(email);
  return {
    id: `manual:${email}`,
    email,
    fullName,
    companyName,
    contactId: contact.id,
    ...(companyDomain
      ? {
          companyDomain,
          companyLogoUrl: companyBrandLogoUrl(companyDomain),
        }
      : {}),
    delivered: false,
    opened: false,
    clicked: false,
    replied: false,
    campaigns: [],
  };
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
