import ExcelJS from "exceljs";
import JSZip from "jszip";
import { normalizePersonalisePlan, type PersonalisePlan } from "@/lib/personalise-types";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;

const SYSTEM_PROMPT = `You extract outreach contacts from an uploaded document or spreadsheet. The layout changes from file to file. Return JSON only.

Schema:
{
  "listName": "short name taken from the document title",
  "contacts": [
    {
      "firstName": "",
      "lastName": "",
      "email": "",
      "companyName": "",
      "position": "",
      "personalLinkedIn": "",
      "steps": [
        {
          "label": "First email",
          "day": 0,
          "subject": "",
          "body": ""
        }
      ]
    }
  ]
}

Rules:
- Copy every subject and email body exactly. Do not rewrite, summarise, translate, or fix wording.
- Keep line breaks in the body. Lines that start with "- " or "1. " are bullet points: keep that marker at the start of the line, one bullet per line.
- One contact per person. Include every email that person has. People can have different numbers of emails.
- Keep the emails in the order they appear in the file.
- day always counts from the first email. The first email is day 0. A follow-up marked Day 2 is sent 2 days after the first email, so day is 2. Day 3 is 3 days after the first email, so day is 3. Day 18 is day 18. Copy the number as written. Do not add the numbers up.
- If a follow-up has no day mentioned, use the same day as the email before it.
- If a follow-up says it stays on the same thread, or has no subject, set subject to an empty string.
- The first email's subject must be the subject written in the file.
- email, position, and personalLinkedIn stay empty when the file does not contain them. Never invent an email address or a LinkedIn URL.
- personalLinkedIn is only a URL. The word LinkedIn with no URL is an empty string.
- position is the job title when one is written next to the person.
- listName comes from the document title, not from a person's name.
- Do not add people who are not in the file.`;

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** numId -> level -> true when that list level is numbered rather than bulleted. */
function docxNumberedLevels(numberingXml: string) {
  const abstractLevels = new Map<string, Map<string, boolean>>();
  for (const match of numberingXml.matchAll(
    /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  )) {
    const levels = new Map<string, boolean>();
    for (const level of match[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const format = /<w:numFmt w:val="(\w+)"/.exec(level[2])?.[1] ?? "bullet";
      levels.set(level[1], format !== "bullet" && format !== "none");
    }
    abstractLevels.set(match[1], levels);
  }
  const numbered = new Map<string, Map<string, boolean>>();
  for (const match of numberingXml.matchAll(
    /<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g,
  )) {
    numbered.set(match[1], abstractLevels.get(match[2]) ?? new Map());
  }
  return numbered;
}

/** Relationship id -> target URL from word/_rels/document.xml.rels. */
function docxLinkTargets(relsXml: string) {
  const links = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) {
      links.set(id, decodeXml(target));
    }
  }
  return links;
}

function docxXmlToText(xml: string, numberingXml = "", links = new Map<string, string>()) {
  const numbered = docxNumberedLevels(numberingXml);
  const counters = new Map<string, number>();
  const withLists = xml.replace(/<w:p\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/w:p>/g, (paragraph, inner: string) => {
    const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(inner)?.[1];
    if (!numPr) {
      return paragraph;
    }
    const numId = /<w:numId w:val="(\d+)"/.exec(numPr)?.[1] ?? "";
    if (!numId || numId === "0") {
      return paragraph;
    }
    const level = /<w:ilvl w:val="(\d+)"/.exec(numPr)?.[1] ?? "0";
    const indent = "  ".repeat(Number(level));
    let marker = "- ";
    if (numbered.get(numId)?.get(level)) {
      const key = `${numId}:${level}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      marker = `${next}. `;
    }
    return `${indent}${marker}${paragraph}`;
  });
  const withLinks = withLists.replace(
    /<w:hyperlink\b[^>]*\br:id="([^"]+)"[^>]*>([\s\S]*?)<\/w:hyperlink>/g,
    (match, id: string, inner: string) => {
      const url = links.get(id);
      return url && /^https?:/i.test(url) ? `${inner} (${url})` : inner;
    },
  );
  const withBreaks = withLinks
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n");
  return decodeXml(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function textFromDocx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) {
    throw new Error("That Word file has no document body.");
  }
  const xml = await file.async("string");
  const numberingXml = (await zip.file("word/numbering.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const text = docxXmlToText(xml, numberingXml, docxLinkTargets(relsXml));
  if (!text) {
    throw new Error("That Word file has no readable text.");
  }
  return text;
}

function cellText(value: ExcelJS.CellValue) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("text" in value && value.text) {
      return String(value.text);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("result" in value && value.result != null) {
      return String(value.result);
    }
    if ("hyperlink" in value && value.hyperlink) {
      const text = "text" in value ? String(value.text ?? "") : "";
      return text ? `${text} ${value.hyperlink}` : String(value.hyperlink);
    }
  }
  return String(value);
}

async function textFromXlsx(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheets: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [`# ${sheet.name}`];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as ExcelJS.CellValue[])
        .slice(1)
        .map((value) => cellText(value).replace(/\s+/g, " ").trim());
      if (cells.some(Boolean)) {
        lines.push(cells.join("\t"));
      }
    });
    if (lines.length > 1) {
      sheets.push(lines.join("\n"));
    }
  });
  const text = sheets.join("\n\n").trim();
  if (!text) {
    throw new Error("That spreadsheet has no readable rows.");
  }
  return text;
}

