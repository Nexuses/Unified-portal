import { NextRequest, NextResponse } from "next/server";
import { chatWithDeepSeekResult } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

type SpamIssue = {
  original: string;
  replacement: string;
  reason: string;
};

const SPAM_PHRASES: Array<{ phrase: string; replacement: string; weight: number }> = [
  { phrase: "100% free", replacement: "at no charge", weight: 8 },
  { phrase: "free money", replacement: "funding", weight: 9 },
  { phrase: "guaranteed", replacement: "designed to", weight: 6 },
  { phrase: "risk-free", replacement: "low-risk", weight: 7 },
  { phrase: "no risk", replacement: "low risk", weight: 6 },
  { phrase: "act now", replacement: "you can start today", weight: 7 },
  { phrase: "limited time", replacement: "available this month", weight: 6 },
  { phrase: "urgent", replacement: "important", weight: 6 },
  { phrase: "you've won", replacement: "you have been selected", weight: 9 },
  { phrase: "you have won", replacement: "you have been selected", weight: 9 },
  { phrase: "winner", replacement: "selected participant", weight: 7 },
  { phrase: "claim now", replacement: "view details", weight: 8 },
  { phrase: "click here", replacement: "view this page", weight: 7 },
  { phrase: "buy now", replacement: "see options", weight: 6 },
  { phrase: "order now", replacement: "see options", weight: 6 },
  { phrase: "cash bonus", replacement: "additional value", weight: 8 },
  { phrase: "make money", replacement: "grow revenue", weight: 8 },
  { phrase: "earn money", replacement: "grow revenue", weight: 7 },
  { phrase: "special promotion", replacement: "current programme", weight: 6 },
  { phrase: "offer expires", replacement: "available until the end of the month", weight: 6 },
  { phrase: "don't miss", replacement: "you may find this useful", weight: 5 },
  { phrase: "do not miss", replacement: "you may find this useful", weight: 5 },
  { phrase: "congratulations", replacement: "good news", weight: 5 },
  { phrase: "prize", replacement: "recognition", weight: 7 },
  { phrase: "cheap", replacement: "cost-effective", weight: 5 },
  { phrase: "double your", replacement: "grow your", weight: 8 },
  { phrase: "incredible deal", replacement: "strong option", weight: 7 },
  { phrase: "once in a lifetime", replacement: "a timely opportunity", weight: 7 },
  { phrase: "no obligation", replacement: "with no commitment needed", weight: 5 },
  { phrase: "free trial", replacement: "trial", weight: 4 },
  { phrase: "discount", replacement: "saving", weight: 4 },
  { phrase: "book a demo", replacement: "see it in action", weight: 5 },
  { phrase: "register now", replacement: "reserve a seat", weight: 5 },
  { phrase: "sign up now", replacement: "join us", weight: 5 },
  { phrase: "apply now", replacement: "see how to apply", weight: 5 },
  { phrase: "get started now", replacement: "get started", weight: 4 },
  { phrase: "hurry", replacement: "soon", weight: 6 },
  { phrase: "last chance", replacement: "a quick reminder", weight: 7 },
  { phrase: "final call", replacement: "a quick reminder", weight: 6 },
  { phrase: "now or never", replacement: "when you are ready", weight: 7 },
  { phrase: "don't wait", replacement: "when you are ready", weight: 6 },
  { phrase: "do not wait", replacement: "when you are ready", weight: 6 },
  { phrase: "limited seats", replacement: "a small group session", weight: 5 },
  { phrase: "exclusive offer", replacement: "invitation", weight: 6 },
  { phrase: "special offer", replacement: "programme", weight: 6 },
  { phrase: "save big", replacement: "reduce costs", weight: 6 },
  { phrase: "best price", replacement: "clear pricing", weight: 6 },
  { phrase: "lowest price", replacement: "clear pricing", weight: 6 },
  { phrase: "amazing", replacement: "notable", weight: 4 },
  { phrase: "revolutionary", replacement: "new", weight: 5 },
  { phrase: "game-changer", replacement: "meaningful improvement", weight: 5 },
  { phrase: "game changer", replacement: "meaningful improvement", weight: 5 },
  { phrase: "cutting-edge", replacement: "modern", weight: 4 },
  { phrase: "supercharge", replacement: "improve", weight: 5 },
  { phrase: "boost your", replacement: "improve your", weight: 4 },
  { phrase: "free consultation", replacement: "consultation", weight: 5 },
  { phrase: "free demo", replacement: "demo", weight: 5 },
  { phrase: "buy 2 years, get 1 free", replacement: "buy 2 years, get 1 included", weight: 6 },
  { phrase: "get 1 free", replacement: "get 1 included", weight: 6 },
  { phrase: "get 2 free", replacement: "get 2 included", weight: 6 },
];

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text: string, phrase: string) {
  const matches = text.match(new RegExp(escapeRegExp(phrase), "gi"));
  return matches ? matches.length : 0;
}

