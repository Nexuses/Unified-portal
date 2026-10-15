import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { KnowledgeDoc, KnowledgeDocWithMarkdown } from "@/lib/knowledge-base";

type KnowledgeMongoDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  markdown: string;
  markdownChars: number;
  truncated: boolean;
  preview?: string;
  createdAt: Date;
  createdBy: string;
};

function previewFromMarkdown(markdown: string) {
  return markdown
    .replace(/^#\s+.*\n+/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\|?\s*-{3,}.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+Page \d+\s*$/gm, "")
    .replace(/^(#{1,6}\s+)Slide \d+:\s*/gm, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[>*_`|]+/g, " ")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

const COLLECTION = "knowledge_base";

let indexReady: Promise<unknown> | null = null;

async function collection() {
  const db = await getDb();
  const docs = db.collection<KnowledgeMongoDoc>(COLLECTION);
  indexReady ??= docs.createIndex({ projectId: 1, createdAt: -1 }).catch((error) => {
    indexReady = null;
    console.error("Failed to create knowledge base index:", error);
  });
  await indexReady;
  return docs;
}

function toDoc(doc: Omit<KnowledgeMongoDoc, "markdown"> & { markdown?: string }): KnowledgeDoc {
  return {
    id: doc._id.toString(),
    title: doc.title,
    fileName: doc.fileName,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    markdownChars: doc.markdownChars,
    truncated: doc.truncated,
    preview: doc.preview ?? "",
    createdAt: doc.createdAt.toISOString(),
    createdBy: doc.createdBy,
  };
}

async function backfillPreviews(docs: Awaited<ReturnType<typeof collection>>, projectId: ObjectId) {
  const missing = await docs
    .find({ projectId, preview: { $exists: false } }, { projection: { markdown: 1 } })
    .toArray();
  await Promise.all(
    missing.map((doc) =>
      docs.updateOne({ _id: doc._id }, { $set: { preview: previewFromMarkdown(doc.markdown) } }),
    ),
  );
}

export async function listKnowledgeDocs(projectId: string): Promise<KnowledgeDoc[]> {
  const docs = await collection();
  const id = new ObjectId(projectId);
  await backfillPreviews(docs, id);
  const rows = await docs
    .find({ projectId: id }, { projection: { markdown: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map(toDoc);
}

export async function getKnowledgeDoc(
  projectId: string,
  id: string,
): Promise<KnowledgeDocWithMarkdown | null> {
  if (!ObjectId.isValid(id)) return null;
  const docs = await collection();
  const doc = await docs.findOne({ _id: new ObjectId(id), projectId: new ObjectId(projectId) });
  return doc ? { ...toDoc(doc), markdown: doc.markdown } : null;
}

export async function addKnowledgeDoc(
  projectId: string,
  input: {
    title: string;
    fileName: string;
    fileSize: number;
    markdown: string;
    truncated: boolean;
    createdBy: string;
  },
): Promise<KnowledgeDoc> {
  const docs = await collection();
  const doc: Omit<KnowledgeMongoDoc, "_id"> = {
    projectId: new ObjectId(projectId),
    title: input.title,
    fileName: input.fileName,
    fileType: input.fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "",
    fileSize: input.fileSize,
    markdown: input.markdown,
    markdownChars: input.markdown.length,
    truncated: input.truncated,
    preview: previewFromMarkdown(input.markdown),
    createdAt: new Date(),
    createdBy: input.createdBy,
  };
  const result = await docs.insertOne(doc as KnowledgeMongoDoc);
  return toDoc({ ...doc, _id: result.insertedId });
}

export async function deleteKnowledgeDoc(projectId: string, id: string) {
  if (!ObjectId.isValid(id)) return false;
  const docs = await collection();
  const result = await docs.deleteOne({ _id: new ObjectId(id), projectId: new ObjectId(projectId) });
  return result.deletedCount > 0;
}

/**
 * Newest-first Markdown for prompts, clipped so a large knowledge base
 * stays within a model's context budget.
 */
export async function loadKnowledgeMarkdown(projectId: string, maxChars = 12_000) {
  const docs = await collection();
  const rows = await docs
    .find({ projectId: new ObjectId(projectId) }, { projection: { title: 1, markdown: 1 } })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  if (rows.length === 0) return "";
  const perDoc = Math.max(1500, Math.floor(maxChars / rows.length));
  let out = "";
  for (const row of rows) {
    const chunk = row.markdown.length > perDoc ? `${row.markdown.slice(0, perDoc)}\n…` : row.markdown;
    if (out.length + chunk.length > maxChars) break;
    out += `${out ? "\n\n---\n\n" : ""}${chunk}`;
  }
  return out;
}
