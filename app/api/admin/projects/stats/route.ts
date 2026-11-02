import { NextRequest, NextResponse } from "next/server";
import {
  isAdminSessionError,
  requireAdminSession,
} from "@/lib/require-admin-session";
import { parseAllProjectsStatsQuery } from "@/lib/all-projects-stats";
import { AnalyticsRangeError } from "@/lib/analytics";
import { buildProjectsEngagementReport } from "@/lib/weekly-report-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const range = parseAllProjectsStatsQuery(request.nextUrl.searchParams);
    const report =
      range.mode === "custom"
        ? await buildProjectsEngagementReport({
            from: range.from,
            to: range.to,
          })
        : await buildProjectsEngagementReport({ days: range.days });
    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to load all-projects stats:", error);
    return NextResponse.json(
      { error: "Failed to load project stats" },
      { status: 500 },
    );
  }
}
