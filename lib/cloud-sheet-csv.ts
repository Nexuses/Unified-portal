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

const FIELD_ALIASES: Record<"email" | "subject" | "pitch" | "firstname" | "lastname" | "company" | "position" | "industry", string[]> = {
  email: ["email", "emailaddress", "mail", "e-mail"],
  subject: ["subject", "emailsubject", "subj"],
  pitch: ["pitch", "body", "message", "emailbody", "content", "copy"],
  firstname: ["firstname", "first", "fname", "givenname"],
  lastname: ["lastname", "last", "lname", "surname", "familyname"],
  company: ["company", "companyname", "organization", "organisation", "org"],
  position: ["position", "title", "jobtitle", "role", "job"],
  industry: ["industry", "sector", "vertical", "department", "dept"],
};

export function findHeaderForField(headers: string[], field: keyof typeof FIELD_ALIASES) {
  const aliases = FIELD_ALIASES[field];
  for (const header of headers) {
    const key = normHeader(header);
    if (aliases.some((alias) => key === alias.replace(/[^a-z0-9]/g, "") || key.includes(alias.replace(/[^a-z0-9]/g, "")))) {
      return header;
    }
  }
  return null;
}

export function cellForField(cells: Record<string, string>, field: keyof typeof FIELD_ALIASES) {
  const headers = Object.keys(cells);
  const header = findHeaderForField(headers, field);
  if (!header) return "";
  return String(cells[header] ?? "").trim();
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

  const emailHeader = findHeaderForField(headers, "email");
  if (!emailHeader) {
    throw new Error('CSV must include an email column (header like "email" or "e-mail")');
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

export function resolveCloudRowFields(cells: Record<string, string>): CloudResolvedRow {
  return {
    email: cellForField(cells, "email"),
    subject: cellForField(cells, "subject"),
    pitch: cellForField(cells, "pitch"),
    firstname: cellForField(cells, "firstname"),
    lastname: cellForField(cells, "lastname"),
    company: cellForField(cells, "company"),
    position: cellForField(cells, "position"),
    industry: cellForField(cells, "industry"),
  };
}

/**
 * Same HTML path as Personalise: pitchToHtml + emphasize company/product terms,
 * then merge tags from the row. Signature is baked into the HTML when provided.
 */
export function buildCloudPitchHtml(
  cells: Record<string, string>,
  signatureHtml = "",
) {
  const fields = resolveCloudRowFields(cells);
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
