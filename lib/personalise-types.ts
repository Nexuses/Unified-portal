export type PersonaliseStep = {
  label: string;
  /** Days after the first email. The first email is 0. */
  day: number;
  /** Empty when this step stays on the previous thread. */
  subject: string;
  body: string;
};

export type PersonaliseContact = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  position: string;
  personalLinkedIn: string;
  steps: PersonaliseStep[];
};

export type PersonalisePlan = {
  listName: string;
  fileName: string;
  contacts: PersonaliseContact[];
};

export type PersonaliseSentStep = {
  day: number;
  delayDays: number;
  subject: string;
  html: string;
  status: "pending" | "sending" | "sent" | "failed";
  error?: string;
  sentAt?: string;
  availableAt?: string;
};

export type PersonaliseSentContact = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  position: string;
  personalLinkedIn: string;
  repliedAt?: string;
  unsubscribedAt?: string;
  steps: PersonaliseSentStep[];
};

export type PersonaliseCampaignSnapshot = {
  campaignId: string;
  name: string;
  status: string;
  listName: string;
  senderEmail: string;
  senderProvider: string;
  windowStart: string;
  windowEnd: string;
  emailGapMinutes: number;
  scheduledFor?: string;
  contacts: PersonaliseSentContact[];
};

const MAX_CONTACTS = 500;
const MAX_STEPS = 30;

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "";
  }
  return email;
}

function cleanLinkedIn(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/linkedin\.com\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, "")}`;
  }
  return "";
}

function cleanDay(value: unknown) {
  const day = Number(value);
  if (!Number.isFinite(day)) {
    return 0;
  }
  return Math.max(0, Math.round(day));
}

export function stepDelayDays(steps: Array<Pick<PersonaliseStep, "day">>) {
  return steps.map((step, index) => {
    if (index === 0) {
      return 0;
    }
    return Math.max(0, step.day - steps[index - 1].day);
  });
}

export type PitchInline = { text: string; bold?: boolean };

export type PitchBullet = { label?: string; text: PitchInline[] };

export type PitchBlock =
  | { type: "paragraph"; text: PitchInline[] }
  | { type: "list"; items: PitchBullet[] }
  | { type: "signoff"; lines: string[] };

const SIGNOFF_RE =
  /^(with respect|with regards|best regards|kind regards|warm regards|regards|best|thanks|thank you|many thanks|sincerely|cheers|yours sincerely|yours truly)\s*,\s*/i;
const BULLET_RE = /^\s*(?:[-•*▪●◦]|\d{1,2}[.)])\s+(.*)$/;
const LABEL_RE = /^([^:\n]{2,60}):\s+(\S.*)$/;

function inlineMarks(text: string): PitchInline[] {
  const parts: PitchInline[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index) });
    }
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last) });
  }
  return parts.length > 0 ? parts : [{ text }];
}

function labelBullet(line: string): PitchBullet | null {
  const match = line.match(LABEL_RE);
  if (!match) {
    return null;
  }
  const label = match[1].trim();
  if (label.split(/\s+/).length > 8 || /[.!?]$/.test(label)) {
    return null;
  }
  return { label, text: inlineMarks(match[2].trim()) };
}

function splitSignoff(lines: string[]) {
  const out: string[] = [];
  for (const line of lines) {
    const match = line.match(SIGNOFF_RE);
    const rest = match ? line.slice(match[0].length) : "";
    if (match && rest && rest.length <= 120 && !/[.!?]$/.test(rest)) {
      out.push(line.slice(0, match[0].length).trim());
      out.push(line.slice(match[0].length).trim());
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Turns plain pitch text into paragraphs, bullet lists, and a sign-off. */
export function pitchBlocks(body: string): PitchBlock[] {
  const lines = splitSignoff(
    body
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const blocks: PitchBlock[] = [];
  let list: PitchBullet[] | null = null;
  let listIntro = false;

  const closeList = () => {
    if (list && list.length > 0) {
      blocks.push({ type: "list", items: list });
    }
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (SIGNOFF_RE.test(`${line} `) && /,\s*$/.test(line)) {
      closeList();
      blocks.push({ type: "signoff", lines: lines.slice(index) });
      return blocks;
    }

    const marked = line.match(BULLET_RE);
    if (marked) {
      list = list ?? [];
      const labelled = labelBullet(marked[1]);
      list.push(labelled ?? { text: inlineMarks(marked[1]) });
      continue;
    }

    const labelled = labelBullet(line);
    const nextLabelled = index + 1 < lines.length && labelBullet(lines[index + 1]);
    if (labelled && (list || listIntro || nextLabelled)) {
      list = list ?? [];
      list.push(labelled);
      continue;
    }

    closeList();
    blocks.push({ type: "paragraph", text: inlineMarks(line) });
    listIntro = /:\s*$/.test(line);
  }

  closeList();
  return blocks;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(parts: PitchInline[]) {
  return parts
    .map((part) =>
      part.bold ? `<strong>${escapeHtml(part.text)}</strong>` : escapeHtml(part.text),
    )
    .join("");
}

export function pitchToHtml(body: string) {
  const html = pitchBlocks(body)
    .map((block) => {
      if (block.type === "list") {
        const items = block.items
          .map(
            (item) =>
              `<li style="display:list-item;list-style-type:disc;margin:0 0 6px">${item.label ? `<strong>${escapeHtml(item.label)}:</strong> ` : ""}${inlineHtml(item.text)}</li>`,
          )
          .join("");
        return `<ul style="list-style-type:disc;list-style-position:outside;margin:0 0 14px;padding-left:24px">${items}</ul>`;
      }
      if (block.type === "signoff") {
        return `<p style="margin:18px 0 0">${block.lines.map(escapeHtml).join("<br>")}</p>`;
      }
      return `<p style="margin:0 0 14px">${inlineHtml(block.text)}</p>`;
    })
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222">${html}</div>`;
}

