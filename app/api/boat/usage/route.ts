import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  boatConfigured,
  getBoatActivityMeta,
  getBoatAiUsage,
  getBoatMachineUsage,
  getBoatSandbox,
  getSavedBoatSandboxId,
  isBoatRunning,
  maybeStopIdleProjectBoat,
} from "@/lib/boat";
import {
  estimateClaudeCostUsd,
  type BoatUsageSummary,
} from "@/lib/boat-usage";
import { getBoatDesktopLock } from "@/lib/cloud-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    if (!boatConfigured()) {
      return NextResponse.json(
        { error: "Boat is not set up. Add BOAT_API_KEY to the server." },
        { status: 503 },
      );
    }

    const daysRaw = Number(request.nextUrl.searchParams.get("days") || 30);
    const days = Math.max(1, Math.min(365, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));
    const projectId = new ObjectId(session.projectId);
    const sandboxId = await getSavedBoatSandboxId(projectId);
    if (!sandboxId) {
      return NextResponse.json({
        usage: null,
        machineState: "none",
        machineRunning: false,
        message: "No computer linked yet. Start the computer once to begin tracking.",
      });
    }

    const lock = await getBoatDesktopLock(projectId);
    let idleStopped = false;
    if (!lock) {
      const idle = await maybeStopIdleProjectBoat(projectId).catch(() => null);
      idleStopped = idle?.stopped === true;
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    const [ai, machine, sandbox, activity] = await Promise.all([
      getBoatAiUsage(sandboxId, days),
      getBoatMachineUsage(sandboxId, sinceIso).catch(() => null),
      getBoatSandbox(sandboxId).catch(() => null),
      getBoatActivityMeta(projectId),
    ]);

    const claudeEstimatedUsd = estimateClaudeCostUsd(ai.usage);
    const boatMachineUsd = machine?.dollars ?? 0;
    const models = [
      ...new Set(
        ai.usage
          .map((row) => row.model || row.credential)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];

    const state = sandbox?.state || (idleStopped ? "archiving" : "unknown");
    const machineRunning = sandbox ? isBoatRunning(sandbox.state) : machine?.running === true;

    const usage: BoatUsageSummary = {
      sandboxId,
      days,
      since: ai.since || sinceIso.slice(0, 10),
      requests: ai.totals.requests,
      errors: ai.totals.errors,
      inputTokens: ai.totals.inputTokens,
      outputTokens: ai.totals.outputTokens,
      cacheReadTokens: ai.totals.cacheReadTokens,
      cacheWriteTokens: ai.totals.cacheWriteTokens,
      claudeEstimatedUsd,
      boatProxyUsd: ai.proxyDollars,
      boatMachineUsd,
      totalEstimatedUsd: claudeEstimatedUsd + ai.proxyDollars + boatMachineUsd,
      models,
      proxied: ai.proxied,
      blocked: ai.blocked,
      machineRunning,
      machineState: state,
      lastBoatActivityAt: activity.lastBoatActivityAt,
      lockedByCampaign: Boolean(lock),
    };

    return NextResponse.json({
      usage,
      machineState: state,
      machineRunning,
      idleStopped,
      message: machineRunning
        ? "Computer is running — machine time is billing."
        : "Computer is stopped — machine billing pauses. Start the computer to resume the same disk.",
    });
  } catch (error) {
    console.error("Boat usage failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Boat usage" },
      { status: 500 },
    );
  }
}
