import { NextResponse } from "next/server";
import { AnalyticsRangeError, isAnalyticsShareExpired } from "@/lib/analytics";
import {
  findAnalyticsShareByToken,
  getAnalyticsDashboard,
} from "@/lib/analytics-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const share = await findAnalyticsShareByToken(token);
    if (!share) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (isAnalyticsShareExpired(share)) {
      return NextResponse.json(
        { error: "This public link expired after 30 days." },
        { status: 410 },
      );
    }

    const dashboard = await getAnalyticsDashboard(
      share.projectId,
      share.from,
      share.to,
      share.projectName,
      { withShareTokens: true },
    );
    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to load public analytics report:", error);
    return NextResponse.json(
      { error: "Failed to load report" },
      { status: 500 },
    );
  }
}
