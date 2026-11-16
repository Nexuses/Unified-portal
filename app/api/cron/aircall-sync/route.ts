import { NextRequest, NextResponse } from "next/server";
import { runAircallSyncTick } from "@/lib/aircall-sync-worker";
import { authorizeCronRequest } from "@/lib/campaign-send-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background Aircall → CRM sync for all projects.
 * Auth: Authorization: Bearer <CRON_SECRET>  or  x-cron-secret: <CRON_SECRET>
 *
 * Vultr crontab example (every 10 minutes; in-process worker also runs this):
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://unified.nexuses.xyz/api/cron/aircall-sync
 *   (schedule with cron every 10 minutes)
 */
export async function POST(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const tick = await runAircallSyncTick();
    return NextResponse.json({ ok: true, ...tick });
  } catch (error) {
    console.error("Cron aircall-sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync Aircall calls" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
