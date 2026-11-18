import { getDb } from "@/lib/mongodb";
import { isTransientBoatError, stopCloudBoat } from "@/lib/boat";
import { cloudFollowupHooks, sendNextCloudRow, startCloudSending } from "@/lib/cloud-boat-runner";
import { runCloudFollowupTick } from "@/lib/cloud-followups";
import {
  getCloudCampaignDoc,
  markChromeProfileScriptState,
  patchCloudCampaignDoc,
  type CloudCampaignDoc,
} from "@/lib/cloud-campaigns-server";
import { alertCampaignStopped, type CloudStopKind } from "@/lib/cloud-alerts";
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
/**
 * A Boat blip (502/503/504, dropped connection) retries the same row this much later instead of
 * pausing the campaign; after MAX in a row it pauses so a real outage still gets noticed.
 */
const TRANSIENT_RETRY_MS = 3 * 60 * 1000;
const MAX_TRANSIENT_RETRIES = 5;

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

const SIGNED_OUT = /sign(ed)? ?out|isn't signed in|not signed in|signed in as|login_required|wrong_account/i;

/**
 * The campaign stopped on its own: remember why, mark a signed-out sender as not signed in
 * (so Resume needs a fresh sign-in + check), and raise a bell alert.
 */
async function noteStopped(doc: CloudCampaignDoc, kind: CloudStopKind, message: string) {
  const fresh = (await getCloudCampaignDoc(doc.projectId, doc.campaignId)) || doc;
  await patchCloudCampaignDoc(doc.projectId, doc.campaignId, { stopKind: kind, stoppedAt: new Date() });
  if (kind === "signed_out" && fresh.profileId) {
    await markChromeProfileScriptState(fresh.projectId, fresh.profileId, null).catch(() => undefined);
  }
  await alertCampaignStopped({
    projectId: fresh.projectId,
    campaignId: fresh.campaignId,
    name: fresh.name,
    kind,
    nextRow: fresh.nextRow || 0,
    total: fresh.sheetRowCount || 0,
    sender: fresh.profileGmail,
    message,
  }).catch((error) => console.error("[cloud-send] alert failed:", error));
}

/** Book the next send; stop the computer if the wait is long. */
async function bookNext(
  doc: CloudCampaignDoc,
  earliest: Date,
  reason: string,
  extra: Partial<CloudCampaignDoc> = {},
) {
  const schedule = scheduleOf(doc);
  const next = nextAllowedTime(earliest, schedule);
  if (!next) {
    const lastError = "Every day is excluded in the schedule — allow at least one day, then Resume.";
    await release(doc, { status: "paused", lastError });
    await noteStopped(doc, "schedule", lastError);
    return;
  }
  await release(doc, {
    ...extra,
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
      const message = error instanceof Error ? error.message : String(error);
      await release(doc, { status: "paused", lastError: `Scheduled start failed: ${message}` });
      await noteStopped(doc, SIGNED_OUT.test(message) ? "signed_out" : "error", `Scheduled start failed: ${message}`);
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
        // Stopped by a failure (not by the user pressing Stop): tell them in the bell.
        if (fresh && fresh.status === "paused" && fresh.lastError && fresh.lastError === result.report) {
          const signedOut = Boolean(result.needsLogin) || SIGNED_OUT.test(fresh.lastError);
          await noteStopped(doc, signedOut ? "signed_out" : "error", fresh.lastError);
        }
        continue;
      }
      // Human-like pacing: the gap ±20%, at least 20 s.
      const gapMs = Math.max(0, Number(doc.gapMinutes) || 0) * 60_000;
      const jitter = gapMs * (Math.random() * 0.4 - 0.2);
      const wait = Math.max(20_000, gapMs + jitter);
      await bookNext(doc, new Date(Date.now() + wait), "Waiting between emails.", {
        transientRetries: undefined,
      });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Sending stopped unexpectedly.";
      const retries = (doc.transientRetries || 0) + 1;
      if (isTransientBoatError(error) && retries <= MAX_TRANSIENT_RETRIES) {
        // Don't pause for a Boat blip: try the same row again shortly. A row that may have gone
        // out stays "in flight", so the retry checks Sent first and never sends it twice.
        const row = (doc.nextRow || 0) + 1;
        console.warn(`[cloud-send] ${doc.campaignId}: Boat blip on row ${row} (${lastError}); retry ${retries}/${MAX_TRANSIENT_RETRIES}`);
        await bookNext(
          doc,
          new Date(Date.now() + TRANSIENT_RETRY_MS),
          `The cloud computer service had a short outage on row ${row} (${lastError}). Trying again automatically (${retries} of ${MAX_TRANSIENT_RETRIES}).`,
          { transientRetries: retries },
        );
        continue;
      }
      await release(doc, { status: "paused", lastError, transientRetries: undefined });
      await noteStopped(doc, SIGNED_OUT.test(lastError) ? "signed_out" : "error", lastError);
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
