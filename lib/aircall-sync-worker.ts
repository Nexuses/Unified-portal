import { ObjectId } from "mongodb";
import {
  aircallConfigured,
  syncAircallCallsForProject,
} from "@/lib/aircall-server";
import { getDb } from "@/lib/mongodb";

export const AIRCALL_SYNC_INTERVAL_MS = 10 * 60 * 1000;

type AircallWorkerGlobal = typeof globalThis & {
  __nexusesAircallSyncWorker?: {
    started: boolean;
    running: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
};

function workerState() {
  const g = globalThis as AircallWorkerGlobal;
  if (!g.__nexusesAircallSyncWorker) {
    g.__nexusesAircallSyncWorker = { started: false, running: false };
  }
  return g.__nexusesAircallSyncWorker;
}

export function isAircallSyncWorkerEnabled() {
  const raw = process.env.AIRCALL_SYNC_WORKER_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

async function allProjectIds() {
  const db = await getDb();
  const docs = await db
    .collection<{ _id: ObjectId }>("projects")
    .find({}, { projection: { _id: 1 } })
    .toArray();
  return docs.map((doc) => doc._id);
}

/** Pull recent Aircall calls into every project CRM match set. */
export async function runAircallSyncTick() {
  const state = workerState();
  if (state.running) {
    return { skipped: true as const, reason: "already-running" as const };
  }
  if (!aircallConfigured()) {
    return { skipped: true as const, reason: "not-configured" as const };
  }

  state.running = true;
  let matchedContacts = 0;
  let fetched = 0;
  let errors = 0;
  try {
    const projectIds = await allProjectIds();
    for (const projectId of projectIds) {
      try {
        const result = await syncAircallCallsForProject(projectId, {
          perPage: 50,
        });
        fetched += result.fetched;
        matchedContacts += result.matchedContacts;
      } catch (error) {
        errors += 1;
        console.error(
          `[aircall-sync] project ${projectId.toString()} failed:`,
          error,
        );
      }
    }
    if (fetched > 0 || matchedContacts > 0 || errors > 0) {
      console.info(
        `[aircall-sync] tick projects=${projectIds.length} fetched=${fetched} matched=${matchedContacts} errors=${errors}`,
      );
    }
    return {
      skipped: false as const,
      projects: projectIds.length,
      fetched,
      matchedContacts,
      errors,
    };
  } finally {
    state.running = false;
  }
}

export function startAircallSyncWorker() {
  if (!isAircallSyncWorkerEnabled()) {
    console.info("[aircall-sync] disabled (AIRCALL_SYNC_WORKER_ENABLED=0)");
    return;
  }
  if (!aircallConfigured()) {
    console.info(
      "[aircall-sync] skipped start (AIRCALL_API_ID / AIRCALL_API_TOKEN missing)",
    );
    return;
  }

  const state = workerState();
  if (state.started) {
    return;
  }
  state.started = true;
  console.info(`[aircall-sync] starting interval=${AIRCALL_SYNC_INTERVAL_MS}ms`);

  void runAircallSyncTick();
  state.timer = setInterval(() => {
    void runAircallSyncTick();
  }, AIRCALL_SYNC_INTERVAL_MS);
  if (typeof state.timer === "object" && "unref" in state.timer) {
    state.timer.unref();
  }
}
