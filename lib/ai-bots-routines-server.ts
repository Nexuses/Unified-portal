import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { botCollections, refreshRunning, sendToBot } from "@/lib/ai-bots-server";
import type { BotRoutine } from "@/lib/ai-bots";

/**
 * Routines: a bot gets a task on a schedule ("every weekday at 9:00, find new Series A fintechs").
 * The worker posts the task into the bot's chat as if someone sent it.
 */

type RoutineDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  botId: ObjectId;
  title: string;
  prompt: string;
  kind: "daily" | "hours";
  time: string;
  everyHours: number;
  timezone: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
  claimUntil?: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

let indexed = false;

async function routines() {
  const db = await getDb();
  const collection = db.collection<RoutineDoc>("ai_bot_routines");
  if (!indexed) {
    await collection.createIndex({ enabled: 1, nextRunAt: 1 });
    await collection.createIndex({ projectId: 1 });
    indexed = true;
  }
  return collection;
}

function toRoutine(doc: RoutineDoc): BotRoutine {
  return {
    id: doc._id.toHexString(),
    botId: doc.botId.toHexString(),
    title: doc.title,
    prompt: doc.prompt,
    kind: doc.kind,
    time: doc.time,
    everyHours: doc.everyHours,
    timezone: doc.timezone,
    enabled: doc.enabled,
    nextRunAt: doc.nextRunAt?.toISOString() ?? null,
    lastRunAt: doc.lastRunAt?.toISOString() ?? null,
    lastError: doc.lastError,
  };
}

