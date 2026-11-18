import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

/**
 * Live, per-project alerts for the topbar bell (a campaign stopped, a sender signed out, …).
 * One alert per `key`: raising it again updates it (and shows it as unread again); resolving it
 * removes it from the bell once the problem is fixed.
 */
export type PortalAlertDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  key: string;
  severity: "error" | "warning";
  title: string;
  body: string;
  href?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
};

export type PortalAlert = {
  id: string;
  severity: "error" | "warning";
  title: string;
  body: string;
  href?: string;
  createdAt: string;
  updatedAt: string;
};

let indexed = false;
async function alerts() {
  const db = await getDb();
  const collection = db.collection<PortalAlertDoc>("portal_alerts");
  if (!indexed) {
    indexed = true;
    await Promise.all([
      collection.createIndex({ projectId: 1, key: 1 }, { unique: true }),
      collection.createIndex({ projectId: 1, resolvedAt: 1, updatedAt: -1 }),
    ]).catch(() => undefined);
  }
  return collection;
}

export async function raiseProjectAlert(input: {
  projectId: ObjectId;
  key: string;
  severity?: "error" | "warning";
  title: string;
  body: string;
  href?: string;
}) {
  const collection = await alerts();
  const now = new Date();
  await collection.updateOne(
    { projectId: input.projectId, key: input.key },
    {
      $set: {
        severity: input.severity || "error",
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 600),
        href: input.href,
        updatedAt: now,
      },
      $unset: { resolvedAt: "" },
      $setOnInsert: { _id: new ObjectId(), projectId: input.projectId, key: input.key, createdAt: now },
    },
    { upsert: true },
  );
}

export async function resolveProjectAlert(projectId: ObjectId, key: string) {
  const collection = await alerts();
  await collection.updateOne(
    { projectId, key, resolvedAt: { $exists: false } },
    { $set: { resolvedAt: new Date() } },
  );
}

/** Resolve every alert whose key starts with `prefix` (e.g. all alerts of one campaign). */
export async function resolveProjectAlerts(projectId: ObjectId, prefix: string) {
  const collection = await alerts();
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await collection.updateMany(
    { projectId, key: { $regex: `^${escaped}` }, resolvedAt: { $exists: false } },
    { $set: { resolvedAt: new Date() } },
  );
}

export async function listProjectAlerts(projectId: ObjectId): Promise<PortalAlert[]> {
  const collection = await alerts();
  const docs = await collection
    .find({ projectId, resolvedAt: { $exists: false } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    severity: doc.severity,
    title: doc.title,
    body: doc.body,
    href: doc.href,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }));
}
