import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  PROJECT_ASSISTANT_CATALOG,
  PROJECT_ASSISTANT_PROVIDERS,
  type ProjectAssistantAuthType,
  type ProjectAssistantConversationPublic,
  type ProjectAssistantIntegrationPublic,
  type ProjectAssistantMessagePublic,
  type ProjectAssistantProvider,
} from "@/lib/project-assistant-types";

export type ProjectAssistantIntegrationDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  provider: ProjectAssistantProvider;
  name: string;
  apiKey: string;
  baseUrl: string;
  authType: ProjectAssistantAuthType;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectAssistantConversationDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectAssistantMessageDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  conversationId?: ObjectId;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

function maskKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

function normalizeProvider(raw: string): ProjectAssistantProvider {
  const value = raw.trim().toLowerCase();
  if ((PROJECT_ASSISTANT_PROVIDERS as readonly string[]).includes(value)) {
    return value as ProjectAssistantProvider;
  }
  throw new Error("Unknown integration provider.");
}

function defaultBaseUrl(provider: ProjectAssistantProvider, name: string) {
  if (provider === "other") {
    if (/hubspot/i.test(name)) return "https://api.hubapi.com";
    return "";
  }
  return (
    PROJECT_ASSISTANT_CATALOG.find((item) => item.provider === provider)
      ?.defaultBaseUrl || ""
  );
}

function defaultAuthType(
  provider: ProjectAssistantProvider,
  name: string,
): ProjectAssistantAuthType {
  if (provider === "other") {
    if (/hubspot/i.test(name)) return "bearer";
    if (/smartlead/i.test(name)) return "query";
    return "bearer";
  }
  return (
    PROJECT_ASSISTANT_CATALOG.find((item) => item.provider === provider)
      ?.authType || "bearer"
  );
}

export function serializeProjectAssistantIntegration(
  doc: ProjectAssistantIntegrationDoc,
): ProjectAssistantIntegrationPublic {
  return {
    id: doc._id.toString(),
    provider: doc.provider,
    name: doc.name,
    baseUrl: doc.baseUrl,
    authType: doc.authType,
    keyHint: maskKey(doc.apiKey),
    connectedAt: doc.createdAt.toISOString(),
  };
}

export function serializeProjectAssistantMessage(
  doc: ProjectAssistantMessageDoc,
): ProjectAssistantMessagePublic {
  return {
    id: doc._id.toString(),
    role: doc.role,
    content: doc.content,
    createdAt: doc.createdAt.toISOString(),
    conversationId: doc.conversationId?.toString(),
  };
}

