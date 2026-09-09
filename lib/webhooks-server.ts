import { createHmac, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export const WEBHOOK_EVENTS = [
  "campaign.created",
  "campaign.launched",
  "send.opened",
  "send.clicked",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export type WebhookDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  createdBy: ObjectId | null;
  url: string;
  events: WebhookEventType[];
  /** Used to sign deliveries; shown once on create. */
  secret: string;
  secretHint: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastDeliveredAt?: Date;
  lastStatus?: number;
  revokedAt?: Date;
};

export type WebhookPublic = {
  id: string;
  url: string;
  events: WebhookEventType[];
  secretHint: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastDeliveredAt?: string;
  lastStatus?: number;
};

export type WebhookEventPayload = {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  projectId: string;
  data: Record<string, unknown>;
};

function isWebhookEvent(value: unknown): value is WebhookEventType {
  return (
    typeof value === "string" &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

function generateSecret() {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return {
    secret,
    secretHint: `whsec_${"•".repeat(8)}${secret.slice(-4)}`,
  };
}

export function signWebhookBody(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function mapWebhook(doc: WebhookDoc): WebhookPublic {
  return {
    id: doc._id.toString(),
    url: doc.url,
    events: doc.events,
    secretHint: doc.secretHint,
    enabled: doc.enabled !== false,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    lastDeliveredAt: doc.lastDeliveredAt?.toISOString(),
    lastStatus: doc.lastStatus,
  };
}

function assertValidUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid webhook URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URL must use http or https.");
  }
  return parsed.toString();
}

export async function listProjectWebhooks(projectId: ObjectId) {
  const db = await getDb();
  const docs = await db
    .collection<WebhookDoc>("webhooks")
    .find({ projectId, revokedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(mapWebhook);
}

export async function createProjectWebhook(input: {
  projectId: ObjectId;
  createdBy: ObjectId | null;
  url: string;
  events?: unknown;
}) {
  const url = assertValidUrl(String(input.url ?? "").trim());
  const eventsRaw = Array.isArray(input.events)
    ? input.events
    : [...WEBHOOK_EVENTS];
  const events = [...new Set(eventsRaw.filter(isWebhookEvent))];
  if (events.length === 0) {
    throw new Error(`Pick at least one event: ${WEBHOOK_EVENTS.join(", ")}`);
  }

  const generated = generateSecret();
  const now = new Date();
  const doc: WebhookDoc = {
    _id: new ObjectId(),
    projectId: input.projectId,
    createdBy: input.createdBy,
    url,
    events,
    secret: generated.secret,
    secretHint: generated.secretHint,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  await db.collection<WebhookDoc>("webhooks").insertOne(doc);

  return {
    webhook: mapWebhook(doc),
    secret: generated.secret,
  };
}

export async function revokeProjectWebhook(
  projectId: ObjectId,
  webhookId: string,
) {
  if (!ObjectId.isValid(webhookId)) {
    return false;
  }
  const db = await getDb();
  const result = await db.collection<WebhookDoc>("webhooks").updateOne(
    {
      _id: new ObjectId(webhookId),
      projectId,
      revokedAt: { $exists: false },
    },
    {
      $set: {
        revokedAt: new Date(),
        updatedAt: new Date(),
        enabled: false,
      },
    },
  );
  return result.matchedCount > 0;
}

export async function emitWebhookEvent(input: {
  projectId: ObjectId;
  type: WebhookEventType;
  data: Record<string, unknown>;
}) {
  const db = await getDb();
  const hooks = await db
    .collection<WebhookDoc>("webhooks")
    .find({
      projectId: input.projectId,
      enabled: true,
      revokedAt: { $exists: false },
      events: input.type,
    })
    .toArray();
  if (hooks.length === 0) {
    return;
  }

  const payload: WebhookEventPayload = {
    id: `evt_${randomBytes(12).toString("hex")}`,
    type: input.type,
    createdAt: new Date().toISOString(),
    projectId: input.projectId.toString(),
    data: input.data,
  };
  const body = JSON.stringify(payload);

  await Promise.allSettled(
    hooks.map(async (hook) => {
      if (!hook.secret) {
        return;
      }
      const signature = signWebhookBody(hook.secret, body);
      try {
        const response = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Unified-Event": input.type,
            "X-Unified-Signature": `sha256=${signature}`,
            "User-Agent": "Unified-Portal-Webhooks/1.0",
          },
          body,
          signal: AbortSignal.timeout(8000),
        });
        await db.collection<WebhookDoc>("webhooks").updateOne(
          { _id: hook._id },
          {
            $set: {
              lastDeliveredAt: new Date(),
              lastStatus: response.status,
              updatedAt: new Date(),
            },
          },
        );
      } catch (error) {
        console.error("Webhook delivery failed:", hook.url, error);
        await db.collection<WebhookDoc>("webhooks").updateOne(
          { _id: hook._id },
          {
            $set: {
              lastDeliveredAt: new Date(),
              lastStatus: 0,
              updatedAt: new Date(),
            },
          },
        );
      }
    }),
  );
}

/** Fire-and-forget so request paths stay fast. */
export function emitWebhookEventBackground(input: {
  projectId: ObjectId;
  type: WebhookEventType;
  data: Record<string, unknown>;
}) {
  void emitWebhookEvent(input).catch((error) => {
    console.error("Webhook emit failed:", error);
  });
}