export async function textFromUpload(fileName: string, buffer: Buffer) {
  if (buffer.byteLength === 0) {
    throw new Error("That file is empty.");
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error("File is larger than 15 MB.");
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) {
    return textFromDocx(buffer);
  }
  if (lower.endsWith(".xlsx")) {
    return textFromXlsx(buffer);
  }
  if (lower.endsWith(".xls")) {
    throw new Error("Save the spreadsheet as .xlsx or .csv and upload it again.");
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    if (!text) {
      throw new Error("That file is empty.");
    }
    return text;
  }
  throw new Error("Upload a .docx, .xlsx, .csv, or .txt file.");
}

function parseModelJson(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The reader did not return contact data. Try the file again.");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

const STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["label", "day", "subject", "body"],
  properties: {
    label: { type: "string" },
    day: { type: "integer" },
    subject: { type: "string" },
    body: { type: "string" },
  },
} as const;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["listName", "contacts"],
  properties: {
    listName: { type: "string" },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "firstName",
          "lastName",
          "email",
          "companyName",
          "position",
          "personalLinkedIn",
          "steps",
        ],
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          companyName: { type: "string" },
          position: { type: "string" },
          personalLinkedIn: { type: "string" },
          steps: { type: "array", items: STEP_SCHEMA },
        },
      },
    },
  },
} as const;

function clipText(text: string) {
  return text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated]`
    : text;
}

type ModelCall = {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  reasoningEffort?: string;
};

async function readWithOpenAI(apiKey: string, call: ModelCall) {
  const model = process.env.OPENAI_PERSONALISE_MODEL?.trim() || "gpt-5-mini";
  const effort =
    call.reasoningEffort || process.env.OPENAI_PERSONALISE_REASONING?.trim() || "minimal";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...(effort === "off" ? {} : { reasoning: { effort } }),
      instructions: call.instructions,
      input: call.input,
      max_output_tokens: call.maxOutputTokens ?? 32000,
      text: {
        format: {
          type: "json_schema",
          name: call.schemaName,
          strict: true,
          schema: call.schema,
        },
      },
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    status?: string;
    incomplete_details?: { reason?: string };
    error?: { message?: string } | null;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string; refusal?: string }>;
    }>;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }
  if (data?.status === "incomplete") {
    if (data.incomplete_details?.reason === "max_output_tokens") {
      throw new Error("That file is too long to read in one pass. Split it into smaller files.");
    }
    throw new Error("The reader stopped before finishing. Try the file again.");
  }
  const parts = (data?.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  const refusal = parts.find((part) => part.type === "refusal")?.refusal;
  if (refusal) {
    throw new Error(refusal);
  }
  const content = parts
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) {
    throw new Error("The reader returned an empty response.");
  }
  return parseModelJson(content);
}

async function readWithModel(call: ModelCall) {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    try {
      return await readWithOpenAI(openAiKey, call);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/too long to read/i.test(message) || !process.env.DEEPSEEK_API_KEY?.trim()) {
        throw error;
      }
      console.warn(`[personalise] OpenAI reader failed, using DeepSeek: ${message}`);
    }
  }
  return readWithDeepSeek(call);
}

async function readWithDeepSeek(call: ModelCall) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set OPENAI_API_KEY or DEEPSEEK_API_KEY to read uploaded files.");
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: call.instructions },
        { role: "user", content: call.input },
      ],
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string };
    }>;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `Could not read the file (${response.status})`);
  }

  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("That file is too long to read in one pass. Split it into smaller files.");
  }
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error("The reader returned an empty response.");
  }
  return parseModelJson(content);
}

const OUTLINE_PROMPT = `You map an outreach document or spreadsheet. Each line is shown as "L<number>: <start of the line>". Long lines are cut short.

