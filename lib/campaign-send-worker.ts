import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  processDueCampaignBlasts,
  type CampaignBlastDoc,
} from "@/lib/campaign-blasts-server";
import {
  processDueAutomationFollowUps,
  type AutomationDoc,
} from "@/lib/automations-server";

const DEFAULT_INTERVAL_MS = 15_000;

type WorkerGlobal = typeof globalThis & {
  __nexusesCampaignSendWorker?: {
    started: boolean;
    timer?: ReturnType<typeof setInterval>;
    running: boolean;
  };
};

function workerState() {
  const g = globalThis as WorkerGlobal;
  if (!g.__nexusesCampaignSendWorker) {
    g.__nexusesCampaignSendWorker = { started: false, running: false };
  }
  return g.__nexusesCampaignSendWorker;
}

/** Public site origin for tracking / launch helpers when no HTTP request exists. */
export function resolveAppOrigin() {
  const fromEnv =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SERVER_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return "https://unified.nexuses.xyz";
}

export function isCampaignWorkerEnabled() {
  const raw = process.env.CAMPAIGN_WORKER_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") {
    return false;
  }
  // Default on — Vultr / production should keep sending with the portal closed.
  return true;
}

export function campaignWorkerBatchesPerTick() {
  const parsed = Number(process.env.CAMPAIGN_WORKER_BATCHES_PER_TICK);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(Math.floor(parsed), 20);
  }
  // Drain faster in the background than the UI poll (Resend-safe).
  return 5;
}

export function campaignWorkerIntervalMs() {
  const parsed = Number(process.env.CAMPAIGN_WORKER_INTERVAL_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return Math.min(Math.floor(parsed), 120_000);
  }
  return DEFAULT_INTERVAL_MS;
}

async function projectIdsWithDueWork(now = new Date()) {
  const db = await getDb();
  const [blastIds, automationIds] = await Promise.all([
    db.collection<CampaignBlastDoc>("campaign_blasts").distinct("projectId", {
      $or: [
        { status: "sending" },
        { status: "scheduled", scheduledFor: { $lte: now } },
      ],
    }),
    db.collection<AutomationDoc>("automations").distinct("projectId", {
      status: { $in: ["running", "scheduled"] },
    }),
  ]);

  const unique = new Map<string, ObjectId>();
  for (const id of [...blastIds, ...automationIds]) {
    if (id instanceof ObjectId) {
      unique.set(id.toString(), id);
    } else if (typeof id === "string" && ObjectId.isValid(id)) {
      unique.set(id, new ObjectId(id));
    }
  }
  return [...unique.values()];
}

export type CampaignSendTickResult = {
  projects: number;
  reports: number;
  followUps: number;
  errors: Array<{ projectId: string; error: string }>;
};

/**
 * Drain due drip + 1-1 blast batches (and automation follow-ups) for every
 * project that still has work — independent of any browser session.
 */
export async function processAllDueCampaignSends(
  origin = resolveAppOrigin(),
): Promise<CampaignSendTickResult> {
  const projectIds = await projectIdsWithDueWork();
  const result: CampaignSendTickResult = {
    projects: projectIds.length,
    reports: 0,
    followUps: 0,
    errors: [],
  };

  for (const projectId of projectIds) {
    try {
      const reports = await processDueCampaignBlasts(projectId, origin, {
        maxBatchesPerBlast: campaignWorkerBatchesPerTick(),
      });
      const followUps = await processDueAutomationFollowUps(projectId, origin);
      result.reports += reports.length;
      result.followUps += Number(followUps?.launched || 0);
    } catch (error) {
      result.errors.push({
        projectId: projectId.toString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.error(
        `[campaign-worker] project ${projectId.toString()} failed:`,
        error,
      );
    }
  }

  return result;
}

export async function runCampaignSendTick() {
  const state = workerState();
  if (state.running) {
    return { skipped: true as const, reason: "already-running" as const };
  }
  state.running = true;
  try {
    const result = await processAllDueCampaignSends();
    if (result.projects > 0 || result.errors.length > 0) {
      console.info(
        `[campaign-worker] tick projects=${result.projects} reports=${result.reports} followUps=${result.followUps} errors=${result.errors.length}`,
      );
    }
    return { skipped: false as const, result };
  } finally {
    state.running = false;
  }
}

/** In-process loop for Vultr `next start` — keeps sending with the portal closed. */
export function startCampaignSendWorker() {
  if (!isCampaignWorkerEnabled()) {
    console.info("[campaign-worker] disabled (CAMPAIGN_WORKER_ENABLED=0)");
    return;
  }

  const state = workerState();
  if (state.started) {
    return;
  }
  state.started = true;

  const intervalMs = campaignWorkerIntervalMs();
  console.info(
    `[campaign-worker] starting interval=${intervalMs}ms origin=${resolveAppOrigin()}`,
  );

  void runCampaignSendTick();
  state.timer = setInterval(() => {
    void runCampaignSendTick();
  }, intervalMs);

  // Do not keep the Node process alive solely for this timer during tests/shutdown.
  if (typeof state.timer === "object" && "unref" in state.timer) {
    state.timer.unref();
  }
}

export function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false as const,
      status: 503,
      error: "CRON_SECRET is not configured on the server",
    };
  }

  const header =
    request.headers.get("authorization") ||
    request.headers.get("x-cron-secret") ||
    "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const provided = bearer || header.trim();

  if (!provided || provided !== secret) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  return { ok: true as const };
}