export function serializeProjectAssistantConversation(
  doc: ProjectAssistantConversationDoc,
): ProjectAssistantConversationPublic {
  return {
    id: doc._id.toString(),
    title: doc.title,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function titleFromMessage(content: string) {
  const cleaned = content
    .replace(/^Submitted[^\n]*\n?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trim()}…` : cleaned;
}

async function migrateLegacyMessages(projectId: ObjectId) {
  const db = await getDb();
  const messages = db.collection<ProjectAssistantMessageDoc>(
    "project_assistant_messages",
  );
  const legacyFilter = {
    projectId,
    conversationId: { $exists: false },
  } as const;
  const legacyCount = await messages.countDocuments(legacyFilter);
  if (!legacyCount) return;

  const conversations = db.collection<ProjectAssistantConversationDoc>(
    "project_assistant_conversations",
  );
  const existing = await conversations.findOne({ projectId }, { sort: { createdAt: 1 } });
  let conversationId = existing?._id;
  if (!conversationId) {
    const firstUser = await messages.findOne(
      { ...legacyFilter, role: "user" },
      { sort: { createdAt: 1 } },
    );
    const now = new Date();
    const doc: ProjectAssistantConversationDoc = {
      _id: new ObjectId(),
      projectId,
      title: firstUser ? titleFromMessage(firstUser.content) : "Previous chat",
      createdAt: firstUser?.createdAt ?? now,
      updatedAt: now,
    };
    await conversations.insertOne(doc);
    conversationId = doc._id;
  }
  await messages.updateMany(legacyFilter, { $set: { conversationId } });
}

export async function listProjectAssistantConversations(projectId: ObjectId) {
  await migrateLegacyMessages(projectId);
  const db = await getDb();
  const rows = await db
    .collection<ProjectAssistantConversationDoc>("project_assistant_conversations")
    .find({ projectId })
    .sort({ updatedAt: -1 })
    .limit(80)
    .toArray();
  return rows.map(serializeProjectAssistantConversation);
}

export async function createProjectAssistantConversation(
  projectId: ObjectId,
  title = "New chat",
) {
  const db = await getDb();
  const now = new Date();
  const doc: ProjectAssistantConversationDoc = {
    _id: new ObjectId(),
    projectId,
    title: title.trim() || "New chat",
    createdAt: now,
    updatedAt: now,
  };
  await db
    .collection<ProjectAssistantConversationDoc>("project_assistant_conversations")
    .insertOne(doc);
  return serializeProjectAssistantConversation(doc);
}

export async function getProjectAssistantConversation(
  projectId: ObjectId,
  conversationId: string,
) {
  if (!ObjectId.isValid(conversationId)) return null;
  const db = await getDb();
  const doc = await db
    .collection<ProjectAssistantConversationDoc>("project_assistant_conversations")
    .findOne({ _id: new ObjectId(conversationId), projectId });
  return doc ? serializeProjectAssistantConversation(doc) : null;
}

export async function deleteProjectAssistantConversation(
  projectId: ObjectId,
  conversationId: string,
) {
  if (!ObjectId.isValid(conversationId)) {
    throw new Error("Chat not found.");
  }
  const id = new ObjectId(conversationId);
  const db = await getDb();
  const result = await db
    .collection<ProjectAssistantConversationDoc>("project_assistant_conversations")
    .deleteOne({ _id: id, projectId });
  if (!result.deletedCount) {
    throw new Error("Chat not found.");
  }
  await db
    .collection<ProjectAssistantMessageDoc>("project_assistant_messages")
    .deleteMany({ projectId, conversationId: id });
}

export async function touchProjectAssistantConversation(
  projectId: ObjectId,
  conversationId: ObjectId,
  title?: string,
) {
  const db = await getDb();
  const updates: Partial<ProjectAssistantConversationDoc> = {
    updatedAt: new Date(),
  };
  if (title?.trim()) {
    updates.title = title.trim();
  }
  await db
    .collection<ProjectAssistantConversationDoc>("project_assistant_conversations")
    .updateOne({ _id: conversationId, projectId }, { $set: updates });
}

export async function listProjectAssistantIntegrations(projectId: ObjectId) {
  const db = await getDb();
  const rows = await db
    .collection<ProjectAssistantIntegrationDoc>("project_assistant_integrations")
    .find({ projectId })
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map(serializeProjectAssistantIntegration);
}

export async function listProjectAssistantIntegrationDocs(projectId: ObjectId) {
  const db = await getDb();
  return db
    .collection<ProjectAssistantIntegrationDoc>("project_assistant_integrations")
    .find({ projectId })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function upsertProjectAssistantIntegration(input: {
  projectId: ObjectId;
  provider: string;
  name?: string;
  apiKey: string;
  baseUrl?: string;
  authType?: ProjectAssistantAuthType;
}) {
  const provider = normalizeProvider(input.provider);
  const apiKey = String(input.apiKey || "")
    .trim()
    .replace(/^bearer\s+/i, "");
  if (!apiKey) {
    throw new Error("Paste an API key or access token.");
  }
  const catalog = PROJECT_ASSISTANT_CATALOG.find((item) => item.provider === provider);
  const name =
    provider === "other"
      ? String(input.name || "").trim()
      : catalog?.title || provider;
  if (provider === "other" && name.length < 2) {
    throw new Error("Name the custom API (e.g. HubSpot or SmartLead).");
  }
  const baseUrl = String(input.baseUrl || "")
    .trim()
    .replace(/\/$/, "") || defaultBaseUrl(provider, name);
  if (provider === "other" && !baseUrl) {
    throw new Error("Add a base URL for the custom API.");
  }
  const authType = input.authType || defaultAuthType(provider, name);
  const now = new Date();
  const db = await getDb();
  const collection = db.collection<ProjectAssistantIntegrationDoc>(
    "project_assistant_integrations",
  );

  const existing =
    provider === "other"
      ? await collection.findOne({ projectId: input.projectId, provider, name })
      : await collection.findOne({ projectId: input.projectId, provider });

  if (existing) {
    await collection.updateOne(
      { _id: existing._id },
      {
        $set: {
          name,
          apiKey,
          baseUrl,
          authType,
          updatedAt: now,
        },
      },
    );
    return serializeProjectAssistantIntegration({
      ...existing,
      name,
      apiKey,
      baseUrl,
      authType,
      updatedAt: now,
    });
  }

  const doc: ProjectAssistantIntegrationDoc = {
    _id: new ObjectId(),
    projectId: input.projectId,
    provider,
    name,
    apiKey,
    baseUrl,
    authType,
    createdAt: now,
    updatedAt: now,
  };
  await collection.insertOne(doc);
  return serializeProjectAssistantIntegration(doc);
}

export async function deleteProjectAssistantIntegration(
  projectId: ObjectId,
  integrationId: string,
) {
  if (!ObjectId.isValid(integrationId)) {
    throw new Error("Integration not found.");
  }
  const db = await getDb();
  const result = await db
    .collection<ProjectAssistantIntegrationDoc>("project_assistant_integrations")
    .deleteOne({ _id: new ObjectId(integrationId), projectId });
  if (!result.deletedCount) {
    throw new Error("Integration not found.");
  }
}

export async function listProjectAssistantMessages(
  projectId: ObjectId,
  conversationId: string,
  limit = 80,
) {
  if (!ObjectId.isValid(conversationId)) {
    return [];
  }
  await migrateLegacyMessages(projectId);
  const db = await getDb();
  const rows = await db
    .collection<ProjectAssistantMessageDoc>("project_assistant_messages")
    .find({ projectId, conversationId: new ObjectId(conversationId) })
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, limit)))
    .toArray();
  return rows.reverse().map(serializeProjectAssistantMessage);
}

export async function appendProjectAssistantMessages(
  projectId: ObjectId,
  conversationId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  if (!ObjectId.isValid(conversationId)) {
    throw new Error("Chat not found.");
  }
  const conversationObjectId = new ObjectId(conversationId);
  const existing = await getProjectAssistantConversation(projectId, conversationId);
  if (!existing) {
    throw new Error("Chat not found.");
  }

  const db = await getDb();
  const now = new Date();
  const docs: ProjectAssistantMessageDoc[] = messages.map((message, index) => ({
    _id: new ObjectId(),
    projectId,
    conversationId: conversationObjectId,
    role: message.role,
    content: message.content,
    createdAt: new Date(now.getTime() + index),
  }));
  if (docs.length) {
    await db
      .collection<ProjectAssistantMessageDoc>("project_assistant_messages")
      .insertMany(docs);
  }

  const firstUser = messages.find((message) => message.role === "user");
  const shouldRename =
    existing.title === "New chat" || existing.title === "Previous chat";
  await touchProjectAssistantConversation(
    projectId,
    conversationObjectId,
    shouldRename && firstUser ? titleFromMessage(firstUser.content) : undefined,
  );

  return docs.map(serializeProjectAssistantMessage);
}

export async function clearProjectAssistantMessages(
  projectId: ObjectId,
  conversationId?: string,
) {
  const db = await getDb();
  if (conversationId) {
    if (!ObjectId.isValid(conversationId)) return;
    await db
      .collection<ProjectAssistantMessageDoc>("project_assistant_messages")
      .deleteMany({ projectId, conversationId: new ObjectId(conversationId) });
    await touchProjectAssistantConversation(
      projectId,
      new ObjectId(conversationId),
      "New chat",
    );
    return;
  }
  await db
    .collection<ProjectAssistantMessageDoc>("project_assistant_messages")
    .deleteMany({ projectId });
}

function authHeaders(
  integration: ProjectAssistantIntegrationDoc,
): Record<string, string> {
  const key = integration.apiKey.trim();
  if (integration.authType === "api-key") {
    return { "api-key": key, Accept: "application/json" };
  }
  if (integration.authType === "authorization") {
    return { Authorization: key, Accept: "application/json" };
  }
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export async function callConnectedApi(input: {
  projectId: ObjectId;
  integrationId: string;
  method?: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const docs = await listProjectAssistantIntegrationDocs(input.projectId);
  const integration = docs.find((item) => item._id.toString() === input.integrationId);
  if (!integration) {
    throw new Error("Connect that tool first.");
  }
  const method = String(input.method || "GET").toUpperCase();
  const path = String(input.path || "").trim();
  if (!path) {
    throw new Error("Provide an API path, e.g. /crm/v3/objects/contacts");
  }
  const url = new URL(
    path.startsWith("http")
      ? path
      : `${integration.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
  );
  if (integration.authType === "query") {
    url.searchParams.set("api_key", integration.apiKey);
  }
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      url.searchParams.set(key, value);
    }
  }
  const init: RequestInit = {
    method,
    headers: authHeaders(integration),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  };
  if (input.body != null && method !== "GET" && method !== "HEAD") {
    init.body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  }
  const response = await fetch(url.toString(), init);
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 8000);
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      integration: integration.name,
      error:
        typeof data === "string"
          ? data.slice(0, 1200)
          : JSON.stringify(data).slice(0, 1200),
    };
  }
  return {
    ok: true,
    status: response.status,
    integration: integration.name,
    provider: integration.provider,
    data:
      typeof data === "string"
        ? data.slice(0, 24_000)
        : JSON.parse(JSON.stringify(data).slice(0, 24_000)),
  };
}