export function contactNeedsEmail(contact: PersonaliseContact) {
  return !cleanEmail(contact.email);
}

export function normalizePersonalisePlan(
  input: unknown,
  fileName = "",
): PersonalisePlan {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawContacts = Array.isArray(record.contacts) ? record.contacts : [];
  const seen = new Set<string>();
  const contacts: PersonaliseContact[] = [];

  for (const item of rawContacts) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const firstName = asText(row.firstName);
    const lastName = asText(row.lastName);
    if (!firstName && !lastName) {
      continue;
    }
    const rawSteps = Array.isArray(row.steps) ? row.steps : [];
    const steps: PersonaliseStep[] = [];
    for (const stepItem of rawSteps) {
      if (!stepItem || typeof stepItem !== "object") {
        continue;
      }
      const step = stepItem as Record<string, unknown>;
      const body = asText(step.body);
      if (!body) {
        continue;
      }
      steps.push({
        label: asText(step.label) || (steps.length === 0 ? "First email" : `Follow-up ${steps.length}`),
        day: steps.length === 0 ? 0 : cleanDay(step.day),
        subject: asText(step.subject),
        body,
      });
      if (steps.length >= MAX_STEPS) {
        break;
      }
    }
    if (steps.length === 0) {
      continue;
    }
    for (let index = 1; index < steps.length; index += 1) {
      steps[index].day = Math.max(steps[index].day, steps[index - 1].day);
    }
    if (!steps[0].subject) {
      steps[0].subject = "Hello";
    }
    const email = cleanEmail(asText(row.email));
    if (email && seen.has(email)) {
      continue;
    }
    if (email) {
      seen.add(email);
    }
    contacts.push({
      firstName: firstName || lastName,
      lastName: firstName ? lastName : "",
      email,
      companyName: asText(row.companyName),
      position: asText(row.position),
      personalLinkedIn: cleanLinkedIn(asText(row.personalLinkedIn)),
      steps,
    });
    if (contacts.length >= MAX_CONTACTS) {
      break;
    }
  }

  const listName = asText(record.listName) || "Personalise campaign";
  if (contacts.length === 0) {
    throw new Error("No contacts with a pitch were found in that file.");
  }

  return {
    listName,
    fileName: fileName.trim(),
    contacts,
  };
}
