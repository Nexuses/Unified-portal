import { DEFAULT_STAGE_COLOR, KANBAN_DOT_COLORS } from "@/lib/analytics-kanban";

/** LinkedIn campaigns run on the project's virtual machine, using one saved login. */

export type LinkedinSession = {
  connected: boolean;
  accountName: string;
  accountPhoto?: string;
  connectedAt?: string;
  boatReady: boolean;
};

export type LinkedinPerson = {
  name: string;
  firstName: string;
  lastName: string;
  companyName: string;
  linkedinUrl: string;
  messages: string[];
  alreadyConnected?: boolean;
  /** True when the CSV asked to like their latest post. */
  likeRecentPost?: boolean;
};

export type LinkedinBoardColumn = {
  id: string;
  label: string;
  color: string;
};

export type LinkedinContact = {
  id: string;
  name: string;
  linkedinUrl: string;
  stage: string;
  alreadyConnected: boolean;
  message: string;
  note?: string;
  crmContactId?: string;
};

export type LinkedinCsvPreview = {
  messageLabels: string[];
  people: LinkedinPerson[];
  skipped: number;
  blankMessages: number;
};

export type LinkedinCampaign = {
  id: string;
  name: string;
  status: "running" | "paused" | "complete";
  messageLabels: string[];
  delayAfterAcceptDays: number;
  delayAfterMessageDays: number;
  peopleCount: number;
  requestCount: number;
  connectedCount: number;
  messageCount: number;
  requestsSent: number;
  messagesSent: number;
  replyCount: number;
  createdAt: string;
  listName?: string;
  sendDays?: number[];
  windowStart?: string;
  windowEnd?: string;
  timezone?: string;
};

export type LinkedinStage = {
  id: string;
  label: string;
  color?: string;
};

export type LinkedinCampaignDetail = LinkedinCampaign & {
  columns: LinkedinBoardColumn[];
  contacts: LinkedinContact[];
  sending: boolean;
};

const STAGE_COLORS = ["#94a3b8", "#3b82f6", "#16a34a", "#7c3aed", "#db2777", "#ea580c", "#0891b2"];

function stageDotColor(color?: string) {
  return (KANBAN_DOT_COLORS as readonly string[]).includes(color || "")
    ? color || DEFAULT_STAGE_COLOR
    : DEFAULT_STAGE_COLOR;
}

export function linkedinBoardColumns(
  messageLabels: string[],
  customStages: LinkedinStage[] = [],
): LinkedinBoardColumn[] {
  const columns: LinkedinBoardColumn[] = [
    { id: "prospect", label: "Prospect", color: STAGE_COLORS[0] },
    { id: "request_sent", label: "Sent connection request", color: STAGE_COLORS[1] },
    { id: "connection_rejected", label: "Connection rejected", color: "#b91c1c" },
    { id: "connected", label: "Connected", color: STAGE_COLORS[2] },
  ];
  messageLabels.forEach((label, index) => {
    columns.push({
      id: `message_${index + 1}`,
      label,
      color: STAGE_COLORS[(index + 3) % STAGE_COLORS.length],
    });
  });
  columns.push({ id: "reply", label: "Reply", color: "#0f766e" });
  customStages.forEach((stage) => {
    columns.push({
      id: stage.id,
      label: stage.label,
      color: stageDotColor(stage.color),
    });
  });
  return columns;
}

/** Already-connected people skip the request and wait on Connected before message 1. */
export function launchLinkedinStage(person: LinkedinPerson) {
  if (person.alreadyConnected) return "connected";
  return "request_sent";
}

