import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/campaign-send-worker";
import { runWeeklyReport, weeklyReportConfig } from "@/lib/weekly-report-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * All-projects weekly performance email (sent / opens / clicks / replies).
 * Auth: Authorization: Bearer <CRON_SECRET>  or  x-cron-secret: <CRON_SECRET>
 *
 * Sends only inside Friday 4:25–4:40 PM in WEEKLY_REPORT_TIMEZONE (default Asia/Kolkata),
 * and at most once per weekKey unless force=1.
 *
 * Vultr crontab (Friday 4:30 PM IST = 11:00 UTC):
 *   0 11 * * 5 curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://unified.nexuses.xyz/api/cron/weekly-report >/dev/null
 *
 * Or if the server clock is already IST:
 *   30 16 * * 5 ...
 *
 * Test: POST /api/cron/weekly-report?force=1
 * Preview HTML only: POST /api/cron/weekly-report?force=1&dryRun=1
 */
export async function POST(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const config = weeklyReportConfig();
    if (!force && !config.to) {
      return NextResponse.json(
        { error: "WEEKLY_REPORT_TO is not configured" },
        { status: 503 },
      );
    }

    const result = await runWeeklyReport({ force, dryRun });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Cron weekly-report failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send weekly report",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
