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
  email: ["email", "emails", "emailaddress", "mail", "emailid", "mailid", "workemail", "businessemail", "contactemail", "emailaddr", "primaryemail", "officeemail", "personalemail", "corporateemail", "professionalemail"],
  subject: ["subject", "subjectline", "emailsubject", "subj", "mailsubject", "subjects", "subjectlines"],
  pitch: ["pitch", "outreachpitch", "body", "emailbody", "message", "emailmessage", "emailcopy", "copy", "content", "emailcontent", "emailtext", "personalizedemail", "personalisedemail", "draft", "emaildraft", "script", "mailbody", "messagebody", "personalizedmessage", "personalisedmessage", "outreachmessage", "outreachemail", "coldemail", "pitchtext", "emailpitch"],
  firstname: ["firstname", "first", "fname", "givenname", "forename", "name", "fullname", "contactname", "contact", "prospectname", "leadname", "person", "personname"],
  lastname: ["lastname", "last", "lname", "surname", "familyname"],
  company: ["company", "companyname", "organization", "organisation", "org", "account", "accountname", "employer", "business", "firm", "brand", "client", "clientname", "organizationname", "organisationname"],
  position: ["position", "title", "jobtitle", "role", "designation", "job", "jobrole", "jobposition", "jobdesignation"],
  industry: ["industry", "sector", "vertical", "industries"],
};

/** Aliases too generic to match inside a longer header. */
const EXACT_ONLY_ALIASES = new Set(["name", "contact", "person", "mail", "copy", "content", "draft", "script", "account", "business", "client", "brand", "org"]);

/** Headers that hold a whole name ("Jane Smith"); the first name is taken from them. */
const FULL_NAME_HEADERS = new Set(["name", "fullname", "contactname", "contact", "prospectname", "leadname", "person", "personname"]);

