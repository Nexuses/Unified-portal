import { parseCsvRecords, uniquifyCsvHeaders } from "@/lib/csv";
import { CLOUD_SHEET_COLUMNS, type CloudSheetSample } from "@/lib/cloud-campaigns";
import { applyContactVariables } from "@/lib/email-variables";
import {
  personaliseEmphasizeTerms,
  pitchToHtml,
} from "@/lib/personalise-types";

export const CLOUD_CSV_MAX_CHARS = 2_000_000;
export const CLOUD_CSV_MAX_ROWS = 2000;

function normHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Header words: "Job Title" -> ["job","title"], "firstName" -> ["first","name"]. */
function headerWords(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export const CLOUD_FIELDS = [
  "email",
  "subject",
  "pitch",
  "firstname",
  "lastname",
  "company",
  "position",
  "industry",
] as const;
export type CloudField = (typeof CLOUD_FIELDS)[number];
/** Campaign field -> column header in the people list. */
export type CloudColumnMap = Partial<Record<CloudField, string>>;

export const CLOUD_REQUIRED_FIELDS: CloudField[] = ["email", "subject", "pitch"];
export const CLOUD_FIELD_LABELS: Record<CloudField, string> = {
  email: "Email",
  subject: "Subject",
  pitch: "Email body (pitch)",
  firstname: "First name",
  lastname: "Last name",
  company: "Company",
  position: "Job title",
  industry: "Industry",
};

/** Whole-name aliases (normalized: lowercase, no spaces/punctuation). */
const FIELD_ALIASES: Record<CloudField, string[]> = {
  email: ["email", "emailaddress", "mail", "emailid", "mailid", "workemail", "businessemail", "contactemail", "emailaddr"],
  subject: ["subject", "subjectline", "emailsubject", "subj", "mailsubject"],
  pitch: ["pitch", "outreachpitch", "body", "emailbody", "message", "emailmessage", "emailcopy", "copy", "content", "emailcontent", "emailtext", "personalizedemail", "personalisedemail", "draft", "emaildraft", "script"],
  firstname: ["firstname", "first", "fname", "givenname", "forename"],
  lastname: ["lastname", "last", "lname", "surname", "familyname"],
  company: ["company", "companyname", "organization", "organisation", "org", "account", "accountname", "employer", "business", "firm"],
  position: ["position", "title", "jobtitle", "role", "designation", "job", "jobrole"],
  industry: ["industry", "sector", "vertical"],
};

/** Words that mean "this column is about the field, not the field itself". */
const FIELD_NEGATIVE_WORDS: Partial<Record<CloudField, string[]>> = {
  email: ["sent", "status", "opened", "open", "date", "bounce", "bounced", "valid", "verified", "count", "provider", "domain", "type"],
  firstname: ["contacted", "contact", "touch", "seen", "date", "activity", "sent", "reply"],
  lastname: ["contacted", "contact", "touch", "seen", "date", "activity", "sent", "reply", "updated", "modified"],
  pitch: ["type", "length", "status", "date", "sent", "count"],
  subject: ["status", "date", "count"],
  company: ["size", "domain", "url", "website", "linkedin", "revenue", "employees"],
  position: ["level", "seniority"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ColumnProfile = { header: string; filled: number; emailShare: number; avgLen: number; multiline: number };

function profileColumns(headers: string[], rows: CloudSheetSample[]): ColumnProfile[] {
  const sample = rows.slice(0, 60);
  return headers.map((header) => {
    const values = sample.map((row) => String(row.cells?.[header] ?? "").trim()).filter(Boolean);
    const filled = values.length;
    const emails = values.filter((value) => EMAIL_RE.test(value)).length;
    const total = values.reduce((sum, value) => sum + value.length, 0);
    const multiline = values.filter((value) => /\n/.test(value)).length;
    return {
      header,
      filled,
      emailShare: filled ? emails / filled : 0,
      avgLen: filled ? total / filled : 0,
      multiline: filled ? multiline / filled : 0,
    };
  });
}

/** How well a header name fits a field: exact 100, whole word 70, contained 30, else 0. */
function headerScore(header: string, field: CloudField) {
  const key = normHeader(header);
  const words = headerWords(header);
  if (!key) return 0;
  const negatives = FIELD_NEGATIVE_WORDS[field] || [];
  const hasNegative = words.some((word) => negatives.includes(word));
  let best = 0;
  for (const alias of FIELD_ALIASES[field]) {
    if (key === alias) best = Math.max(best, 100);
    else if (!hasNegative && words.join("") === alias) best = Math.max(best, 95);
    else if (!hasNegative && words.includes(alias)) best = Math.max(best, 70);
    else if (!hasNegative && alias.length >= 5 && key.includes(alias)) best = Math.max(best, 30);
  }
  return hasNegative ? Math.min(best, key === normHeader(field) ? 100 : 0) : best;
}

/** Adjust a header score with what the column actually contains. */
function valueScore(profile: ColumnProfile, field: CloudField) {
  if (profile.filled === 0) return -20;
  switch (field) {
    case "email":
      return profile.emailShare >= 0.8 ? 60 : profile.emailShare >= 0.5 ? 10 : -80;
    case "pitch":
      return profile.avgLen >= 120 || profile.multiline >= 0.3 ? 40 : profile.avgLen < 30 ? -50 : 0;
    case "subject":
      return profile.avgLen >= 6 && profile.avgLen <= 140 && profile.multiline < 0.1 ? 15 : profile.avgLen > 200 ? -50 : 0;
    default:
      return profile.emailShare > 0.5 ? -60 : profile.avgLen > 120 ? -40 : 0;
  }
}

/**
 * Detect which column holds each field, using header names and the data itself. Each column
 * is used once; fields with no convincing match stay unmapped (the user picks them).
 */
export function detectColumnMap(headers: string[], rows: CloudSheetSample[]): CloudColumnMap {
  const profiles = profileColumns(headers, rows);
  const candidates: { field: CloudField; header: string; score: number }[] = [];
  for (const field of CLOUD_FIELDS) {
    for (const profile of profiles) {
      const named = headerScore(profile.header, field);
      if (named > 0) candidates.push({ field, header: profile.header, score: named + valueScore(profile, field) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const map: CloudColumnMap = {};
  const used = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.score < 40 || map[candidate.field] || used.has(candidate.header)) continue;
    map[candidate.field] = candidate.header;
    used.add(candidate.header);
  }
  // Data-only fallbacks for the two fields we can recognise by content alone.
  if (!map.email) {
    const best = profiles
      .filter((p) => !used.has(p.header) && p.emailShare >= 0.8)
      .sort((a, b) => b.emailShare - a.emailShare)[0];
    if (best) {
      map.email = best.header;
      used.add(best.header);
    }
  }
  if (!map.pitch) {
    const best = profiles
      .filter((p) => !used.has(p.header) && (p.avgLen >= 120 || p.multiline >= 0.3))
      .sort((a, b) => b.avgLen - a.avgLen)[0];
    if (best) {
      map.pitch = best.header;
      used.add(best.header);
    }
  }
  return map;
}

/** Keep the user's mapping only if every column it points at still exists. */
export function reconcileColumnMap(
  saved: CloudColumnMap | undefined,
  headers: string[],
  rows: CloudSheetSample[],
): CloudColumnMap {
  if (saved && Object.values(saved).every((header) => !header || headers.includes(header))) {
    const detected = detectColumnMap(headers, rows);
    return { ...detected, ...Object.fromEntries(Object.entries(saved).filter(([, h]) => h)) };
  }
  return detectColumnMap(headers, rows);
}

/** Old behaviour for lists without a stored mapping: first header that fits the field. */
export function findHeaderForField(headers: string[], field: CloudField) {
  let best: { header: string; score: number } | null = null;
  for (const header of headers) {
    const score = headerScore(header, field);
    if (score >= 70 && (!best || score > best.score)) best = { header, score };
  }
  return best?.header ?? null;
}

export function cellForField(
  cells: Record<string, string>,
  field: CloudField,
  map?: CloudColumnMap,
) {
  const header = map?.[field] || findHeaderForField(Object.keys(cells), field);
  if (!header) return "";
  return String(cells[header] ?? "").trim();
}

/** Replace {{Any Column Name}} with that column's value (case/space-insensitive). */
export function applyColumnTokens(text: string, cells: Record<string, string>) {
  const byKey = new Map(Object.entries(cells).map(([header, value]) => [normHeader(header), String(value ?? "")]));
  return String(text || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name: string) => {
    const key = normHeader(name);
    return byKey.has(key) ? byKey.get(key) || "" : whole;
  });
}

export type CloudColumnStats = {
  total: number;
  ready: number;
  missingEmail: number;
  invalidEmail: number;
  missingSubject: number;
  missingPitch: number;
  /** Rows whose subject/body still contain a {{tag}} no column fills. */
  unresolvedTags: number;
  /** Example of an unfilled tag, for the message. */
  exampleTag?: string;
};

function pitchLooksUsable(pitch: string) {
  const text = String(pitch || "").trim();
  if (!text) return false;
  return !/^(hi|hello|hey|dear)\b[^.\n]{0,40},?\s*$/i.test(text);
}

const MISSING = "\u2063MISSING\u2063";

/**
 * Render subject + body the way sending does, but with a marker for empty merge values, so a
 * row that would read "Hi ," (empty {{First Name}}) or keep a raw {{Tag}} is caught up front.
 */
function leftoverTag(cells: Record<string, string>, map: CloudColumnMap) {
  const fields = resolveCloudRowFields(cells, map);
  const vars = {
    firstName: fields.firstname || MISSING,
    lastName: fields.lastname || MISSING,
    email: fields.email || MISSING,
    companyName: fields.company || MISSING,
    position: fields.position || MISSING,
  };
  const rawText = `${fields.subject}\n${fields.pitch}`;
  const rendered = applyContactVariables(rawText, vars, false);
  const raw = (rendered.match(/\{\{[^{}]+\}\}/) || [])[0];
  if (raw) return raw;
  if (rendered.includes(MISSING)) {
    // Point at the tag in the source text that produced the empty value.
    const tags = rawText.match(/\{\{[^{}]+\}\}/g) || [];
    for (const tag of tags) {
      if (applyContactVariables(tag, vars, false).includes(MISSING)) return `${tag} (empty in this row)`;
    }
    return "a merge tag (empty in this row)";
  }
  return "";
}

/** Why a row can't be sent with this mapping ("" = ready). */
export function rowIssue(cells: Record<string, string>, map: CloudColumnMap) {
  const email = cellForField(cells, "email", map);
  if (!email) return "No email address.";
  if (!EMAIL_RE.test(email)) return `"${email.slice(0, 60)}" isn't a valid email address.`;
  if (!cellForField(cells, "subject", map)) return "No subject.";
  if (!pitchLooksUsable(cellForField(cells, "pitch", map))) return "Email body is empty or only a greeting.";
  const tag = leftoverTag(cells, map);
  if (tag) return `Uses ${tag} — no value to fill it.`;
  return "";
}

export function columnMapStats(rows: CloudSheetSample[], map: CloudColumnMap): CloudColumnStats {
  const stats: CloudColumnStats = {
    total: rows.length,
    ready: 0,
    missingEmail: 0,
    invalidEmail: 0,
    missingSubject: 0,
    missingPitch: 0,
    unresolvedTags: 0,
  };
  for (const row of rows) {
    const cells = row.cells || {};
    const email = cellForField(cells, "email", map);
    if (!email) stats.missingEmail += 1;
    else if (!EMAIL_RE.test(email)) stats.invalidEmail += 1;
    else if (!cellForField(cells, "subject", map)) stats.missingSubject += 1;
    else if (!pitchLooksUsable(cellForField(cells, "pitch", map))) stats.missingPitch += 1;
    else {
      const tag = leftoverTag(cells, map);
      if (tag) {
        stats.unresolvedTags += 1;
        stats.exampleTag = stats.exampleTag || tag;
      } else stats.ready += 1;
    }
  }
  return stats;
}

export type ParsedCloudCsv = {
  headers: string[];
  rows: CloudSheetSample[];
  samples: CloudSheetSample[];
  rowCount: number;
  missingExpected: string[];
  emailHeader: string;
};

export function parseCloudCsvText(csvText: string): ParsedCloudCsv {
  const text = csvText.replace(/^\uFEFF/, "");
  if (!text.trim()) {
    throw new Error("CSV is empty");
  }
  if (text.length > CLOUD_CSV_MAX_CHARS) {
    throw new Error("CSV is too large (max about 2MB). Split the list or remove long columns.");
  }

  const delimiter =
    text.split("\n")[0]?.includes("\t") && !text.split("\n")[0]?.includes(",") ? "\t" : ",";
  const records = parseCsvRecords(text, delimiter);
  if (records.length < 2) {
    throw new Error("CSV needs a header row and at least one people row");
  }

  const headers = uniquifyCsvHeaders(records[0].map((cell) => String(cell ?? "").trim()));
  if (!headers.some((header) => header.trim())) {
    throw new Error("CSV header row is empty");
  }


  const dataRecords = records.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (dataRecords.length === 0) {
    throw new Error("CSV has no people rows under the header");
  }
  if (dataRecords.length > CLOUD_CSV_MAX_ROWS) {
    throw new Error(`CSV has too many rows (max ${CLOUD_CSV_MAX_ROWS})`);
  }

  const rows: CloudSheetSample[] = dataRecords.map((row) => {
    const cells: Record<string, string> = {};
    headers.forEach((header, index) => {
      cells[header] = String(row[index] ?? "").trim();
    });
    return { cells };
  });

  const emailHeader = detectColumnMap(headers, rows).email || "";
  const normalizedHeaders = headers.map(normHeader);
  const missingExpected = CLOUD_SHEET_COLUMNS.filter((column) => {
    const key = normHeader(column);
    return !normalizedHeaders.some(
      (header) =>
        header === key ||
        header.includes(key) ||
        key.includes(header) ||
        (key === "industry" && (header.includes("dept") || header.includes("department"))) ||
        (key === "pitch" && (header.includes("body") || header.includes("message"))) ||
        (key === "firstname" && header.includes("first")) ||
        (key === "lastname" && header.includes("last")),
    );
  });

  return {
    headers,
    rows,
    samples: rows.slice(0, 2),
    rowCount: rows.length,
    missingExpected,
    emailHeader,
  };
}

export type CloudResolvedRow = {
  email: string;
  subject: string;
  pitch: string;
  firstname: string;
  lastname: string;
  company: string;
  position: string;
  industry: string;
};

export function resolveCloudRowFields(
  cells: Record<string, string>,
  map?: CloudColumnMap,
): CloudResolvedRow {
  return {
    email: cellForField(cells, "email", map),
    subject: applyColumnTokens(cellForField(cells, "subject", map), cells),
    pitch: applyColumnTokens(cellForField(cells, "pitch", map), cells),
    firstname: cellForField(cells, "firstname", map),
    lastname: cellForField(cells, "lastname", map),
    company: cellForField(cells, "company", map),
    position: cellForField(cells, "position", map),
    industry: cellForField(cells, "industry", map),
  };
}

/**
 * Same HTML path as Personalise: pitchToHtml + emphasize company/product terms,
 * then merge tags from the row. Signature is baked into the HTML when provided.
 */
export function buildCloudPitchHtml(
  cells: Record<string, string>,
  signatureHtml = "",
  map?: CloudColumnMap,
) {
  const fields = resolveCloudRowFields(cells, map);
  const emphasize = personaliseEmphasizeTerms({
    companyName: fields.company,
    steps: fields.pitch ? [{ body: fields.pitch }] : [],
  });
  const cleanedSig = String(signatureHtml || "").trim();
  // Mark signature so desktop paste verification can confirm it was not dropped.
  const markedSignature = cleanedSig
    ? `<div data-cloud-signature="1" style="margin:18px 0 0">${cleanedSig}</div>`
    : "";
  const html = pitchToHtml(fields.pitch, markedSignature, { emphasize });
  return applyContactVariables(
    html,
    {
      firstName: fields.firstname,
      lastName: fields.lastname,
      email: fields.email,
      companyName: fields.company,
      position: fields.position,
    },
    true,
  );
}

/** Rough plain-text fallback for clipboard (never preferred over HTML paste). */
export function htmlToPlainApprox(html: string) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Build labeled fields the send agent must use (no guessing). */
export function formatResolvedRowForPrompt(
  cells: Record<string, string>,
  options?: { bodyHtml?: string; signatureIncluded?: boolean },
) {
  const fields = resolveCloudRowFields(cells);
  const lines = [
    `TO_EMAIL: ${fields.email || "(missing)"}`,
    `SUBJECT: ${
      fields.subject ||
      "(compose a short subject from BODY_HTML content + ADDITIONAL_INSTRUCTIONS; do not invent facts)"
    }`,
    `FIRSTNAME: ${fields.firstname || ""}`,
    `LASTNAME: ${fields.lastname || ""}`,
    `COMPANY: ${fields.company || ""}`,
    `POSITION: ${fields.position || ""}`,
    `INDUSTRY: ${fields.industry || ""}`,
  ];

  if (options?.bodyHtml?.trim()) {
    lines.push(
      "BODY_HTML (server-formatted like Personalise — paste as rich HTML into the compose body; preserve <strong>/paragraphs; do not rewrite wording):",
    );
    lines.push("-----BODY_HTML_START-----");
    lines.push(options.bodyHtml.trim());
    lines.push("-----BODY_HTML_END-----");
    if (options.signatureIncluded) {
      lines.push(
        "Signature is already included at the end of BODY_HTML. Do not append another signature.",
      );
    }
  } else {
    lines.push(
      `BODY_PITCH: ${
        fields.pitch ||
        "(compose carefully from other fields + ADDITIONAL_INSTRUCTIONS; do not invent facts)"
      }`,
    );
  }

  lines.push("ALL_CELLS (exact people-row values — for reference only; prefer BODY_HTML when present):");
  for (const [key, value] of Object.entries(cells)) {
    lines.push(`- ${key}: ${value}`);
  }
  return lines.join("\n");
}
