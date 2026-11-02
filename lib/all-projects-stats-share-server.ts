import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import {
  ANALYTICS_SHARE_TTL_DAYS,
  analyticsShareExpiresAt,
  isAnalyticsShareExpired,
  resolveAnalyticsShareExpiry,
} from "@/lib/analytics";
import { getDb } from "@/lib/mongodb";

export { ANALYTICS_SHARE_TTL_DAYS as ALL_PROJECTS_STATS_SHARE_TTL_DAYS };

export type AllProjectsStatsShareDoc = {
  _id: ObjectId;
  token: string;
  title: string;
  createdBy: ObjectId | null;
  createdAt: Date;
  expiresAt: Date;
};

export async function createAllProjectsStatsShare(
  userId: ObjectId | null,
  title = "All projects performance",
) {
  const db = await getDb();
  const shares = db.collection<AllProjectsStatsShareDoc>(
    "all_projects_stats_shares",
  );

  const existing = await shares.findOne(
    { expiresAt: { $gt: new Date() } },
    { sort: { createdAt: -1 } },
  );
  if (existing && !isAnalyticsShareExpired(existing)) {
    return existing;
  }

  const createdAt = new Date();
  const doc: AllProjectsStatsShareDoc = {
    _id: new ObjectId(),
    token: randomBytes(18).toString("base64url"),
    title,
    createdBy: userId,
    createdAt,
    expiresAt: analyticsShareExpiresAt(createdAt),
  };
  await shares.insertOne(doc);
  return doc;
}

export async function findAllProjectsStatsShareByToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const db = await getDb();
  return db
    .collection<AllProjectsStatsShareDoc>("all_projects_stats_shares")
    .findOne({ token: trimmed });
}

export async function getValidAllProjectsStatsShare(token: string) {
  const share = await findAllProjectsStatsShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return null;
  }
  return share;
}

export function allProjectsStatsShareExpiresAt(share: AllProjectsStatsShareDoc) {
  return resolveAnalyticsShareExpiry(share);
}
