import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { AnalyticsRangeError, defaultAnalyticsRange } from "@/lib/analytics";
import { getAnalyticsDashboard } from "@/lib/analytics-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const defaults = defaultAnalyticsRange();
    const from = request.nextUrl.searchParams.get("from")?.trim() || defaults.from;
    const to = request.nextUrl.searchParams.get("to")?.trim() || defaults.to;
    const dashboard = await getAnalyticsDashboard(
      new ObjectId(session.projectId),
      from,
      to,
      session.projectName,
    );
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
