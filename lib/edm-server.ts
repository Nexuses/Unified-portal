import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type EdmDestination = "drip" | "oneone";

export type EdmTemplate = {
  id: string;
  name: string;
  subject: string;
  html: string;
  destinations: EdmDestination[];
  updatedAt: string;
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

export async function deleteEdmTemplate(projectId: string, templateId: string) {
  if (!ObjectId.isValid(templateId)) {
    return false;
  }
  const db = await getDb();
  const result = await db.collection<TemplateDoc>("edm_templates").deleteOne({
    _id: new ObjectId(templateId),
    projectId,
  });
  return result.deletedCount === 1;
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
