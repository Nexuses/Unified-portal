import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { syncProjectGmailInbox } from "@/lib/master-inbox-server";

export const INBOX_SYNC_INTERVAL_MS = 10 * 60 * 1000;

type InboxWorkerGlobal = typeof globalThis & {
  __nexusesInboxSyncWorker?: {
    started: boolean;
    running: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
};

function workerState() {
  const g = globalThis as InboxWorkerGlobal;
  if (!g.__nexusesInboxSyncWorker) {
    g.__nexusesInboxSyncWorker = { started: false, running: false };
  }
  return g.__nexusesInboxSyncWorker;
}

export function isInboxSyncWorkerEnabled() {
  const raw = process.env.INBOX_SYNC_WORKER_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

async function projectIdsWithGmailInbox() {
  const db = await getDb();
  const ids = await db.collection("smtp_senders").distinct("projectId", {
    provider: "gmail",
    noInbox: { $ne: true },
  });
  const unique = new Map<string, ObjectId>();
  for (const id of ids) {
    if (id instanceof ObjectId) {
      unique.set(id.toString(), id);
    } else if (typeof id === "string" && ObjectId.isValid(id)) {
      unique.set(id, new ObjectId(id));
    }
  }
  return [...unique.values()];
}

/** Pull campaign replies into the Master Inbox for every project with a Gmail sender. */
export async function runInboxSyncTick() {
  const state = workerState();
  if (state.running) {
    return { skipped: true as const };
  }
  state.running = true;
  let imported = 0;
  let errors = 0;
  try {
    const projectIds = await projectIdsWithGmailInbox();
    for (const projectId of projectIds) {
      try {
        const result = await syncProjectGmailInbox(projectId, { sinceDays: 3 });
        imported += result.imported;
        errors += result.errors.length;
      } catch (error) {
        errors += 1;
        console.error(`[inbox-sync] project ${projectId.toString()} failed:`, error);
      }
    }
    if (imported > 0 || errors > 0) {
      console.info(
        `[inbox-sync] tick projects=${projectIds.length} imported=${imported} errors=${errors}`,
      );
    }
    return { skipped: false as const, projects: projectIds.length, imported, errors };
  } finally {
    state.running = false;
  }
}

export function startInboxSyncWorker() {
  if (!isInboxSyncWorkerEnabled()) {
    console.info("[inbox-sync] disabled (INBOX_SYNC_WORKER_ENABLED=0)");
    return;
  }
  const state = workerState();
  if (state.started) {
    return;
  }
  state.started = true;
  console.info(`[inbox-sync] starting interval=${INBOX_SYNC_INTERVAL_MS}ms`);

  void runInboxSyncTick();
  state.timer = setInterval(() => {
    void runInboxSyncTick();
  }, INBOX_SYNC_INTERVAL_MS);
  if (typeof state.timer === "object" && "unref" in state.timer) {
    state.timer.unref();
  }
}
