import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { textFromDocx, textFromXlsx } from "@/lib/personalise-extract";

import { KNOWLEDGE_MAX_FILE_BYTES } from "@/lib/knowledge-base";

export const KNOWLEDGE_MAX_MARKDOWN_CHARS = 1_000_000;
const MAX_TABLE_ROWS = 2000;

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function tidy(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function markdownTable(rows: string[][]) {
  const width = Math.max(...rows.map((row) => row.length));
  if (!Number.isFinite(width) || width === 0) return "";
  const pad = (row: string[]) =>
    Array.from({ length: width }, (_v, index) => escapeCell(row[index] ?? ""));
  const [header, ...body] = rows;
  const lines = [
    `| ${pad(header).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.slice(0, MAX_TABLE_ROWS).map((row) => `| ${pad(row).join(" | ")} |`),
  ];
  if (body.length > MAX_TABLE_ROWS) {
    lines.push("", `_${(body.length - MAX_TABLE_ROWS).toLocaleString()} more rows not included._`);
  }
  return lines.join("\n");
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function pdfToMarkdown(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text])
    .map((page) => tidy(page))
    .filter(Boolean);
  if (pages.length === 0) {
    throw new Error("That PDF has no readable text (it may be a scanned image).");
  }
  if (pages.length === 1) return pages[0];
  return pages.map((page, index) => `## Page ${index + 1}\n\n${page}`).join("\n\n");
}

async function pptxToMarkdown(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/g)?.pop()) - Number(b.match(/\d+/g)?.pop()));
  const slides: string[] = [];
  for (const [index, name] of slideFiles.entries()) {
    const xml = await zip.file(name)!.async("string");
    const paragraphs = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
      .map((match) =>
        decodeXml([...match[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join("")).trim(),
      )
      .filter(Boolean);
    if (paragraphs.length === 0) continue;
    const [title, ...rest] = paragraphs;
    slides.push(
      [`## Slide ${index + 1}: ${title}`, ...rest.map((line) => `- ${line}`)].join("\n"),
    );
  }
  if (slides.length === 0) {
    throw new Error("That presentation has no readable text.");
  }
  return slides.join("\n\n");
}

async function xlsxToMarkdown(buffer: Buffer) {
  const text = await textFromXlsx(buffer);
  return text
    .split(/\n(?=# )/)
    .map((block) => {
      const [heading, ...rows] = block.split("\n");
      const table = markdownTable(rows.map((row) => row.split("\t")));
      return `## ${heading.replace(/^#\s*/, "")}\n\n${table}`;
    })
    .join("\n\n");
}

function docxTextToMarkdown(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (line.includes("\t")) return `| ${line.split("\t").map(escapeCell).join(" | ")} |`;
      return trimmed;
    })
    .join("\n");
}

function htmlToMarkdown(html: string) {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const markdown = body
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) =>
      `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/g, "").trim()}\n\n`,
    )
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      return /^https?:/i.test(href) && label ? `[${label}](${href})` : label;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeXml(markdown).replace(/[ \t]{2,}/g, " "));
}

function extensionOf(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export function knowledgeTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

/** Converts an uploaded file into Markdown for the knowledge base. */
export async function fileToMarkdown(fileName: string, buffer: Buffer, name?: string) {
  if (buffer.byteLength === 0) throw new Error("That file is empty.");
  if (buffer.byteLength > KNOWLEDGE_MAX_FILE_BYTES) throw new Error("File is larger than 20 MB.");

  const ext = extensionOf(fileName);
  let body: string;
  switch (ext) {
    case "pdf":
      body = await pdfToMarkdown(buffer);
      break;
    case "docx":
      body = docxTextToMarkdown(await textFromDocx(buffer));
      break;
    case "pptx":
      body = await pptxToMarkdown(buffer);
      break;
    case "xlsx":
      body = await xlsxToMarkdown(buffer);
      break;
    case "csv":
    case "tsv":
      body = markdownTable(
        parseDelimited(buffer.toString("utf8").replace(/^\uFEFF/, ""), ext === "tsv" ? "\t" : ","),
      );
      break;
    case "md":
    case "markdown":
    case "txt":
      body = buffer.toString("utf8").replace(/^\uFEFF/, "");
      break;
    case "html":
    case "htm":
      body = htmlToMarkdown(buffer.toString("utf8"));
      break;
    case "json":
      body = `\`\`\`json\n${JSON.stringify(JSON.parse(buffer.toString("utf8")), null, 2)}\n\`\`\``;
      break;
    case "doc":
    case "ppt":
    case "xls":
      throw new Error(`Save the file as .${ext}x and upload it again.`);
    default:
      throw new Error("Upload a PDF, Word, PowerPoint, Excel, CSV, text, Markdown, HTML, or JSON file.");
  }

  body = tidy(body);
  if (!body) throw new Error("That file has no readable text.");

  const title = name?.trim().slice(0, 160) || knowledgeTitleFromFileName(fileName);
  let markdown = `# ${title}\n\n${body}\n`;
  let truncated = false;
  if (markdown.length > KNOWLEDGE_MAX_MARKDOWN_CHARS) {
    markdown = `${markdown.slice(0, KNOWLEDGE_MAX_MARKDOWN_CHARS)}\n\n_Content truncated._\n`;
    truncated = true;
  }
  return { title, markdown, truncated };
}
