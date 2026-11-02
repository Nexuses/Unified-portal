import { NextRequest, NextResponse } from "next/server";
import { parseAllProjectsStatsQuery } from "@/lib/all-projects-stats";
import { findAllProjectsStatsShareByToken } from "@/lib/all-projects-stats-share-server";
import { AnalyticsRangeError, isAnalyticsShareExpired } from "@/lib/analytics";
import { buildProjectsEngagementReport } from "@/lib/weekly-report-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const share = await findAllProjectsStatsShareByToken(token);
    if (!share) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (isAnalyticsShareExpired(share)) {
      return NextResponse.json(
        { error: "This public link expired after 30 days." },
        { status: 410 },
      );
    }

    const range = parseAllProjectsStatsQuery(request.nextUrl.searchParams);
    const report =
      range.mode === "custom"
        ? await buildProjectsEngagementReport({
            from: range.from,
            to: range.to,
          })
        : await buildProjectsEngagementReport({ days: range.days });
    return NextResponse.json(
      {
        title: share.title,
        ...report,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to load public all-projects stats:", error);
    return NextResponse.json(
      { error: "Failed to load report" },
      { status: 500 },
    );
  }
}