function validZone(zone: unknown) {
  try {
    const value = String(zone || "UTC");
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** Minutes the zone is ahead of UTC at this instant. */
function zoneOffsetMinutes(zone: string, at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

export function nextRun(doc: Pick<RoutineDoc, "kind" | "time" | "everyHours" | "timezone">, after = new Date()) {
  if (doc.kind === "hours") {
    return new Date(after.getTime() + Math.max(1, doc.everyHours) * 3600_000);
  }
  const [hour, minute] = doc.time.split(":").map((part) => Number(part) || 0);
  for (let day = 0; day <= 2; day += 1) {
    // The zone's calendar date, `day` days from now, at hour:minute local time.
    const probe = new Date(after.getTime() + day * 86400_000);
    const offset = zoneOffsetMinutes(doc.timezone, probe);
    const local = new Date(probe.getTime() + offset * 60000);
    const candidate = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offset * 60000,
    );
    if (candidate > after) return candidate;
  }
  return new Date(after.getTime() + 86400_000);
}

function readInput(input: Record<string, unknown>, current?: RoutineDoc) {
  const kind = input.kind === "hours" ? "hours" : input.kind === "daily" ? "daily" : current?.kind ?? "daily";
  const time = /^\d{1,2}:\d{2}$/.test(String(input.time ?? "")) ? String(input.time) : current?.time ?? "09:00";
  const everyHours = Math.min(168, Math.max(1, Math.round(Number(input.everyHours ?? current?.everyHours ?? 24)) || 24));
  return {
    title: String(input.title ?? current?.title ?? "").trim().slice(0, 80) || "Routine",
    prompt: String(input.prompt ?? current?.prompt ?? "").trim().slice(0, 6000),
    kind,
    time,
    everyHours,
    timezone: input.timezone === undefined && current ? current.timezone : validZone(input.timezone),
    enabled: input.enabled === undefined ? current?.enabled ?? true : input.enabled === true,
  } as const;
}

export async function listRoutines(projectId: ObjectId) {
  const collection = await routines();
  return (await collection.find({ projectId }).sort({ createdAt: 1 }).toArray()).map(toRoutine);
}

export async function createRoutine(projectId: ObjectId, userId: string, input: Record<string, unknown>) {
  const { bots } = await botCollections();
  const botId = ObjectId.isValid(String(input.botId)) ? new ObjectId(String(input.botId)) : null;
  if (!botId || !(await bots.findOne({ _id: botId, projectId, deletedAt: null }))) throw new Error("Pick a bot");
  const values = readInput(input);
  if (!values.prompt) throw new Error("Write what the bot should do");
  const collection = await routines();
  if ((await collection.countDocuments({ projectId })) >= 30) throw new Error("A project can have up to 30 routines.");
  const now = new Date();
  const doc: RoutineDoc = {
    _id: new ObjectId(),
    projectId,
    botId,
    ...values,
    nextRunAt: values.enabled ? nextRun(values) : null,
    lastRunAt: null,
    lastError: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  await collection.insertOne(doc);
  return toRoutine(doc);
}

export async function updateRoutine(
  projectId: ObjectId,
  projectName: string,
  routineId: string,
  input: Record<string, unknown>,
) {
  const collection = await routines();
  if (!ObjectId.isValid(routineId)) throw new Error("Routine not found");
  const current = await collection.findOne({ _id: new ObjectId(routineId), projectId });
  if (!current) throw new Error("Routine not found");
  if (input.runNow === true) {
    await runRoutine(current, projectName);
    return toRoutine((await collection.findOne({ _id: current._id }))!);
  }
  const values = readInput(input, current);
  const scheduleChanged =
    values.kind !== current.kind || values.time !== current.time || values.everyHours !== current.everyHours ||
    values.timezone !== current.timezone || values.enabled !== current.enabled;
  const nextRunAt = !values.enabled ? null : scheduleChanged || !current.nextRunAt ? nextRun(values) : current.nextRunAt;
  await collection.updateOne({ _id: current._id }, { $set: { ...values, nextRunAt, updatedAt: new Date() } });
  return toRoutine({ ...current, ...values, nextRunAt });
}

export async function deleteRoutine(projectId: ObjectId, routineId: string) {
  const collection = await routines();
  if (!ObjectId.isValid(routineId)) throw new Error("Routine not found");
  await collection.deleteOne({ _id: new ObjectId(routineId), projectId });
}

async function projectName(projectId: ObjectId) {
  const db = await getDb();
  const project = await db.collection<{ _id: ObjectId; name?: string }>("projects").findOne({ _id: projectId });
  return project?.name || "your project";
}

async function runRoutine(doc: RoutineDoc, name: string) {
  const collection = await routines();
  try {
    await sendToBot(doc.projectId, name, doc.botId.toHexString(), doc.prompt, {
      name: doc.title,
      source: "routine",
    });
    await collection.updateOne({ _id: doc._id }, { $set: { lastRunAt: new Date(), lastError: null } });
  } catch (error) {
    await collection.updateOne(
      { _id: doc._id },
      { $set: { lastRunAt: new Date(), lastError: error instanceof Error ? error.message : "Could not run" } },
    );
  }
}

/** One worker pass: start due routines, then bring running computer replies up to date. */
export async function tickBotWorker() {
  const collection = await routines();
  const now = new Date();
  for (let i = 0; i < 10; i += 1) {
    const due = await collection.findOneAndUpdate(
      {
        enabled: true,
        nextRunAt: { $lte: now },
        $or: [{ claimUntil: null }, { claimUntil: { $exists: false } }, { claimUntil: { $lt: now } }],
      },
      { $set: { claimUntil: new Date(now.getTime() + 5 * 60_000) } },
      { returnDocument: "after" },
    );
    if (!due) break;
    await runRoutine(due, await projectName(due.projectId));
    await collection.updateOne({ _id: due._id }, { $set: { nextRunAt: nextRun(due, new Date()), claimUntil: null } });
  }

  const { messages } = await botCollections();
  const projects = await messages.distinct("projectId", { status: "running", promptId: { $exists: true } });
  for (const projectId of projects.slice(0, 20)) {
    await refreshRunning(projectId as ObjectId).catch(() => undefined);
  }
}

const WORKER_KEY = "__aiBotsWorker";

export function startBotWorker() {
  if (process.env.AI_BOTS_WORKER_ENABLED === "0") return;
  const holder = globalThis as unknown as Record<string, ReturnType<typeof setInterval> | undefined>;
  if (holder[WORKER_KEY]) return;
  let busy = false;
  holder[WORKER_KEY] = setInterval(() => {
    if (busy) return;
    busy = true;
    tickBotWorker()
      .catch((error) => console.warn("[bots] worker tick failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        busy = false;
      });
  }, 30_000);
}
