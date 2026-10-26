export const INBOX_REPLY_CLASSES = [
  "interested",
  "not_interested",
  "out_of_office",
  "referral",
] as const;

export type InboxReplyClass = (typeof INBOX_REPLY_CLASSES)[number];

export const INBOX_REPLY_CLASS_LABELS: Record<InboxReplyClass, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  out_of_office: "Out of office",
  referral: "Referral",
};

/** Shown near Master Inbox tags — auto labels are for review only. */
export const INBOX_REPLY_CLASSIFY_HINT =
  "Classify replies for review—for example, interested, not interested, out of office, or referral—without treating automated classification as final.";

function plainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keep only the new reply — ignore quoted originals that often contain unsubscribe copy. */
export function extractNewReplyText(raw: string) {
  const text = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return "";

  const cutPatterns = [
    /\nOn .+wrote:\s*\n/i,
    /\nFrom:\s.+\nSent:\s/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{2,}\s*\n/,
    /\n>+ /,
  ];

  let cutAt = text.length;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match?.index != null && match.index > 0 && match.index < cutAt) {
      cutAt = match.index;
    }
  }

  const fresh = text
    .slice(0, cutAt)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

  // Prefer the top of the reply; campaign footers rarely belong there.
  return fresh.slice(0, 1200);
}

function sampleText(input: {
  subject?: string;
  textBody?: string;
  htmlBody?: string;
}) {
  const subject = String(input.subject ?? "").trim();
  const text = String(input.textBody ?? "").trim();
  const fromHtml = input.htmlBody ? plainText(input.htmlBody) : "";
  const body = extractNewReplyText(text || fromHtml);
  return `${subject}\n${body}`.toLowerCase();
}

const DAY =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun";

const INTERESTED_RE = new RegExp(
  String.raw`(?:(?<!\bnot\s)(?<!\bno longer\s)\binterested\b|sounds (?:good|great|interesting)|let'?s?\s+(?:talk|chat|connect|meet|schedule|catch up)|happy to (?:chat|meet|connect|talk)|keen to|would love to|tell me more|send (?:over )?more|book a (?:call|meeting)|schedule a (?:call|meeting)|(?:available|free) (?:on|at|to) |(?:connect|meet|call) (?:on|at|this|next|me )?(?:${DAY})|\b(?:${DAY})\b.{0,40}\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|works for me|that works|i'?m (?:free|available)|yes[,.]?\s*(?:i'?m |we'?re )?(?:interested|free|available))`,
  "i",
);

const NOT_INTERESTED_RE =
  /\b(not interested|no longer interested|don'?t contact|do not contact|stop emailing|unsubscribe|remove me|no thanks|no thank you|not a fit|not the right (time|fit)|please stop|opt out|please remove)\b/i;

const REFERRAL_RE =
  /\b(referr?(ing|al)|forward(ed|ing)? (this )?to|looping in|cc'?(ing)?|introduce you to|connect you with|reach out to (my|our)|talk to (my|our)|my colleague|my coworker|better suited|right person)\b/i;

const OOO_RE =
  /\b(out of (the )?office|ooo|automatic reply|auto[- ]?reply|away from (the )?office|on leave|vacation|holiday reply|maternity leave|paternity leave)\b/i;

/**
 * Lightweight keyword classifier for inbound campaign replies.
 * Returns null when confidence is low — never treat as final.
 */
export function classifyInboxReply(input: {
  subject?: string;
  textBody?: string;
  htmlBody?: string;
}): InboxReplyClass | null {
  const sample = sampleText(input);
  if (!sample.trim()) {
    return null;
  }

  if (OOO_RE.test(sample)) {
    return "out_of_office";
  }

  // Explicit declines before positive keywords — "not interested" contains
  // the word "interested". Quote-stripping avoids campaign footers.
  if (NOT_INTERESTED_RE.test(sample)) {
    return "not_interested";
  }

  if (INTERESTED_RE.test(sample)) {
    return "interested";
  }

  if (REFERRAL_RE.test(sample)) {
    return "referral";
  }

  return null;
}
