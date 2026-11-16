/** LinkedIn campaigns run on the project's virtual machine, using one saved login. */

export type LinkedinSession = {
  connected: boolean;
  accountName: string;
  connectedAt?: string;
  boatReady: boolean;
};

export type LinkedinPerson = {
  name: string;
  linkedinUrl: string;
  messages: string[];
  alreadyConnected?: boolean;
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
  status: "running" | "complete";
  messageLabels: string[];
  delayAfterAcceptDays: number;
  delayAfterMessageDays: number;
  peopleCount: number;
  requestCount: number;
  connectedCount: number;
  messageCount: number;
  createdAt: string;
};

export type LinkedinStage = {
  id: string;
  label: string;
};

export type LinkedinCampaignDetail = LinkedinCampaign & {
  columns: LinkedinBoardColumn[];
  contacts: LinkedinContact[];
  sending: boolean;
};

const STAGE_COLORS = ["#94a3b8", "#3b82f6", "#16a34a", "#7c3aed", "#db2777", "#ea580c", "#0891b2"];

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
  customStages.forEach((stage, index) => {
    columns.push({
      id: stage.id,
      label: stage.label,
      color: STAGE_COLORS[(index + 5) % STAGE_COLORS.length],
    });
  });
  columns.push({ id: "reply", label: "Reply", color: "#0f766e" });
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
  const linkedinCol = columns.find((column) => column.kind?.kind === "linkedin");
  const connectedCol = columns.find((column) => column.kind?.kind === "connected");
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
    const name = (nameCol ? row[nameCol.index] || "" : "").trim() || "Unknown";
    const alreadyConnected = connectedCol
      ? isConnectedValue(row[connectedCol.index] || "")
      : false;
    people.push({ name, linkedinUrl, messages, alreadyConnected });
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

export async function addLinkedinStage(id: string, label: string) {
  const response = await fetch(`/api/linkedin/campaigns/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add-stage", label }),
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
  csv: string;
  delayAfterAcceptDays: number;
  delayAfterMessageDays: number;
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
  if (["name", "full name", "fullname", "first name", "contact", "contact name"].includes(key)) {
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
