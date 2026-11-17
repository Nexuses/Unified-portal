import { getDb } from "@/lib/mongodb";
import { stopCloudBoat } from "@/lib/boat";
import { cloudFollowupHooks, sendNextCloudRow, startCloudSending } from "@/lib/cloud-boat-runner";
import { runCloudFollowupTick } from "@/lib/cloud-followups";
import { patchCloudCampaignDoc, type CloudCampaignDoc } from "@/lib/cloud-campaigns-server";
import { isSendAllowed, nextAllowedTime, type CloudSchedule } from "@/lib/cloud-schedule";

/**
 * Sends cloud campaigns on the server, so they keep going with the page closed and can start
 * on a schedule. Each due campaign is claimed atomically (several servers may run this), one
 * row is sent, and the next row is booked using the gap, excluded weekdays and daily window.
 */
const TICK_MS = 20_000;
const CLAIM_MS = 6 * 60 * 1000;
/** Waits longer than this stop the computer until the next send (it resumes on its own). */
const STOP_COMPUTER_AFTER_MS = 15 * 60 * 1000;

type WorkerGlobal = typeof globalThis & {
  __nexusesCloudSendWorker?: { started: boolean; running: boolean; timer?: ReturnType<typeof setInterval> };
};

function workerState() {
  const g = globalThis as WorkerGlobal;
  if (!g.__nexusesCloudSendWorker) g.__nexusesCloudSendWorker = { started: false, running: false };
  return g.__nexusesCloudSendWorker;
}

export function isCloudSendWorkerEnabled() {
  const raw = process.env.CLOUD_SEND_WORKER_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

function scheduleOf(doc: CloudCampaignDoc): CloudSchedule {
  return {
    timezone: doc.schedule?.timezone || "UTC",
    excludedDays: doc.schedule?.excludedDays || [],
    windowStart: doc.schedule?.windowStart,
    windowEnd: doc.schedule?.windowEnd,
  };
}

async function campaigns() {
  const db = await getDb();
  return db.collection<CloudCampaignDoc>("cloud_campaigns");
}

async function claim(status: "scheduled" | "sending") {
  const now = new Date();
  const collection = await campaigns();
  return collection.findOneAndUpdate(
    {
      status,
      $and: [
        // Only campaigns started/scheduled under the server worker carry nextSendAt; ones left in
        // "sending" by the old in-browser loop are never resumed automatically.
        { nextSendAt: { $exists: true, $lte: now } },
        { $or: [{ tickClaimUntil: { $exists: false } }, { tickClaimUntil: { $lte: now } }] },
      ],
    },
    { $set: { tickClaimUntil: new Date(now.getTime() + CLAIM_MS) } },
    { sort: { nextSendAt: 1 }, returnDocument: "after" },
  );
}

async function release(doc: CloudCampaignDoc, patch: Partial<CloudCampaignDoc> = {}) {
  await patchCloudCampaignDoc(doc.projectId, doc.campaignId, { ...patch, tickClaimUntil: undefined });
}

function friendly(date: Date, timezone: string) {
  try {
    return date.toLocaleString("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }) + ` (${timezone})`;
  } catch {
    return date.toISOString();
  }
}

/** Book the next send; stop the computer if the wait is long. */
async function bookNext(doc: CloudCampaignDoc, earliest: Date, reason: string) {
  const schedule = scheduleOf(doc);
  const next = nextAllowedTime(earliest, schedule);
  if (!next) {
    await release(doc, {
      status: "paused",
      lastError: "Every day is excluded in the schedule — allow at least one day, then Resume.",
    });
    return;
  }
  await release(doc, {
    nextSendAt: next,
    ...(next.getTime() - Date.now() > 60_000
      ? { lastReport: `${reason} Next email ${friendly(next, schedule.timezone)}.` }
      : {}),
  });
  if (next.getTime() - Date.now() > STOP_COMPUTER_AFTER_MS) {
    await stopCloudBoat(doc.projectId).catch(() => undefined);
  }
}

async function startDueScheduled() {
  for (let i = 0; i < 5; i += 1) {
    const doc = await claim("scheduled");
    if (!doc) return;
    try {
      // startCloudSending checks the sender sign-in and books the first send.
      await startCloudSending(doc.projectId, doc.campaignId);
      await release(doc);
    } catch (error) {
      await release(doc, {
        status: "paused",
        lastError: `Scheduled start failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

async function sendDueRows() {
  for (let i = 0; i < 10; i += 1) {
    const doc = await claim("sending");
    if (!doc) return;
    const schedule = scheduleOf(doc);
    if (!isSendAllowed(new Date(), schedule)) {
      await bookNext(doc, new Date(), "Outside the sending days/hours.");
      continue;
    }
    try {
      const result = await sendNextCloudRow(doc.projectId, doc.campaignId);
      const fresh = result.campaign;
      if (!fresh || fresh.status !== "sending" || result.done) {
        await release(doc);
        continue;
      }
      // Human-like pacing: the gap ±20%, at least 20 s.
      const gapMs = Math.max(0, Number(doc.gapMinutes) || 0) * 60_000;
      const jitter = gapMs * (Math.random() * 0.4 - 0.2);
      const wait = Math.max(20_000, gapMs + jitter);
      await bookNext(doc, new Date(Date.now() + wait), "Waiting between emails.");
    } catch (error) {
      await release(doc, {
        status: "paused",
        lastError: error instanceof Error ? error.message : "Sending stopped unexpectedly.",
      });
    }
  }
}

export async function runCloudSendTick() {
  const state = workerState();
  if (state.running) return;
  state.running = true;
  try {
    await startDueScheduled();
    await sendDueRows();
    // Follow-ups (replies in thread) after the main sends, on the same computer.
    await runCloudFollowupTick(cloudFollowupHooks).catch((error) =>
      console.error("[cloud-send] follow-ups failed:", error),
    );
  } catch (error) {
    console.error("[cloud-send] tick failed:", error);
  } finally {
    state.running = false;
  }
}

export function startCloudSendWorker() {
  if (!isCloudSendWorkerEnabled()) {
    console.info("[cloud-send] disabled (CLOUD_SEND_WORKER_ENABLED=0)");
    return;
  }
  const state = workerState();
  if (state.started) return;
  state.started = true;
  state.timer = setInterval(() => void runCloudSendTick(), TICK_MS);
  setTimeout(() => void runCloudSendTick(), 5_000);
  console.info(`[cloud-send] starting interval=${TICK_MS}ms`);
}