export function parseLinkedinCsv(text: string): LinkedinCsvPreview {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { messageLabels: [], people: [], skipped: 0, blankMessages: 0 };
  }
  const headers = rows[0].map((cell) => cell.trim());
  const columns = headers.map((header, index) => ({
    index,
    kind: headerKind(header),
  }));
  const nameCol = columns.find((column) => column.kind?.kind === "name");
  const firstCol = columns.find((column) => column.kind?.kind === "first");
  const lastCol = columns.find((column) => column.kind?.kind === "last");
  const companyCol = columns.find((column) => column.kind?.kind === "company");
  const linkedinCol = columns.find((column) => column.kind?.kind === "linkedin");
  const connectedCol = columns.find((column) => column.kind?.kind === "connected");
  const likeCol = columns.find((column) => column.kind?.kind === "like");
  const messageCols = columns
    .filter((column) => column.kind?.kind === "message")
    .sort((a, b) => (a.kind?.index ?? 0) - (b.kind?.index ?? 0) || a.index - b.index);

  const messageLabels = messageCols.map((column, position) => {
    const number = column.kind?.index || position + 1;
    return `Message ${number}`;
  });

  const people: LinkedinPerson[] = [];
  let skipped = 0;
  let blankMessages = 0;
  for (const row of rows.slice(1)) {
    const linkedinUrl = normaliseLinkedinUrl(
      linkedinCol ? row[linkedinCol.index] || "" : "",
    );
    if (!linkedinUrl) {
      if (row.some((cell) => cell.trim())) skipped += 1;
      continue;
    }
    const messages = messageCols.map((column) => (row[column.index] || "").trim());
    blankMessages += messages.filter((message) => !message).length;
    const explicitFirst = (firstCol ? row[firstCol.index] || "" : "").trim();
    const explicitLast = (lastCol ? row[lastCol.index] || "" : "").trim();
    const fromName = splitPersonName(nameCol ? row[nameCol.index] || "" : "");
    let firstName = explicitFirst;
    let lastName = explicitLast;
    if (firstCol || lastCol) {
      if (!explicitFirst || !explicitLast) {
        const split = splitPersonName(explicitFirst || explicitLast);
        firstName = split.firstName;
        lastName = split.lastName;
      }
    } else {
      firstName = fromName.firstName;
      lastName = fromName.lastName;
    }
    const companyName = (companyCol ? row[companyCol.index] || "" : "").trim();
    const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
    const alreadyConnected = connectedCol
      ? isConnectedValue(row[connectedCol.index] || "")
      : false;
    const likeRecentPost = likeCol ? isConnectedValue(row[likeCol.index] || "") : false;
    people.push({
      name,
      firstName,
      lastName,
      companyName,
      linkedinUrl,
      messages,
      alreadyConnected,
      ...(likeRecentPost ? { likeRecentPost: true } : {}),
    });
    if (people.length >= 500) break;
  }

  return { messageLabels, people, skipped, blankMessages };
}

export function countLinkedinMessages(people: LinkedinPerson[]) {
  return people.reduce(
    (total, person) => total + person.messages.filter((message) => message.trim()).length,
    0,
  );
}

export async function fetchLinkedinSession() {
  const response = await fetch("/api/linkedin/session", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as {
    session?: LinkedinSession;
    error?: string;
  };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Could not load LinkedIn");
  }
  return data.session;
}

export async function openLinkedinSession() {
  const response = await fetch("/api/linkedin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "open" }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    desktopUrl?: string;
    session?: LinkedinSession;
    error?: string;
  };
  if (!response.ok || !data.desktopUrl || !data.session) {
    throw new Error(data.error || "Could not open the virtual machine");
  }
  return { desktopUrl: data.desktopUrl, session: data.session };
}

export async function confirmLinkedinSession(accountName: string) {
  const response = await fetch("/api/linkedin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", accountName }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    session?: LinkedinSession;
    error?: string;
  };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Could not save the LinkedIn login");
  }
  return data.session;
}

export async function disconnectLinkedinSession() {
  const response = await fetch("/api/linkedin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "disconnect" }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    session?: LinkedinSession;
    error?: string;
  };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Could not disconnect LinkedIn");
  }
  return data.session;
}

export async function captureLinkedinAccountPhoto() {
  const response = await fetch("/api/linkedin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "photo" }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    session?: LinkedinSession;
    error?: string;
  };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Could not load the LinkedIn photo");
  }
  return data.session;
}

