import { getDb } from "@/lib/mongodb";
import { isBoatRunning, projectBoatStatus, stopProjectBoat } from "@/lib/boat";
import { checkCloudInbox } from "@/lib/cloud-boat-runner";
import { getBoatDesktopLock, type CloudCampaignDoc } from "@/lib/cloud-campaigns-server";

/**
 * Checks each recently sent cloud campaign's sender inbox for replies and bounces:
 * every 6 hours for 7 days after its last send. Read-only, no AI.
 */
const TICK_MS = 15 * 60 * 1000;
const RECHECK_MS = 6 * 60 * 60 * 1000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type WorkerGlobal = typeof globalThis & {
  __nexusesCloudInboxWorker?: { started: boolean; running: boolean; timer?: ReturnType<typeof setInterval> };
};

function workerState() {
  const g = globalThis as WorkerGlobal;
  if (!g.__nexusesCloudInboxWorker) g.__nexusesCloudInboxWorker = { started: false, running: false };
  return g.__nexusesCloudInboxWorker;
}

/** On in production; opt in elsewhere with CLOUD_INBOX_WORKER_ENABLED=1 (it starts computers). */
export function isCloudInboxWorkerEnabled() {
  const raw = process.env.CLOUD_INBOX_WORKER_ENABLED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return process.env.NODE_ENV === "production";
}

/** Atomically claim one due campaign so parallel servers never check the same inbox twice. */
async function claimDueCampaign() {
  const db = await getDb();
  const now = Date.now();
  return db.collection<CloudCampaignDoc>("cloud_campaigns").findOneAndUpdate(
    {
      status: { $in: ["sent", "paused", "ready"] },
      // First check 2 h after the last send (replies take time), then every 6 h for 7 days.
      lastSentAt: { $gte: new Date(now - WINDOW_MS), $lte: new Date(now - 2 * 60 * 60 * 1000) },
      $or: [{ inboxCheckedAt: { $exists: false } }, { inboxCheckedAt: { $lte: new Date(now - RECHECK_MS) } }],
    },
    { $set: { inboxCheckedAt: new Date(now) } },
    { sort: { inboxCheckedAt: 1 }, returnDocument: "after" },
  );
}

export async function runCloudInboxTick() {
  const state = workerState();
  if (state.running) return;
  state.running = true;
  try {
    for (let i = 0; i < 5; i += 1) {
      const doc = await claimDueCampaign();
      if (!doc) break;
      // Never interrupt a campaign that is sending on this project's computer.
      if (await getBoatDesktopLock(doc.projectId)) continue;
      const before = await projectBoatStatus(doc.projectId).catch(() => null);
      const wasRunning = Boolean(before?.sandbox && isBoatRunning(before.sandbox.state));
      try {
        const result = await checkCloudInbox(doc.projectId, doc.campaignId);
        if (result.newReplies || result.newBounces) {
          console.info(
            `[cloud-inbox] ${doc.campaignId}: +${result.newReplies} replies, +${result.newBounces} bounces`,
          );
        }
      } catch (error) {
        console.warn(`[cloud-inbox] ${doc.campaignId} failed:`, error instanceof Error ? error.message : error);
      } finally {
        // Leave the computer as we found it.
        if (!wasRunning && !(await getBoatDesktopLock(doc.projectId))) {
          await stopProjectBoat(doc.projectId).catch(() => undefined);
        }
      }
    }
  } finally {
    state.running = false;
  }
}

export function startCloudInboxWorker() {
  if (!isCloudInboxWorkerEnabled()) {
    console.info("[cloud-inbox] disabled (set CLOUD_INBOX_WORKER_ENABLED=1 to enable outside production)");
    return;
  }
  const state = workerState();
  if (state.started) return;
  state.started = true;
  state.timer = setInterval(() => void runCloudInboxTick(), TICK_MS);
  setTimeout(() => void runCloudInboxTick(), 60_000);
  console.info(`[cloud-inbox] starting interval=${TICK_MS}ms`);
}