function spamScore(
  subject: string,
  text: string,
  html: string,
  extraPhrases: string[] = [],
) {
  const combined = `${subject}\n${text}`;
  const lower = combined.toLowerCase();
  let score = 0;

  let phrasePoints = 0;
  for (const entry of SPAM_PHRASES) {
    if (lower.includes(entry.phrase)) {
      phrasePoints += entry.weight;
    }
  }
  // Spam words the AI found also raise the score, so the number always
  // moves with the issue list (previously the two were disconnected).
  for (const phrase of extraPhrases) {
    const key = phrase.trim().toLowerCase();
    if (key && lower.includes(key) && !SPAM_PHRASES.some((entry) => entry.phrase === key)) {
      phrasePoints += 5;
    }
  }
  score += Math.min(50, phrasePoints);

  const exclamations = (combined.match(/!/g) ?? []).length;
  if (exclamations > 2) {
    score += Math.min(10, exclamations * 2);
  }
  if (/!/.test(subject)) {
    score += 4;
  }

  const words = text.split(/\s+/).filter(Boolean);
  const capsWords = words.filter(
    (word) => word.length >= 3 && word === word.toUpperCase() && /[A-Z]/.test(word),
  );
  if (words.length >= 20 && capsWords.length >= 4 && capsWords.length / words.length > 0.1) {
    score += 8;
  }
  const subjectLetters = subject.replace(/[^A-Za-z]/g, "");
  if (
    subject.length >= 12 &&
    subjectLetters.length >= 8 &&
    subject === subject.toUpperCase()
  ) {
    score += 8;
  }
  if (/^(re|fw|fwd)\s*:/i.test(subject.trim())) {
    score += 6;
  }
  if (/\bfree\b/i.test(combined)) {
    score += 4;
  }

  const linkCount = (html.match(/<a\b/gi) ?? []).length;
  if (linkCount > 3) {
    score += Math.min(12, (linkCount - 3) * 2);
  }
  const anchorTexts = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const anchorCounts = new Map<string, number>();
  for (const anchor of anchorTexts) {
    anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);
  }
  if ([...anchorCounts.values()].some((count) => count >= 3)) {
    score += 5;
  }

  if (text.length > 0 && text.length < 40) {
    score += 8;
  }
  if (((combined.match(/\$/g) ?? []).length >= 3) || ((combined.match(/%/g) ?? []).length >= 3)) {
    score += 5;
  }
  if (!/unsubscribe|opt[\s_-]*out/i.test(html)) {
    score += 7;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function ratingFor(score: number) {
  if (score <= 25) return "Low";
  if (score <= 50) return "Moderate";
  if (score <= 75) return "High";
  return "Very high";
}

/** Phrases we replace spam words with — never flag these as spam. */
const SAFE_REPLACEMENTS = new Set(
  SPAM_PHRASES.map((entry) => entry.replacement.toLowerCase()),
);

function dictionaryIssues(subject: string, text: string): SpamIssue[] {
  const combined = `${subject}\n${text}`.toLowerCase();
  const issues: SpamIssue[] = [];
  for (const entry of SPAM_PHRASES) {
    if (combined.includes(entry.phrase) && countOccurrences(combined, entry.phrase) > 0) {
      issues.push({
        original: entry.phrase,
        replacement: entry.replacement,
        reason: "Common spam trigger phrase",
      });
    }
  }
  return issues;
}

/** Apply phrase replacements only to text between HTML tags. */
function applyReplacements(html: string, subject: string, issues: SpamIssue[]) {
  let fixedHtml = html;
  let fixedSubject = subject;
  for (const issue of issues) {
    if (!issue.original.trim() || !issue.replacement.trim()) continue;
    const pattern = new RegExp(escapeRegExp(issue.original), "gi");
    fixedSubject = fixedSubject.replace(pattern, issue.replacement);
    fixedHtml = fixedHtml
      .split(/(<[^>]+>)/g)
      .map((part) => (part.startsWith("<") ? part : part.replace(pattern, issue.replacement)))
      .join("");
  }
  return { fixedHtml, fixedSubject };
}

async function aiIssues(
  subject: string,
  text: string,
): Promise<{ issues: SpamIssue[]; aiScore: number | null } | null> {
  try {
    const result = await chatWithDeepSeekResult({
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: `You are an email deliverability expert reviewing a B2B marketing email. Be strict: flag spam trigger words and phrases, pushy sales calls-to-action (for example "BOOK A DEMO", "Register now", "Limited seats"), urgency, hype words, and ALL-CAPS shouting. For each, propose a professional replacement that keeps the meaning but is less likely to trigger spam filters. Also give an overall spam risk score from 0 (clean) to 100 (very spammy) considering trigger words, caps, urgency, sales pressure and link repetition. Return JSON only in this shape:
{"score":0,"issues":[{"original":"exact word or phrase from the text","replacement":"professional replacement","reason":"short reason"}]}
Rules: original must appear exactly in the subject or body (case-insensitive). At most 12 issues. Do not invent phrases that are not in the text. If there are none, return {"score":0,"issues":[]} with a low score that matches the content.`,
        },
        {
          role: "user",
          content: `Subject: ${subject || "(empty)"}\n\nBody:\n${text.slice(0, 12000)}`,
        },
      ],
    });
    const raw = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      score?: unknown;
      issues?: Array<{ original?: unknown; replacement?: unknown; reason?: unknown }>;
    };
    if (!Array.isArray(parsed.issues)) return null;
    const aiScoreRaw = Number(parsed.score);
    const aiScore = Number.isFinite(aiScoreRaw)
      ? Math.max(0, Math.min(100, Math.round(aiScoreRaw)))
      : null;
    const combined = `${subject}\n${text}`.toLowerCase();
    const seen = new Set<string>();
    const issues: SpamIssue[] = [];
    for (const item of parsed.issues) {
      const original = String(item.original ?? "").trim();
      const replacement = String(item.replacement ?? "").trim();
      const reason = String(item.reason ?? "Spam trigger").trim();
      const key = original.toLowerCase();
      if (!original || !replacement || seen.has(key)) continue;
      if (!combined.includes(key)) continue;
      if (key === replacement.toLowerCase()) continue;
      // Never re-flag the softer phrases used as replacements, so a
      // re-check of already-fixed content does not invent new fixes.
      if (SAFE_REPLACEMENTS.has(key)) continue;
      seen.add(key);
      issues.push({ original, replacement, reason });
      if (issues.length >= 12) break;
    }
    return { issues, aiScore };
  } catch (error) {
    console.warn(
      `[spam-check] AI check failed, using dictionary: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;

    const body = (await request.json().catch(() => null)) as {
      subject?: unknown;
      html?: unknown;
    } | null;
    const subject = typeof body?.subject === "string" ? body.subject : "";
    const html = typeof body?.html === "string" ? body.html : "";
    if (!html.trim()) {
      return NextResponse.json({ error: "Email HTML is empty." }, { status: 400 });
    }

    const text = htmlToText(html);

    const fromAi = await aiIssues(subject, text);
    const issues = fromAi?.issues ?? dictionaryIssues(subject, text);
    // The score must reflect the spam words actually found: combine the
    // rule-based score (which counts the found phrases) with the AI's own
    // risk assessment, and use whichever is higher.
    const localScore = spamScore(
      subject,
      text,
      html,
      issues.map((issue) => issue.original),
    );
    const score = Math.max(localScore, fromAi?.aiScore ?? 0);
    const { fixedHtml, fixedSubject } = applyReplacements(html, subject, issues);
    const fixedScore = spamScore(fixedSubject, htmlToText(fixedHtml), fixedHtml);

    return NextResponse.json({
      score,
      rating: ratingFor(score),
      issues,
      fixedSubject,
      fixedHtml,
      fixedScore,
      fixedRating: ratingFor(fixedScore),
      checkedWith: fromAi ? "ai" : "dictionary",
    });
  } catch (error) {
    console.error("Spam check failed:", error);
    return NextResponse.json({ error: "Spam check failed" }, { status: 500 });
  }
}