/** Words that mean "this column is about the field, not the field itself". */
const FIELD_NEGATIVE_WORDS: Partial<Record<CloudField, string[]>> = {
  email: ["sent", "status", "opened", "open", "date", "bounce", "bounced", "valid", "verified", "count", "provider", "domain", "type"],
  firstname: ["contacted", "touch", "seen", "date", "activity", "sent", "reply", "company", "account", "file", "user", "username", "campaign", "sender", "list"],
  lastname: ["contacted", "touch", "seen", "date", "activity", "sent", "reply", "updated", "modified"],
  pitch: ["type", "length", "status", "date", "sent", "count"],
  subject: ["status", "date", "count"],
  company: ["size", "domain", "url", "website", "linkedin", "revenue", "employees"],
  position: ["level", "seniority"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** Remove invisible characters and odd spaces that Sheets/Excel leave in cells. */
export function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function cleanHeader(value: unknown) {
  return cleanCell(value).replace(/\s+/g, " ").replace(/\s*[*:]+$/, "").trim();
}

/** The address in "Jane <jane@x.com>", "mailto:jane@x.com", "jane@x.com;" and similar. */
export function extractEmail(value: string) {
  const text = cleanCell(value).replace(/^mailto:/i, "");
  if (EMAIL_RE.test(text)) return text.replace(/[.,;:]+$/, "");
  if (text.length > 160) return text;
  const found = text.match(EMAIL_IN_TEXT);
  return found ? found[0] : text;
}

function looksLikeEmail(value: string) {
  return value.length <= 160 && EMAIL_RE.test(extractEmail(value));
}

type ColumnProfile = { header: string; filled: number; emailShare: number; avgLen: number; multiline: number };

function profileColumns(headers: string[], rows: CloudSheetSample[]): ColumnProfile[] {
  const sample = rows.slice(0, 60);
  return headers.map((header) => {
    const values = sample.map((row) => String(row.cells?.[header] ?? "").trim()).filter(Boolean);
    const filled = values.length;
    const emails = values.filter(looksLikeEmail).length;
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
    // Generic words only count as the whole header ("Name", not "Company Name").
    if (EXACT_ONLY_ALIASES.has(alias)) {
      if (key === alias) best = Math.max(best, field === "firstname" ? 75 : 100);
      continue;
    }
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
      return profile.emailShare > 0.5 ? -100 : profile.avgLen > 120 ? -40 : 0;
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
      .filter((p) => !used.has(p.header) && p.emailShare >= 0.5)
      .sort((a, b) => b.emailShare - a.emailShare)[0];
    if (best) {
      map.email = best.header;
      used.add(best.header);
    }
  }
  if (!map.pitch) {
    const best = profiles
      .filter((p) => !used.has(p.header) && (p.avgLen >= 80 || p.multiline >= 0.3))
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
  const value = cleanCell(cells[header]);
  if (field === "email") return extractEmail(value);
  if (field === "firstname" && FULL_NAME_HEADERS.has(normHeader(header))) {
    // "Dr. Jane Smith" -> "Jane"; an email-looking or empty value gives "".
    if (value.includes("@")) return "";
    const words = value.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").split(/\s+/);
    return words[0] || "";
  }
  return value;
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

/** Count a character outside quoted text on one line (for delimiter detection). */
function countOutsideQuotes(line: string, char: string) {
  let count = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === char && !quoted) count += 1;
  }
  return count;
}

/** Comma, semicolon (European Excel), tab or pipe: the one used consistently across lines. */
export function detectCsvDelimiter(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 30);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of [",", ";", "\t", "|"]) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter)).filter((n) => n > 0);
    if (!counts.length) continue;
    const tally = new Map<number, number>();
    counts.forEach((n) => tally.set(n, (tally.get(n) || 0) + 1));
    const [, lines_] = [...tally.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0];
    const score = lines_ * 10 + counts.length;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function columnLetter(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Which row holds the column names. Lists often start with a title, notes or blank rows; the
 * header is the early row with several short labels (ideally known ones) and no email addresses.
 * Returns -1 when the first row is already data (no header row at all).
 */
function findHeaderRow(records: string[][]) {
  const limit = Math.min(records.length - 1, 20);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < limit; i += 1) {
    const filled = records[i].map(cleanHeader).filter(Boolean);
    if (filled.length < 2) continue;
    const known = filled.filter((cell) => CLOUD_FIELDS.some((field) => headerScore(cell, field) >= 70)).length;
    const emails = filled.filter(looksLikeEmail).length;
    const long = filled.filter((cell) => cell.length > 60).length;
    const unique = new Set(filled.map((cell) => cell.toLowerCase())).size === filled.length;
    const score = filled.length + known * 4 - emails * 8 - long * 3 + (unique ? 1 : -3);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return records[best]?.some((cell) => looksLikeEmail(cleanCell(cell))) ? -1 : best;
}

/** Turn raw records (from CSV or a spreadsheet) into a clean people list. */
export function recordsToCloudList(records: string[][]): ParsedCloudCsv {
  if (records.length < 1) throw new Error("The list is empty");
  const headerIndex = findHeaderRow(records);
  const headerCells = headerIndex >= 0 ? records[headerIndex] : [];
  const body = records.slice(headerIndex + 1);
  const width = Math.max(headerCells.length, ...body.slice(0, 500).map((row) => row.length));

  // Keep columns that have a name or any data; unnamed data columns become "Column C".
  const columns: { index: number; name: string }[] = [];
  for (let index = 0; index < width; index += 1) {
    const name = cleanHeader(headerCells[index]);
    const hasData = body.some((row) => cleanCell(row[index]));
    if (name || hasData) columns.push({ index, name: name || `Column ${columnLetter(index)}` });
  }
  if (!columns.length) throw new Error("The list has no columns");
  const headers = uniquifyCsvHeaders(columns.map((column) => column.name));
  const headerKey = headers.map((h) => h.toLowerCase()).join("\u0001");

  const rows: CloudSheetSample[] = [];
  for (const record of body) {
    const values = columns.map((column) => cleanCell(record[column.index]));
    if (!values.some(Boolean)) continue;
    // A repeated header row (pasted lists) is not a person.
    if (values.map((v) => v.toLowerCase()).join("\u0001") === headerKey) continue;
    const cells: Record<string, string> = {};
    headers.forEach((header, index) => {
      cells[header] = values[index];
    });
    rows.push({ cells });
  }
  if (rows.length === 0) throw new Error("The list has no people rows under the header");
  if (rows.length > CLOUD_CSV_MAX_ROWS) throw new Error(`The list has too many rows (max ${CLOUD_CSV_MAX_ROWS})`);

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

export function parseCloudCsvText(csvText: string): ParsedCloudCsv {
  let text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text.trim()) {
    throw new Error("CSV is empty");
  }
  if (text.length > CLOUD_CSV_MAX_CHARS) {
    throw new Error("CSV is too large (max about 2MB). Split the list or remove long columns.");
  }
  // Excel's "sep=;" hint line.
  let delimiter = "";
  const sep = text.match(/^sep=(.)\r?\n/i);
  if (sep) {
    delimiter = sep[1];
    text = text.slice(sep[0].length);
  }
  delimiter = delimiter || detectCsvDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  if (records.length < 2) {
    throw new Error("CSV needs a header row and at least one people row");
  }
  return recordsToCloudList(records);
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
