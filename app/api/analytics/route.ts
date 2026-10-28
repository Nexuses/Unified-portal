import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { AnalyticsRangeError, defaultAnalyticsRange } from "@/lib/analytics";
import { getAnalyticsDashboard } from "@/lib/analytics-server";
import { resetMongoClient } from "@/lib/mongodb";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

function isMongoPoolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = error instanceof Error ? error.name : "";
  return (
    name.includes("PoolCleared") ||
    name.includes("MongoNetwork") ||
    message.includes("PoolClearedOnNetworkError") ||
    message.includes("server monitor timeout") ||
    message.includes("timed out")
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const defaults = defaultAnalyticsRange();
    const from = request.nextUrl.searchParams.get("from")?.trim() || defaults.from;
    const to = request.nextUrl.searchParams.get("to")?.trim() || defaults.to;
    const projectId = new ObjectId(session.projectId);

    let dashboard;
    try {
      dashboard = await getAnalyticsDashboard(
        projectId,
        from,
        to,
        session.projectName,
      );
    } catch (error) {
      if (!isMongoPoolError(error)) {
        throw error;
      }
      // Stale Atlas pool after monitor timeout — reconnect once and retry.
      await resetMongoClient();
      dashboard = await getAnalyticsDashboard(
        projectId,
        from,
        to,
        session.projectName,
      );
    }
    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to load analytics:", error);
    return NextResponse.json(
      { error: "Failed to load analytics" },
      { status: 500 },
    );
  }
}