export async function fetchLinkedinCampaigns() {
  const response = await fetch("/api/linkedin/campaigns", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as {
    campaigns?: LinkedinCampaign[];
    error?: string;
  };
  if (!response.ok || !data.campaigns) {
    throw new Error(data.error || "Could not load campaigns");
  }
  return data.campaigns;
}

export async function setLinkedinCampaignPaused(id: string, paused: boolean) {
  const response = await fetch(`/api/linkedin/campaigns/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: paused ? "pause" : "resume" }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    campaign?: LinkedinCampaignDetail;
    error?: string;
  };
  if (!response.ok || !data.campaign) {
    throw new Error(data.error || (paused ? "Could not pause the campaign" : "Could not resume the campaign"));
  }
  return data.campaign;
}

export async function deleteLinkedinCampaigns(ids: string[]) {
  const response = await fetch("/api/linkedin/campaigns", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Could not delete campaigns");
  }
  return { deleted: Number(data.deleted ?? 0) };
}

export async function fetchLinkedinCampaign(id: string) {
  const response = await fetch(`/api/linkedin/campaigns/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    campaign?: LinkedinCampaignDetail;
    error?: string;
  };
  if (!response.ok || !data.campaign) {
    throw new Error(data.error || "Could not load the campaign");
  }
  return data.campaign;
}

export async function addLinkedinStage(id: string, label: string, color: string) {
  const response = await fetch(`/api/linkedin/campaigns/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add-stage", label, color }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    campaign?: LinkedinCampaignDetail;
    error?: string;
  };
  if (!response.ok || !data.campaign) {
    throw new Error(data.error || "Could not add the stage");
  }
  return data.campaign;
}

export async function moveLinkedinContact(id: string, contactId: string, stage: string) {
  const response = await fetch(`/api/linkedin/campaigns/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "move", contactId, stage }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    campaign?: LinkedinCampaignDetail;
    error?: string;
  };
  if (!response.ok || !data.campaign) {
    throw new Error(data.error || "Could not move the contact");
  }
  return data.campaign;
}

export async function startLinkedinCampaign(input: {
  name: string;
  listName: string;
  csv: string;
  fileName?: string;
  delayAfterAcceptDays: number;
  delayAfterMessageDays: number;
  sendDays: number[];
  windowStart: string;
  windowEnd: string;
  timezone: string;
}) {
  const response = await fetch("/api/linkedin/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => ({}))) as {
    campaign?: LinkedinCampaign;
    desktopUrl?: string;
    error?: string;
  };
  if (!response.ok || !data.campaign) {
    throw new Error(data.error || "Could not start the campaign");
  }
  return { campaign: data.campaign, desktopUrl: data.desktopUrl };
}

function headerKind(header: string) {
  const key = header
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (["first name", "firstname", "given name"].includes(key)) {
    return { kind: "first" as const, index: 0 };
  }
  if (["last name", "lastname", "surname", "family name"].includes(key)) {
    return { kind: "last" as const, index: 0 };
  }
  if (
    ["company", "company name", "organization", "organisation", "account", "account name"].includes(
      key,
    )
  ) {
    return { kind: "company" as const, index: 0 };
  }
  if (["name", "full name", "fullname", "contact", "contact name"].includes(key)) {
    return { kind: "name" as const, index: 0 };
  }
  if (
    [
      "linkedin",
      "linkedin account",
      "linkedin url",
      "linkedin profile",
      "profile",
      "profile url",
      "url",
    ].includes(key)
  ) {
    return { kind: "linkedin" as const, index: 0 };
  }
  if (
    ["connected", "already connected", "connection status", "already a connection"].includes(key)
  ) {
    return { kind: "connected" as const, index: 0 };
  }
  if (
    ["like recent post", "like post", "like latest post", "recent post"].includes(key)
  ) {
    return { kind: "like" as const, index: 0 };
  }
  const message = key.match(/^(?:message|msg)\s*(\d+)?$/);
  if (message) {
    return { kind: "message" as const, index: message[1] ? Number(message[1]) : 1 };
  }
  return null;
}

export function normaliseLinkedinUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function splitPersonName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function isConnectedValue(value: string) {
  return ["yes", "y", "true", "1", "connected", "already connected"].includes(
    value.trim().toLowerCase(),
  );
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
