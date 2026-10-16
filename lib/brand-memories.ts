import { ObjectId } from "mongodb";
import { fileToMarkdown } from "@/lib/knowledge-base-convert";
import { colorsFromImageBuffer } from "@/lib/logo-brand";
import { getDb } from "@/lib/mongodb";
import { runInApiCredit } from "@/lib/api-credits-server";
import { chatWithDeepSeek } from "@/lib/deepseek";

const TEXT_LIMIT = 40_000;
const MAX_MEMORIES = 60;
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);

type MemoryDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  title: string;
  text: string;
  fileName: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BrandMemory = {
  id: string;
  title: string;
  text: string;
  preview: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

function clip(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, TEXT_LIMIT);
}

function extensionOf(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function titleFromText(text: string, fallback: string) {
  const line = text
    .split("\n")
    .map((item) => item.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return (line || fallback).slice(0, 80);
}

function cleanModelTitle(raw: string) {
  const line = raw
    .split("\n")[0]
    .replace(/^["'“”#*\-\s]+|["'“”.\s]+$/g, "")
    .trim();
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 8) return "";
  return words.slice(0, 6).join(" ").slice(0, 80);
}

/** Reads the guideline and returns a short card name. */
async function nameFromContent(projectId: ObjectId, text: string, fallback: string) {
  const sample = text.replace(/\s+/g, " ").trim().slice(0, 2800);
  if (sample.length < 12) return titleFromText(text, fallback);
  try {
    const content = await runInApiCredit(projectId.toString(), "assistant", () =>
      chatWithDeepSeek({
        maxTokens: 24,
        messages: [
          {
            role: "system",
            content:
              "You name a saved brand guideline. Read the text and reply with a proper title of 2 to 6 words. No quotes, no period, no explanation.",
          },
          { role: "user", content: sample },
        ],
      }),
    );
    const title = cleanModelTitle(content);
    if (title) return title;
  } catch (error) {
    console.error("Failed to name brand memory:", error);
  }
  return titleFromText(text, fallback);
}

function previewFrom(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function toMemory(doc: MemoryDoc): BrandMemory {
  return {
    id: doc._id.toString(),
    title: doc.title,
    text: doc.text,
    preview: previewFrom(doc.text),
    fileName: doc.fileName,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function collection() {
  const db = await getDb();
  const memories = db.collection<MemoryDoc>("brand_memories");
  await memories.createIndex({ projectId: 1, updatedAt: -1 }).catch(() => undefined);
  return memories;
}

async function adoptLegacyGuides(projectId: ObjectId) {
  const memories = await collection();
  const count = await memories.countDocuments({ projectId });
  if (count > 0) return;
  const db = await getDb();
  const project = await db
    .collection<{ designGuide?: string; vocalGuide?: string }>("projects")
    .findOne({ _id: projectId }, { projection: { designGuide: 1, vocalGuide: 1 } });
  const text = [project?.designGuide, project?.vocalGuide]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) return;
  const now = new Date();
  await memories.insertOne({
    _id: new ObjectId(),
    projectId,
    title: await nameFromContent(projectId, text, "Brand guidelines"),
    text: clip(text),
    fileName: "",
    createdAt: now,
    updatedAt: now,
  });
}

export async function listBrandMemories(projectId: ObjectId) {
  await adoptLegacyGuides(projectId);
  const memories = await collection();
  const docs = await memories.find({ projectId }).sort({ updatedAt: -1 }).limit(MAX_MEMORIES).toArray();
  return docs.map(toMemory);
}

export function brandGuidePrompt(memories: Array<{ text: string }>) {
  const body = memories
    .map((memory) => memory.text.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!body) return "";
  return `Brand guidelines. Follow this design system and vocal tone:\n${body}`;
}

function expandHex(value: string) {
  const hex = value.toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

function isGray(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

/** Hex colors named in guideline text, most frequent first. */
export function colorsFromGuide(text: string) {
  const found = [...text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((match) =>
    expandHex(`#${match[1]}`),
  );
  const counts = new Map<string, number>();
  for (const color of found) counts.set(color, (counts.get(color) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  const chromatic = ranked.filter((color) => !isGray(color));
  const neutrals = ranked.filter((color) => isGray(color));
  return [...chromatic, ...neutrals].slice(0, 6);
}

function colorDistance(left: string, right: string) {
  const [r1, g1, b1] = [1, 3, 5].map((index) => Number.parseInt(left.slice(index, index + 2), 16));
  const [r2, g2, b2] = [1, 3, 5].map((index) => Number.parseInt(right.slice(index, index + 2), 16));
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Guideline colors first, then logo colors that are not the same shade. */
export function mergeBrandColors(guide: string[], logo: string[]) {
  const colors = [...guide];
  for (const color of logo) {
    if (colors.length >= 6) break;
    if (colors.every((existing) => colorDistance(existing, color) > 40)) colors.push(color);
  }
  return colors.slice(0, 6);
}

function markdownDocument(title: string, body: string) {
  const cleaned = body.trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("# ")) return `${cleaned}\n`;
  return `# ${title}\n\n${cleaned}\n`;
}

async function textFromUpload(fileName: string, buffer: Buffer, note: string) {
  const title = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
  const ext = extensionOf(fileName);
  let markdown = "";
  if (IMAGE_EXT.has(ext)) {
    const colors = await colorsFromImageBuffer(buffer);
    const lines = colors.length
      ? [`Brand colors from this image:`, "", ...colors.map((color) => `- \`${color}\``)].join("\n")
      : "This image was uploaded. No brand colors could be read from it.";
    markdown = markdownDocument(title, lines);
  } else {
    try {
      markdown = (await fileToMarkdown(fileName, buffer)).markdown;
    } catch {
      const asText = buffer.subarray(0, 20_000).includes(0) ? "" : buffer.toString("utf8");
      const readable = asText.replace(/\u0000/g, "").trim();
      if (!readable) {
        throw new Error("That file could not be turned into Markdown. Upload a PDF, Word, spreadsheet, text, HTML, JSON, or image.");
      }
      markdown = markdownDocument(title, readable);
    }
  }
  const text = [note, markdown].filter(Boolean).join("\n\n");
  return { text: clip(text), fileName };
}

export async function addBrandMemory(
  projectId: ObjectId,
  input: { text?: string; fileName?: string; buffer?: Buffer },
) {
  const memories = await collection();
  const count = await memories.countDocuments({ projectId });
  if (count >= MAX_MEMORIES) {
    throw new Error(`You can keep up to ${MAX_MEMORIES} brand memories.`);
  }
  const note = clip(input.text);
  let text = note;
  let fileName = "";
  if (input.buffer && input.fileName) {
    const uploaded = await textFromUpload(input.fileName, input.buffer, note);
    text = uploaded.text;
    fileName = uploaded.fileName;
  }
  if (!text) throw new Error("Paste a guideline or upload a file.");
  const now = new Date();
  const doc: MemoryDoc = {
    _id: new ObjectId(),
    projectId,
    title: await nameFromContent(projectId, text, fileName || "Brand guideline"),
    text: clip(text),
    fileName,
    createdAt: now,
    updatedAt: now,
  };
  await memories.insertOne(doc);
  return toMemory(doc);
}

export async function updateBrandMemory(projectId: ObjectId, id: string, text: string) {
  if (!ObjectId.isValid(id)) return null;
  const next = clip(text);
  if (!next) throw new Error("Write something before saving.");
  const memories = await collection();
  const result = await memories.findOneAndUpdate(
    { _id: new ObjectId(id), projectId },
    {
      $set: {
        text: next,
        title: await nameFromContent(projectId, next, "Brand guideline"),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  return result ? toMemory(result) : null;
}

export async function deleteBrandMemory(projectId: ObjectId, id: string) {
  if (!ObjectId.isValid(id)) return false;
  const memories = await collection();
  const result = await memories.deleteOne({ _id: new ObjectId(id), projectId });
  return result.deletedCount === 1;
}