Return JSON only, in this shape:
{
  "listName": "short name taken from the document title",
  "contacts": [{ "name": "First Last", "startLine": 12, "startText": "01  Company: First Last" }]
}

Rules:
- One entry per person who has emails written for them, in file order. Do not skip anyone; check the count against any index table.
- startLine is the line where that person's own section or row begins (the heading or row that starts their emails), not a table of contents, index, or summary table near the top.
- startText is the first 40 characters of that start line, copied exactly as shown after "L<number>: ".
- The sender who signs the emails is not a contact. A name in a greeting ("Dear Mohammed") or a follow-up heading is not a new section.
- When you are given part of a file and it opens in the middle of someone's section (follow-ups with no heading for that person), do not list that person.
- In a spreadsheet with one row per person, startLine is that person's row.
- Do not add people who are not in the file. listName comes from the document title, not a person's name.`;

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["listName", "contacts"],
  properties: {
    listName: { type: "string" },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "startLine", "startText"],
        properties: {
          name: { type: "string" },
          startLine: { type: "integer" },
          startText: { type: "string" },
        },
      },
    },
  },
} as const;

const OUTLINE_LINE_CHARS = 90;
const OUTLINE_WINDOW_LINES = 600;
const OUTLINE_CONTEXT_LINES = 60;
const MAX_OUTLINE_CHARS = 600_000;
const PREAMBLE_CHARS = 4_000;
const SECTION_CONCURRENCY = 24;

type Section = { name: string; text: string };

/** Coarse shape of a line's opening characters, e.g. "01  AlawnehPay" -> "9_a". */
function headingShape(line: string) {
  return line
    .trim()
    .slice(0, 5)
    .replace(/\p{N}+/gu, "9")
    .replace(/\p{L}+/gu, "a")
    .replace(/\s+/g, "_");
}

/**
 * Section headings in one file share a shape. Drop model picks that do not match the
 * dominant shape (greetings, follow-up labels, signatures) and add matching lines it missed.
 */
function alignToHeadingShape(
  lines: string[],
  starts: Array<{ name: string; startLine: number }>,
) {
  if (starts.length < 3) {
    return starts;
  }
  const counts = new Map<string, number>();
  for (const item of starts) {
    const shape = headingShape(lines[item.startLine] ?? "");
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  const [topShape, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!topShape || topCount < starts.length * 0.6) {
    return starts;
  }
  const matching = starts.filter(
    (item) => headingShape(lines[item.startLine] ?? "") === topShape,
  );
  const firstLine = Math.min(...matching.map((item) => item.startLine));
  const candidates: number[] = [];
  for (let index = firstLine; index < lines.length; index += 1) {
    if (lines[index].trim() && headingShape(lines[index]) === topShape) {
      candidates.push(index);
    }
  }
  if (candidates.length > matching.length * 1.5) {
    return matching;
  }
  const nameByLine = new Map(matching.map((item) => [item.startLine, item.name]));
  return candidates.map((startLine) => ({
    name: nameByLine.get(startLine) ?? lines[startLine].trim().slice(0, 120),
    startLine,
  }));
}

async function outlineSections(fileName: string, text: string) {
  const lines = text.split("\n");
  const numbered: string[] = [];
  let outlineChars = 0;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const entry = `L${index}: ${trimmed.slice(0, OUTLINE_LINE_CHARS)}`;
    outlineChars += entry.length + 1;
    if (outlineChars > MAX_OUTLINE_CHARS) {
      break;
    }
    numbered.push(entry);
  }
  const windows: string[][] = [];
  for (let index = 0; index < numbered.length; index += OUTLINE_WINDOW_LINES) {
    windows.push(
      numbered.slice(Math.max(0, index - OUTLINE_CONTEXT_LINES), index + OUTLINE_WINDOW_LINES),
    );
  }
  type OutlineResult = {
    listName?: unknown;
    contacts?: Array<{ name?: unknown; startLine?: unknown; startText?: unknown }>;
  };
  const windowResults = await mapWithConcurrency(windows, SECTION_CONCURRENCY, (window) => {
    const index = windows.indexOf(window);
    const scope =
      windows.length > 1
        ? `This is part ${index + 1} of ${windows.length} of the file. List only people whose own section or row starts within the lines of this part.`
        : "";
    return readWithModel({
      instructions: OUTLINE_PROMPT,
      input: [`File name: ${fileName}`, scope, window.join("\n")]
        .filter(Boolean)
        .join("\n\n"),
      schemaName: "personalise_outline",
      schema: OUTLINE_SCHEMA,
      maxOutputTokens: 8000,
    }) as Promise<OutlineResult>;
  });
  const parsed: OutlineResult = {
    listName: windowResults
      .map((result) => String(result?.listName ?? "").trim())
      .find(Boolean),
    contacts: windowResults.flatMap((result) =>
      Array.isArray(result?.contacts) ? result.contacts : [],
    ),
  };

  const squash = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const snapLine = (startLine: number, startText: string) => {
    const needle = squash(startText).slice(0, 40);
    if (needle.length < 4) {
      return startLine;
    }
    const matches = (index: number) =>
      index >= 0 && index < lines.length && squash(lines[index]).startsWith(needle);
    for (let delta = 0; delta <= 80; delta += 1) {
      if (matches(startLine + delta)) {
        return startLine + delta;
      }
      if (matches(startLine - delta)) {
        return startLine - delta;
      }
    }
    return startLine;
  };

  const latestByName = new Map<string, { name: string; startLine: number }>();
  for (const item of Array.isArray(parsed.contacts) ? parsed.contacts : []) {
    const rawLine = Math.floor(Number(item?.startLine));
    const name = String(item?.name ?? "").trim();
    const startLine = Number.isFinite(rawLine)
      ? snapLine(rawLine, String(item?.startText ?? ""))
      : rawLine;
    if (!name || !Number.isFinite(startLine) || startLine < 0 || startLine >= lines.length) {
      continue;
    }
    const key = squash(name);
    const existing = latestByName.get(key);
    if (!existing || startLine > existing.startLine) {
      latestByName.set(key, { name, startLine });
    }
  }
  const starts = alignToHeadingShape(lines, [...latestByName.values()])
    .sort((left, right) => left.startLine - right.startLine)
    .filter((item, index, all) => index === 0 || item.startLine > all[index - 1].startLine);

  if (starts.length < 2) {
    return null;
  }
  const preamble = lines.slice(0, starts[0].startLine).join("\n").trim().slice(0, PREAMBLE_CHARS);
  const sections: Section[] = starts.map((item, index) => ({
    name: item.name,
    text: lines
      .slice(item.startLine, starts[index + 1]?.startLine ?? lines.length)
      .join("\n")
      .trim(),
  }));
  return {
    listName: String(parsed.listName ?? "").trim(),
    preamble,
    sections,
  };
}

