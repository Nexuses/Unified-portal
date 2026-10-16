import { getDb } from "@/lib/mongodb";

export type EdmChatBucket = { name: string; region: string };

export type EdmChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageUrl?: string;
  buckets?: EdmChatBucket[];
};

export type EdmChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type EdmChat = {
  id: string;
  title: string;
  messages: EdmChatTurn[];
  html: string;
  imageBucket: EdmChatBucket | null;
  updatedAt: string;
};

type EdmChatDoc = {
  _id: string;
  projectId: string;
  title: string;
  messages: EdmChatTurn[];
  html: string;
  imageBucket: EdmChatBucket | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

const COLLECTION = "edm_chats";
const CHAT_LIMIT = 40;
const MESSAGE_LIMIT = 30;
const TEXT_LIMIT = 20_000;
const HTML_LIMIT = 200_000;
/** Inline images are kept newest-first until this budget; MongoDB caps a document at 16MB. */
const INLINE_IMAGE_BUDGET = 8_000_000;
const CHAT_ID = /^[a-zA-Z0-9-]{8,64}$/;

let indexesReady: Promise<unknown> | null = null;

function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = getDb()
      .then((db) =>
        Promise.all([
          db
            .collection<EdmChatDoc>(COLLECTION)
            .createIndex({ projectId: 1, updatedAt: -1 }, { name: "edm_chats_project_updated" }),
          db
            .collection<EdmChatDoc>(COLLECTION)
            .createIndex(
              { projectId: 1, updatedAt: -1, title: 1, _id: 1 },
              { name: "edm_chats_project_list" },
            ),
        ]),
      )
      .catch((error) => {
        console.error("EDM chat index failed:", error);
      });
  }
  return indexesReady;
}

function cleanBucket(value: unknown): EdmChatBucket | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { name?: unknown; region?: unknown };
  if (typeof record.name !== "string" || typeof record.region !== "string") return null;
  return { name: record.name.slice(0, 200), region: record.region.slice(0, 60) };
}

function cleanMessages(value: unknown): EdmChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-MESSAGE_LIMIT)
    .map((item) => {
      const turn: EdmChatTurn = {
        id: typeof item.id === "string" ? item.id.slice(0, 64) : crypto.randomUUID(),
        role: item.role as "user" | "assistant",
        text: typeof item.text === "string" ? item.text.slice(0, TEXT_LIMIT) : "",
      };
      if (typeof item.imageUrl === "string" && item.imageUrl) turn.imageUrl = item.imageUrl;
      if (Array.isArray(item.buckets)) {
        const buckets = item.buckets
          .map(cleanBucket)
          .filter((bucket): bucket is EdmChatBucket => Boolean(bucket))
          .slice(0, 20);
        if (buckets.length) turn.buckets = buckets;
      }
      return turn;
    });

  let budget = INLINE_IMAGE_BUDGET;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const url = turns[index].imageUrl;
    if (!url) continue;
    if (/^https?:\/\//i.test(url)) continue;
    if (url.startsWith("data:image/") && url.length <= budget) {
      budget -= url.length;
      continue;
    }
    delete turns[index].imageUrl;
  }
  return turns;
}

function toChat(doc: EdmChatDoc): EdmChat {
  return {
    id: doc._id,
    title: doc.title,
    messages: doc.messages ?? [],
    html: doc.html ?? "",
    imageBucket: doc.imageBucket ?? null,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function isEdmChatId(id: string) {
  return CHAT_ID.test(id);
}

export async function listEdmChats(projectId: string): Promise<EdmChatSummary[]> {
  void ensureIndexes();
  const db = await getDb();
  const docs = await db
    .collection<EdmChatDoc>(COLLECTION)
    .find({ projectId }, { projection: { title: 1, updatedAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(CHAT_LIMIT)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id,
    title: doc.title || "New chat",
    updatedAt: doc.updatedAt.toISOString(),
  }));
}

export async function getEdmChat(projectId: string, id: string): Promise<EdmChat | null> {
  if (!isEdmChatId(id)) return null;
  const db = await getDb();
  const doc = await db.collection<EdmChatDoc>(COLLECTION).findOne({ _id: id, projectId });
  return doc ? toChat(doc) : null;
}

export async function saveEdmChat(
  projectId: string,
  userId: string,
  input: { id?: unknown; title?: unknown; messages?: unknown; html?: unknown; imageBucket?: unknown },
): Promise<EdmChat> {
  const id = typeof input.id === "string" ? input.id : "";
  if (!isEdmChatId(id)) {
    throw new Error("Invalid chat id");
  }
  const messages = cleanMessages(input.messages);
  const html = typeof input.html === "string" ? input.html.slice(0, HTML_LIMIT) : "";
  const title =
    (typeof input.title === "string" ? input.title.trim().slice(0, 120) : "") || "New chat";
  const now = new Date();
  const db = await getDb();
  await db.collection<EdmChatDoc>(COLLECTION).updateOne(
    { _id: id, projectId },
    {
      $set: { title, messages, html, imageBucket: cleanBucket(input.imageBucket), updatedAt: now },
      $setOnInsert: { projectId, createdBy: userId, createdAt: now },
    },
    { upsert: true },
  );
  return {
    id,
    title,
    messages: [],
    html: "",
    imageBucket: cleanBucket(input.imageBucket),
    updatedAt: now.toISOString(),
  };
}

export async function deleteEdmChat(projectId: string, id: string) {
  if (!isEdmChatId(id)) return false;
  const db = await getDb();
  const result = await db.collection<EdmChatDoc>(COLLECTION).deleteOne({ _id: id, projectId });
  return result.deletedCount === 1;
}
