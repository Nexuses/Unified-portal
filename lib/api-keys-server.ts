import { createHash, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SessionUser } from "@/lib/auth";
import {
  DEFAULT_PROJECT_SENDING_LIMIT,
  normalizeSendingLimit,
} from "@/lib/projects";

export const API_KEY_PREFIX = "up_live_";

export type ApiKeyDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  createdBy: ObjectId;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  keyHash: string;
  /** Full project access: read + write on portal APIs */
  scopes: Array<"read" | "write">;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
};

export type ApiKeyPublic = {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  hint: string;
  scopes: Array<"read" | "write">;
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  logoUrl?: string;
  sendingLimit?: number;
};

export function hashApiKey(rawKey: string) {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey() {
  const secret = randomBytes(24).toString("base64url");
  const rawKey = `${API_KEY_PREFIX}${secret}`;
  return {
    rawKey,
    keyPrefix: API_KEY_PREFIX,
    keyLast4: rawKey.slice(-4),
    keyHash: hashApiKey(rawKey),
  };
}

export function mapApiKey(doc: ApiKeyDoc): ApiKeyPublic {
  return {
    id: doc._id.toString(),
    name: doc.name,
    keyPrefix: doc.keyPrefix,
    keyLast4: doc.keyLast4,
    hint: `${doc.keyPrefix}${"•".repeat(8)}${doc.keyLast4}`,
    scopes: doc.scopes,
    lastUsedAt: doc.lastUsedAt?.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    revokedAt: doc.revokedAt?.toISOString(),
  };
}

export async function listProjectApiKeys(projectId: ObjectId) {
  const db = await getDb();
  const docs = await db
    .collection<ApiKeyDoc>("api_keys")
    .find({ projectId, revokedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(mapApiKey);
}

export async function createProjectApiKey(input: {
  projectId: ObjectId;
  createdBy: ObjectId;
  name: string;
}) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Name is required");
  }
  if (name.length > 80) {
    throw new Error("Name must be 80 characters or fewer");
  }

  const generated = generateApiKey();
  const now = new Date();
  const doc: ApiKeyDoc = {
    _id: new ObjectId(),
    projectId: input.projectId,
    createdBy: input.createdBy,
    name,
    keyPrefix: generated.keyPrefix,
    keyLast4: generated.keyLast4,
    keyHash: generated.keyHash,
    scopes: ["read", "write"],
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  await db.collection<ApiKeyDoc>("api_keys").insertOne(doc);

  return {
    key: mapApiKey(doc),
    rawKey: generated.rawKey,
  };
}

export async function revokeProjectApiKey(
  projectId: ObjectId,
  keyId: string,
) {
  if (!ObjectId.isValid(keyId)) {
    return false;
  }
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<ApiKeyDoc>("api_keys").updateOne(
    {
      _id: new ObjectId(keyId),
      projectId,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: now, updatedAt: now } },
  );
  return result.matchedCount > 0;
}

function extractBearerToken(authorization: string | null) {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

export async function getSessionUserFromApiKey(
  authorizationHeader: string | null,
): Promise<SessionUser | null> {
  const rawKey = extractBearerToken(authorizationHeader);
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const db = await getDb();
  const keyHash = hashApiKey(rawKey);
  const doc = await db.collection<ApiKeyDoc>("api_keys").findOne({
    keyHash,
    revokedAt: { $exists: false },
  });
  if (!doc) {
    return null;
  }

  const project = await db.collection<ProjectDoc>("projects").findOne({
    _id: doc.projectId,
  });
  if (!project) {
    return null;
  }

  void db.collection<ApiKeyDoc>("api_keys").updateOne(
    { _id: doc._id },
    { $set: { lastUsedAt: new Date(), updatedAt: new Date() } },
  );

  return {
    id: doc.createdBy.toString(),
    fullName: doc.name,
    email: `api-key:${doc._id.toString()}`,
    projectId: doc.projectId.toString(),
    projectName: project.name || "Unknown",
    projectLogoUrl: project.logoUrl?.trim() || "",
    sendingLimit: normalizeSendingLimit(
      project.sendingLimit ?? DEFAULT_PROJECT_SENDING_LIMIT,
    ),
  };
}