async function readSection(fileName: string, preamble: string, section: Section) {
  const input = [
    `File name: ${fileName}`,
    preamble
      ? `Document header, for context only (column names, title). Do not extract contacts from it:\n${preamble}`
      : "",
    `Extract only this contact: ${section.name}. Return exactly one contact.`,
    section.text,
  ]
    .filter(Boolean)
    .join("\n\n");
  const call: ModelCall = {
    instructions: SYSTEM_PROMPT,
    input: clipText(input),
    schemaName: "personalise_plan",
    schema: PLAN_SCHEMA,
    maxOutputTokens: 16000,
  };
  try {
    return await readWithModel(call);
  } catch {
    return readWithModel(call);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function readInSections(fileName: string, text: string) {
  const outline = await outlineSections(fileName, text).catch((error) => {
    console.warn(
      `[personalise] Could not map sections, reading in one pass: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  });
  if (!outline) {
    return null;
  }
  const results = await mapWithConcurrency(outline.sections, SECTION_CONCURRENCY, (section) =>
    readSection(fileName, outline.preamble, section),
  );
  const seen = new Set<string>();
  const contacts = results.flatMap((result) => {
    const record = result && typeof result === "object" ? (result as { contacts?: unknown }) : {};
    const list = Array.isArray(record.contacts) ? record.contacts : [];
    return list.filter((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const key =
        String(row.email ?? "").trim().toLowerCase() ||
        `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim().toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  });
  const firstListName = results
    .map((result) => (result as { listName?: unknown } | null)?.listName)
    .find((value) => typeof value === "string" && value.trim());
  return { listName: outline.listName || firstListName || "", contacts };
}

export async function extractPersonalisePlan(
  fileName: string,
  buffer: Buffer,
): Promise<PersonalisePlan> {
  const text = await textFromUpload(fileName, buffer);
  const sectioned = await readInSections(fileName, text);
  const parsed =
    sectioned ??
    (await readWithModel({
      instructions: SYSTEM_PROMPT,
      input: `File name: ${fileName}\n\n${clipText(text)}`,
      schemaName: "personalise_plan",
      schema: PLAN_SCHEMA,
    }));
  return normalizePersonalisePlan(parsed, fileName);
}
