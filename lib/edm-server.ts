import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type EdmDestination = "drip" | "oneone";

export type EdmMemoryLink = {
  id: string;
  name: string;
  link: string;
  updatedAt: string;
};

export type EdmTemplate = {
  id: string;
  name: string;
  subject: string;
  html: string;
  destinations: EdmDestination[];
  updatedAt: string;
};

type MemoryDoc = {
  _id: ObjectId;
  projectId: string;
  kind: "link";
  name: string;
  text: string;
  updatedAt: Date;
};

type TemplateDoc = {
  _id: ObjectId;
  projectId: string;
  name: string;
  subject: string;
  html: string;
  destinations: EdmDestination[];
  updatedAt: Date;
};

const HTML_LIMIT = 200_000;

function clip(value: string, limit: number) {
  return value.trim().slice(0, limit);
}

export function normalizeMemoryLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Link is required");
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid link");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Enter a valid link");
  }
  return url.toString().slice(0, 2000);
}

export async function listEdmLinks(projectId: string): Promise<EdmMemoryLink[]> {
  const db = await getDb();
  const docs = await db
    .collection<MemoryDoc>("edm_memory")
    .find({ projectId, kind: "link" })
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map(toMemoryLink);
}

export async function addEdmLink(projectId: string, name: string, link: string) {
  const cleanName = clip(name, 120);
  if (!cleanName) {
    throw new Error("Name is required");
  }
  const cleanLink = normalizeMemoryLink(link);
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<MemoryDoc>("edm_memory").insertOne({
    _id: new ObjectId(),
    projectId,
    kind: "link",
    name: cleanName,
    text: cleanLink,
    updatedAt: now,
  });
  const saved = await db
    .collection<MemoryDoc>("edm_memory")
    .findOne({ _id: result.insertedId });
  return saved ? toMemoryLink(saved) : null;
}

export async function deleteEdmMemory(projectId: string, id: string) {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db.collection<MemoryDoc>("edm_memory").deleteOne({
    _id: new ObjectId(id),
    projectId,
    kind: "link",
  });
  return result.deletedCount === 1;
}

export async function listEdmTemplates(
  projectId: string,
  destination?: EdmDestination,
) {
  const db = await getDb();
  const query: { projectId: string; destinations?: EdmDestination } = { projectId };
  if (destination) query.destinations = destination;
  const docs = await db
    .collection<TemplateDoc>("edm_templates")
    .find(query)
    .sort({ updatedAt: -1 })
    .limit(80)
    .toArray();
  return docs.map(toTemplate);
}

export async function saveEdmTemplate(input: {
  projectId: string;
  name: string;
  subject: string;
  html: string;
  destinations: EdmDestination[];
}) {
  const destinations = [...new Set(input.destinations)].filter(
    (item): item is EdmDestination => item === "drip" || item === "oneone",
  );
  if (!destinations.length) {
    throw new Error("Choose drip, 1-1, or both");
  }
  const html = clip(input.html, HTML_LIMIT);
  if (!html) {
    throw new Error("HTML is empty");
  }
  const db = await getDb();
  const now = new Date();
  const doc: TemplateDoc = {
    _id: new ObjectId(),
    projectId: input.projectId,
    name: clip(input.name, 120) || "EDM template",
    subject: clip(input.subject, 200),
    html,
    destinations,
    updatedAt: now,
  };
  await db.collection<TemplateDoc>("edm_templates").insertOne(doc);
  return toTemplate(doc);
}

function toMemoryLink(doc: MemoryDoc): EdmMemoryLink {
  return {
    id: doc._id.toString(),
    name: doc.name,
    link: doc.text,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toTemplate(doc: TemplateDoc): EdmTemplate {
  return {
    id: doc._id.toString(),
    name: doc.name,
    subject: doc.subject,
    html: doc.html,
    destinations: doc.destinations,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
