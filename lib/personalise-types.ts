import { splitPersonName } from "@/lib/email-variables";

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

export type PersonaliseEmailFix = {
  contactLabel: string;
  from: string;
  to: string;
};

export type PersonalisePlan = {
  listName: string;
  fileName: string;
  contacts: PersonaliseContact[];
  /** Emails that were auto-formatted from the uploaded file. */
  emailFixes?: PersonaliseEmailFix[];
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
  senderId: string;
  senderEmail: string;
  senderProvider: string;
  replyTo: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  sendStartDay: number;
  sendEndDay: number;
  emailGapMinutes: number;
  scheduledFor?: string;
  contacts: PersonaliseSentContact[];
};

const MAX_CONTACTS = 500;
const MAX_STEPS = 30;

export function cleanReplyTo(value: string) {
  const email = value.trim().toLowerCase();
  if (!email) {
    return "";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function asText(value: unknown) {
  return String(value ?? "").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize messy spreadsheet emails into a sendable address.
 * Examples: "mailto:A@B.com", "a @ b . com", "a [at] b [dot] com", "Name <a@b.com>"
 */
export function formatPersonaliseEmail(value: string) {
  let email = String(value ?? "").trim();
  if (!email) {
    return "";
  }

  const angle = email.match(/<([^<>]*@[^<>]+)>/);
  if (angle) {
    email = angle[1].trim();
  } else {
    email = email.replace(/^mailto:/i, "").trim();
  }

  // Keep the token that looks most like an email when extra words are present.
  if (/\s/.test(email) && /@/.test(email)) {
    const token = email
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .find((part) => part.includes("@"));
    if (token) {
      email = token;
    }
  }

  email = email
    .replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi, "@")
    .replace(/\s+\bat\b\s+/gi, "@")
    .replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi, ".")
    .replace(/\s+\bdot\b\s+/gi, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, "")
    .replace(/^[,;:<>"]+|[,;:<>"]+$/g, "")
    .toLowerCase();

  // Common typo: comma used as the TLD separator (name@domain,com).
  email = email.replace(/,([a-z]{2,})$/i, ".$1");

  if (!EMAIL_RE.test(email)) {
    return "";
  }
  return email;
}

function cleanEmail(value: string) {
  return formatPersonaliseEmail(value);
}

function emailWasReformatted(original: string, formatted: string) {
  if (!formatted) {
    return false;
  }
  const light = original.trim().toLowerCase().replace(/^mailto:/i, "").trim();
  return light !== formatted;
}

function contactLabel(firstName: string, lastName: string, email: string) {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || email || "Contact";
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

export const MAX_STEP_GAP_DAYS = 90;

/** Most common gap per follow-up in the file; index 0 is the first follow-up. */
export function defaultStepGaps(contacts: PersonaliseContact[]) {
  const longest = contacts.reduce((max, contact) => Math.max(max, contact.steps.length), 0);
  const gaps: number[] = [];
  for (let step = 1; step < longest; step += 1) {
    const counts = new Map<number, number>();
    for (const contact of contacts) {
      if (step >= contact.steps.length) continue;
      const gap = stepDelayDays(contact.steps)[step];
      counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
    let best = 3;
    let bestCount = 0;
    for (const [gap, count] of counts) {
      if (count > bestCount || (count === bestCount && gap < best)) {
        best = gap;
        bestCount = count;
      }
    }
    gaps.push(Math.min(MAX_STEP_GAP_DAYS, best));
  }
  return gaps;
}

/** Rewrites every contact's step days from the chosen gaps, replacing the file's days. */
export function applyStepGaps(contacts: PersonaliseContact[], gaps: number[]) {
  return contacts.map((contact) => {
    let day = 0;
    return {
      ...contact,
      steps: contact.steps.map((step, index) => {
        if (index > 0) day += Math.max(0, gaps[index - 1] ?? 0);
        return { ...step, day };
      }),
    };
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
const GREETING_RE =
  /^(hi|hello|hey|dear)\s+[A-Za-z][A-Za-z.'-]{0,40}(?:\s+[A-Za-z][A-Za-z.'-]{0,40}){0,3}\s*,\s+/i;
const TRAILING_SIGNOFF_RE =
  /\s+((?:with respect|with regards|best regards|kind regards|warm regards|regards|best|thanks|thank you|many thanks|sincerely|cheers|yours sincerely|yours truly)\s*,)\s+([A-Za-z][A-Za-z.'-]{0,40}(?:\s+[A-Za-z][A-Za-z.'-]{0,40}){0,2})\s*$/i;
const BULLET_RE = /^\s*(?:[-•*▪●◦]|\d{1,2}[.)])\s+(.*)$/;
const LABEL_RE = /^([^:\n]{2,60}):\s+(\S.*)$/;

/**
 * Spreadsheet cells often paste the whole pitch on one line. Expand that into
 * greeting / paragraphs / sign-off so preview and sent HTML read like email.
 * Well-formatted multi-paragraph bodies (blank lines already present) are left alone.
 */
export function expandCollapsedPitch(body: string) {
  const normalized = String(body ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
  if (!normalized) {
    return normalized;
  }

  // Author already used paragraph breaks — keep that formatting as written.
  if (/\n\s*\n/.test(normalized)) {
    return normalized.replace(/\n{3,}/g, "\n\n");
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const fusedGreeting = lines.some((line) => GREETING_RE.test(line) && line.length > 48);
  const fusedSignoff = lines.some((line) => TRAILING_SIGNOFF_RE.test(line));
  // Multi-line pitches with normal structure — leave spacing alone (long
  // paragraphs are common in real emails and must not trigger a reflow).
  if (lines.length > 1 && !fusedGreeting && !fusedSignoff) {
    return normalized;
  }

  let text = lines.join(" ").replace(/\s+/g, " ").trim();
  const parts: string[] = [];

  const greet = text.match(GREETING_RE);
  if (greet) {
    parts.push(greet[0].trim());
    text = text.slice(greet[0].length).trim();
  }

  const signoff = text.match(TRAILING_SIGNOFF_RE);
  let signoffLines: string[] = [];
  if (signoff && typeof signoff.index === "number") {
    signoffLines = [signoff[1].trim(), signoff[2].trim()];
    text = text.slice(0, signoff.index).trim();
  }

  const sentences =
    text
      .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? (text ? [text] : []);

  for (const sentence of sentences) {
    parts.push(sentence);
  }
  parts.push(...signoffLines);
  return parts.join("\n\n");
}

/** Labels whose values should always render bold in the email HTML. */
const IMPORTANT_LABEL_RE =
  /^(solutions?|products?|offerings?|platforms?|tools?|software|services?|modules?|features?|packages?|plans?|company|organisation|organization|client|brand|deck|demo|important|key(?:\s+points?)?|notes?|highlights?|benefits?|outcomes?|results?|impacts?|usp|roi|value)$/i;

/** Soft / conversational lines — never auto-bold as whole sentences. */
const SOFT_POINT_RE =
  /\b(hope (this|you)|just (wanted|checking|following)|reaching out|wanted to|following up|wondering if|would you|could we|let me know|looking forward|feel free|please (find|see|let)|thanks for|thank you for|may i|humbly ask)\b/i;

const IMPORTANT_CUE_RE =
  /^(important(?:ly)?|key(?:\s+point)?|note|n\.?b\.?|highlight|remember|pro tip|tip|worth noting|bottom line|tl;?dr)\b/i;

const METRIC_CLAIM_RE =
  /\d+\s*%|\b\d+[xX]\b|\$[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+\b|\b\d+\s*(?:hours?|days?|weeks?|months?|years?|mins?|minutes?)\b/i;

/** Common sentence starters that look like product names but aren’t. */
const NAME_STOPWORDS = new Set(
  [
    "Meanwhile",
    "Importantly",
    "However",
    "Therefore",
    "Additionally",
    "Furthermore",
    "Finally",
    "Also",
    "Here",
    "This",
    "That",
    "These",
    "Those",
    "There",
    "Our",
    "Your",
    "Their",
    "We",
    "I",
    "It",
    "Please",
    "Thanks",
    "Thank",
    "Hello",
    "Hi",
    "Dear",
    "Best",
    "Kind",
    "Warm",
    "May",
    "Just",
    "Looking",
    "Would",
    "Could",
    "Should",
    "With",
    "After",
    "Before",
    "Once",
    "When",
    "While",
    "Since",
    "Because",
    "Although",
    "Today",
    "Yesterday",
    "Tomorrow",
  ].map((word) => word.toLowerCase()),
);

function isImportantLabel(label: string) {
  return IMPORTANT_LABEL_RE.test(label.trim());
}

function stripBoldMarkers(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

/** Pointers / bullets always start with a capital letter in the rendered email. */
function capitalizePointer(text: string) {
  const match = String(text ?? "").match(/^(\s*)(\S)([\s\S]*)$/);
  if (!match) {
    return text;
  }
  if (!/[a-z]/.test(match[2])) {
    return text;
  }
  return `${match[1]}${match[2].toUpperCase()}${match[3]}`;
}

function splitSentences(text: string): string[] {
  return (
    text
      .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? (text.trim() ? [text.trim()] : [])
  );
}

function lineMentionsTerm(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (needle.length < 2) continue;
    let from = 0;
    while (from <= lower.length - needle.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      if (hasWordBoundary(text, index, term.length)) {
        return true;
      }
      from = index + 1;
    }
  }
  return false;
}

/**
 * Pitch lines worth bolding: product intros, showcase lines, metrics, and
 * declarative sentences that name the solution/company. Soft / greeting /
 * question lines stay plain. Bullets are handled separately (capitalized, not
 * fully bold).
 */
function isImportantSentence(text: string, emphasize: string[] = []) {
  const cleaned = stripBoldMarkers(text).trim();
  if (cleaned.length < 12 || cleaned.length > 220) {
    return false;
  }
  if (SOFT_POINT_RE.test(cleaned)) {
    return false;
  }
  if (GREETING_RE.test(`${cleaned} `) || SIGNOFF_RE.test(`${cleaned} `)) {
    return false;
  }
  if (/^(hi|hello|hey|dear)\b/i.test(cleaned)) {
    return false;
  }
  if (IMPORTANT_CUE_RE.test(cleaned) || METRIC_CLAIM_RE.test(cleaned)) {
    return true;
  }
  // "Shamil is an end-to-end workflow platform that could:"
  if (/\b[A-Z][A-Za-z0-9][\w&'.-]{1,38}\s+is\s+(?:an?|the)\s+/.test(cleaned)) {
    return true;
  }
  // "Labib, the AI assistant, shows how everything is moving."
  if (
    /,\s+the\s+(?:AI\s+)?(?:assistant|platform|tool|product|solution|app|agent|system|software)\b/i.test(
      cleaned,
    )
  ) {
    return true;
  }
  // Declarative line that names the product/company (skip questions).
  if (
    emphasize.length > 0 &&
    cleaned.length <= 180 &&
    !/[?]$/.test(cleaned) &&
    lineMentionsTerm(cleaned, emphasize)
  ) {
    return true;
  }
  return false;
}

function isLikelyProductName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 40) {
    return false;
  }
  if (NAME_STOPWORDS.has(trimmed.toLowerCase())) {
    return false;
  }
  // Prefer proper-looking names (Shamil, Labib, Nexus Guard).
  return /^[A-Z][A-Za-z0-9][\w&'.-]*(?:\s+[A-Z][A-Za-z0-9][\w&'.-]*){0,3}$/.test(
    trimmed,
  );
}

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

function hasWordBoundary(text: string, index: number, length: number) {
  const before = index === 0 || !/[A-Za-z0-9]/.test(text[index - 1] ?? "");
  const after =
    index + length >= text.length ||
    !/[A-Za-z0-9]/.test(text[index + length] ?? "");
  return before && after;
}

/**
 * Bold whole-word occurrences of important terms (company / solution names)
 * without undoing existing **markdown** bold spans.
 */
function emphasizeInline(parts: PitchInline[], terms: string[]): PitchInline[] {
  const cleaned = [
    ...new Set(
      terms
        .map((term) => String(term ?? "").trim())
        .filter((term) => term.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) {
    return parts;
  }

  const next: PitchInline[] = [];
  for (const part of parts) {
    if (part.bold || !part.text) {
      next.push(part);
      continue;
    }
    let remaining = part.text;
    while (remaining) {
      let earliest = -1;
      let hit = "";
      for (const term of cleaned) {
        const lower = remaining.toLowerCase();
        const needle = term.toLowerCase();
        let from = 0;
        while (from <= lower.length - needle.length) {
          const index = lower.indexOf(needle, from);
          if (index < 0) break;
          if (hasWordBoundary(remaining, index, term.length)) {
            if (earliest < 0 || index < earliest) {
              earliest = index;
              hit = remaining.slice(index, index + term.length);
            }
            break;
          }
          from = index + 1;
        }
      }
      if (earliest < 0 || !hit) {
        next.push({ text: remaining });
        break;
      }
      if (earliest > 0) {
        next.push({ text: remaining.slice(0, earliest) });
      }
      next.push({ text: hit, bold: true });
      remaining = remaining.slice(earliest + hit.length);
    }
  }
  return next.length > 0 ? next : parts;
}

/**
 * Markdown bold + important metric/cue sentences + company/product names.
 * Bullets stay normal weight (except names/labels) so the email doesn’t shout.
 */
function renderPitchInline(
  text: string,
  emphasize: string[],
  kind: "paragraph" | "bullet",
): PitchInline[] {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return [{ text: raw }];
  }

  // Author already used **bold** — keep that and only layer term emphasis.
  if (/\*\*.+?\*\*/.test(raw)) {
    return emphasizeInline(inlineMarks(raw), emphasize);
  }

  if (kind === "paragraph") {
    // Prefer bolding the whole line when it's an important pitch line.
    if (isImportantSentence(raw, emphasize)) {
      return [{ text: stripBoldMarkers(raw), bold: true }];
    }
    const sentences = splitSentences(raw);
    if (sentences.length > 1) {
      const parts: PitchInline[] = [];
      let cursor = 0;
      let anyImportant = false;
      for (const sentence of sentences) {
        const at = raw.indexOf(sentence, cursor);
        if (at > cursor) {
          parts.push({ text: raw.slice(cursor, at) });
        }
        if (isImportantSentence(sentence, emphasize)) {
          anyImportant = true;
          parts.push({ text: sentence, bold: true });
        } else {
          parts.push({ text: sentence });
        }
        cursor = at >= 0 ? at + sentence.length : cursor + sentence.length;
      }
      if (cursor < raw.length) {
        parts.push({ text: raw.slice(cursor) });
      }
      if (anyImportant) {
        return emphasizeInline(parts.length > 0 ? parts : [{ text: raw }], emphasize);
      }
    }
  }

  return emphasizeInline(inlineMarks(raw), emphasize);
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
  const value = match[2].trim();
  // Solution / product / company values stay bold; other labels stay plain.
  if (isImportantLabel(label)) {
    return {
      label,
      text: [{ text: stripBoldMarkers(value), bold: true }],
    };
  }
  return { label, text: inlineMarks(value) };
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

export type PitchRenderOptions = {
  /** Names to bold in the body (company, solution, etc.). */
  emphasize?: string[];
};

/** Turns plain pitch text into paragraphs, bullet lists, and a sign-off. */
export function pitchBlocks(
  body: string,
  options?: PitchRenderOptions,
): PitchBlock[] {
  const emphasize = options?.emphasize ?? [];
  const lines = splitSignoff(
    expandCollapsedPitch(body)
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
      const pointer = capitalizePointer(marked[1]);
      const labelled = labelBullet(pointer);
      if (labelled) {
        list.push({
          ...labelled,
          text: emphasizeInline(labelled.text, emphasize),
        });
      } else {
        list.push({
          text: renderPitchInline(pointer, emphasize, "bullet"),
        });
      }
      continue;
    }

    const labelled = labelBullet(line);
    const nextLabelled = index + 1 < lines.length && labelBullet(lines[index + 1]);
    if (labelled && (list || listIntro || nextLabelled)) {
      list = list ?? [];
      list.push({
        ...labelled,
        text: emphasizeInline(labelled.text, emphasize),
      });
      continue;
    }

    closeList();
    blocks.push({
      type: "paragraph",
      text: renderPitchInline(line, emphasize, "paragraph"),
    });
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

export const MAX_SIGNATURE_HTML = 20_000;

/** Keeps signature markup but drops scripts, embeds, and inline event handlers. */
export function cleanSignatureHtml(html: string) {
  return html
    .slice(0, MAX_SIGNATURE_HTML)
    .replace(/<(script|style|iframe|object|embed|form|textarea)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|form|meta|link|base|textarea)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim();
}

const CAMPAIGN_SIGNATURE_START = "<!--nexuses-signature-start-->";
const CAMPAIGN_SIGNATURE_END = "<!--nexuses-signature-end-->";

/** Removes a previously baked campaign signature block from design HTML. */
export function stripCampaignSignature(html: string) {
  return html
    .replace(
      /<!--nexuses-signature-start-->[\s\S]*?<!--nexuses-signature-end-->/gi,
      "",
    )
    .replace(
      /<div\s+[^>]*data-nexuses-signature=["']1["'][^>]*>[\s\S]*?<\/div>/gi,
      "",
    )
    .trim();
}

/**
 * Appends signature HTML to a sequence design body. Replaces any previous
 * baked signature so saving again does not stack duplicates.
 * Full email documents get the block inserted before `</body>` so it renders.
 */
export function applyCampaignSignature(html: string, signatureHtml: string) {
  const base = stripCampaignSignature(html || "");
  const signature = cleanSignatureHtml(signatureHtml);
  if (!base || !signature) {
    return base;
  }
  const block = `${CAMPAIGN_SIGNATURE_START}<div data-nexuses-signature="1" style="margin:18px 0 0">${signature}</div>${CAMPAIGN_SIGNATURE_END}`;
  if (/<\/body\s*>/i.test(base)) {
    return base.replace(/<\/body\s*>/i, `\n${block}\n</body>`);
  }
  return `${base}\n${block}`;
}

export function pitchToHtml(
  body: string,
  signatureHtml = "",
  options?: PitchRenderOptions,
) {
  const signature = cleanSignatureHtml(signatureHtml);
  const signatureBlock = signature ? `<div style="margin:8px 0 0">${signature}</div>` : "";
  let signed = false;
  const html = pitchBlocks(body, options)
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
        if (signature) {
          signed = true;
          return `<p style="margin:18px 0 0">${escapeHtml(block.lines[0])}</p>${signatureBlock}`;
        }
        return `<p style="margin:18px 0 0">${block.lines.map(escapeHtml).join("<br>")}</p>`;
      }
      return `<p style="margin:0 0 14px">${inlineHtml(block.text)}</p>`;
    })
    .join("")
    .concat(signature && !signed ? `<div style="margin:18px 0 0">${signature}</div>` : "");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222">${html}</div>`;
}

/** Pull product / assistant names from natural pitch copy (e.g. Shamil, Labib). */
function extractProductNames(body: string): string[] {
  const text = String(body ?? "");
  const found: string[] = [];
  const patterns = [
    // "Shamil is an end-to-end workflow platform"
    /\b([A-Z][A-Za-z0-9][\w&'.-]{0,38})\s+is\s+(?:an?|the)\s+/g,
    // "Labib, the AI assistant" / "Nexus, the platform"
    /\b([A-Z][A-Za-z0-9][\w&'.-]{0,38}),\s+the\s+(?:AI\s+)?(?:assistant|platform|tool|product|solution|app|agent|system|software)\b/g,
    // "meet Labib" / "introducing Shamil"
    /\b(?:meet|introducing|called|named)\s+([A-Z][A-Za-z0-9][\w&'.-]{0,38})\b/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const name = match[1]?.trim();
      if (name && isLikelyProductName(name)) {
        found.push(name);
      }
    }
  }
  return found;
}

/** Terms worth bolding for a personalise contact (company + solutions + product names). */
export function personaliseEmphasizeTerms(input: {
  companyName?: string;
  steps?: Array<{ body?: string }>;
}) {
  const terms: string[] = [];
  const company = String(input.companyName ?? "").trim();
  if (company) {
    terms.push(company);
  }
  for (const step of input.steps ?? []) {
    const body = String(step.body ?? "");
    terms.push(...extractProductNames(body));
    for (const line of body.split(/\n/)) {
      const trimmed = line.replace(/^\s*(?:[-•*▪●◦]|\d{1,2}[.)])\s+/, "").trim();
      const match = trimmed.match(LABEL_RE);
      if (!match) continue;
      if (!isImportantLabel(match[1])) continue;
      const value = stripBoldMarkers(match[2].trim());
      if (value.length >= 2 && value.length <= 80) {
        terms.push(value);
      }
    }
  }
  return [...new Set(terms)];
}

export function contactNeedsEmail(contact: PersonaliseContact) {
  return !cleanEmail(contact.email);
}

export function resolvePersonaliseNames(row: {
  firstName?: unknown;
  lastName?: unknown;
  name?: unknown;
  fullName?: unknown;
}): { firstName: string; lastName: string } {
  let firstName = asText(row.firstName);
  let lastName = asText(row.lastName);
  const name = asText(row.name) || asText(row.fullName);

  // Prefer explicit first/last columns; otherwise split Name / Full name.
  if (!firstName && !lastName && name) {
    return splitPersonName(name);
  }
  if (firstName && !lastName && /\s/.test(firstName)) {
    return splitPersonName(firstName);
  }
  if (!firstName && lastName && /\s/.test(lastName) && !name) {
    return splitPersonName(lastName);
  }
  if (!firstName && name) {
    const fromName = splitPersonName(name);
    return { firstName: fromName.firstName, lastName: lastName || fromName.lastName };
  }
  return { firstName, lastName };
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
  const emailFixes: PersonaliseEmailFix[] = [];

  for (const item of rawContacts) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const { firstName, lastName } = resolvePersonaliseNames(row);
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
      const body = expandCollapsedPitch(asText(step.body).replace(/\\n/g, "\n"));
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
    const squash = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    let threadSubject = steps[0].subject;
    for (let index = 1; index < steps.length; index += 1) {
      const subject = steps[index].subject;
      if (!subject) continue;
      const reply = subject.match(/^re:\s*(.*)$/i);
      if (reply && squash(reply[1]) === squash(threadSubject)) {
        steps[index].subject = "";
      } else {
        threadSubject = subject;
      }
    }
    const rawEmail = asText(row.email);
    const email = cleanEmail(rawEmail);
    if (email && seen.has(email)) {
      continue;
    }
    if (email) {
      seen.add(email);
    }
    const first = firstName || lastName;
    const last = firstName ? lastName : "";
    if (email && emailWasReformatted(rawEmail, email)) {
      emailFixes.push({
        contactLabel: contactLabel(first, last, email),
        from: rawEmail,
        to: email,
      });
    }
    contacts.push({
      firstName: first,
      lastName: last,
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
    ...(emailFixes.length > 0 ? { emailFixes } : {}),
  };
}
