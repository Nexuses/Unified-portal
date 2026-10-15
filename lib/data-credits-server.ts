import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  DEFAULT_PROJECT_DATA_CREDITS,
  normalizeDataCredits,
  type DataCreditStatus,
} from "@/lib/projects";

type CreditUsageDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  month: string;
  used: number;
  createdAt: Date;
  updatedAt: Date;
};

const COLLECTION = "data_credit_usage";

let indexesReady: Promise<unknown> | null = null;

async function usageCollection() {
  const db = await getDb();
  const collection = db.collection<CreditUsageDoc>(COLLECTION);
  indexesReady ??= collection
    .createIndex({ projectId: 1, month: 1 }, { unique: true })
    .catch((error) => {
      indexesReady = null;
      console.error("Failed to create data credit index:", error);
    });
  await indexesReady;
  return collection;
}

export function currentCreditMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextResetDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

async function projectCreditLimit(projectId: ObjectId) {
  const db = await getDb();
  const project = await db
    .collection<{ _id: ObjectId; dataCredits?: number }>("projects")
    .findOne({ _id: projectId }, { projection: { dataCredits: 1 } });
  return normalizeDataCredits(project?.dataCredits ?? DEFAULT_PROJECT_DATA_CREDITS);
}

function toStatus(limit: number, used: number, now: Date): DataCreditStatus {
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    month: currentCreditMonth(now),
    resetsAt: nextResetDate(now).toISOString(),
  };
}

export async function getDataCreditStatus(projectId: string): Promise<DataCreditStatus> {
  const now = new Date();
  const id = new ObjectId(projectId);
  const [limit, collection] = await Promise.all([projectCreditLimit(id), usageCollection()]);
  const usage = await collection.findOne({ projectId: id, month: currentCreditMonth(now) });
  return toStatus(limit, usage?.used ?? 0, now);
}

/** Credits used this month for many projects at once (admin listing). */
export async function getDataCreditsUsedByProject(projectIds: ObjectId[]) {
  if (projectIds.length === 0) return new Map<string, number>();
  const collection = await usageCollection();
  const rows = await collection
    .find({ projectId: { $in: projectIds }, month: currentCreditMonth() })
    .project<{ projectId: ObjectId; used: number }>({ projectId: 1, used: 1 })
    .toArray();
  return new Map(rows.map((row) => [row.projectId.toString(), row.used]));
}

export type ConsumeCreditsResult =
  | { ok: true; status: DataCreditStatus }
  | { ok: false; status: DataCreditStatus };

/**
 * Atomically reserves `amount` credits for this month. Fails without
 * changing anything when the project does not have enough left.
 */
export async function consumeDataCredits(
  projectId: string,
  amount: number,
): Promise<ConsumeCreditsResult> {
  const now = new Date();
  const month = currentCreditMonth(now);
  const id = new ObjectId(projectId);
  const count = Math.max(0, Math.floor(amount));
  const [limit, collection] = await Promise.all([projectCreditLimit(id), usageCollection()]);

  if (count === 0) {
    return { ok: true, status: await getDataCreditStatus(projectId) };
  }
  if (count > limit) {
    return { ok: false, status: await getDataCreditStatus(projectId) };
  }

  await collection.updateOne(
    { projectId: id, month },
    { $setOnInsert: { used: 0, createdAt: now, updatedAt: now } },
    { upsert: true },
  );
  const updated = await collection.findOneAndUpdate(
    { projectId: id, month, used: { $lte: limit - count } },
    { $inc: { used: count }, $set: { updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) {
    return { ok: false, status: await getDataCreditStatus(projectId) };
  }
  return { ok: true, status: toStatus(limit, updated.used, now) };
}

type ReservationDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  month: string;
  amount: number;
  status: "reserved" | "refunded";
  createdAt: Date;
};

const RESERVATIONS = "data_credit_reservations";
const REFUND_WINDOW_MS = 30 * 60 * 1000;

/** Reserves credits for one save and records it so a failed save can be refunded. */
export async function reserveDataCredits(projectId: string, amount: number) {
  const result = await consumeDataCredits(projectId, amount);
  if (!result.ok) return { ...result, reservationId: null };
  const db = await getDb();
  const reservation = await db.collection<Omit<ReservationDoc, "_id">>(RESERVATIONS).insertOne({
    projectId: new ObjectId(projectId),
    month: result.status.month,
    amount: Math.floor(amount),
    status: "reserved",
    createdAt: new Date(),
  });
  return { ...result, reservationId: reservation.insertedId.toString() };
}

/** Gives back a recent reservation whose save did not go through. */
export async function refundDataCreditReservation(projectId: string, reservationId: string) {
  if (!ObjectId.isValid(reservationId)) return getDataCreditStatus(projectId);
  const db = await getDb();
  const reservation = await db.collection<ReservationDoc>(RESERVATIONS).findOneAndUpdate(
    {
      _id: new ObjectId(reservationId),
      projectId: new ObjectId(projectId),
      status: "reserved",
      createdAt: { $gte: new Date(Date.now() - REFUND_WINDOW_MS) },
    },
    { $set: { status: "refunded" } },
    { returnDocument: "after" },
  );
  if (reservation) {
    const collection = await usageCollection();
    await collection.updateOne(
      {
        projectId: reservation.projectId,
        month: reservation.month,
        used: { $gte: reservation.amount },
      },
      { $inc: { used: -reservation.amount }, $set: { updatedAt: new Date() } },
    );
  }
  return getDataCreditStatus(projectId);
}
