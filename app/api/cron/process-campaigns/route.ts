import { NextRequest, NextResponse } from "next/server";
import {
  authorizeCronRequest,
  resolveAppOrigin,
  runCampaignSendTick,
} from "@/lib/campaign-send-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vultr Node has no hard serverless cap; keep headroom for large queues. */
export const maxDuration = 300;

/**
 * Background drain for drip + 1-1 campaigns (and automation follow-ups).
 * Auth: Authorization: Bearer <CRON_SECRET>  or  x-cron-secret: <CRON_SECRET>
 *
 * Vultr crontab example (every minute as backup to the in-process worker):
 *   * * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://unified.nexuses.xyz/api/cron/process-campaigns >/dev/null
 */
export async function POST(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const origin = resolveAppOrigin();
    const tick = await runCampaignSendTick();
    if (tick.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: tick.reason,
        origin,
      });
    }
    return NextResponse.json({
      ok: true,
      skipped: false,
      origin,
      ...tick.result,
    });
  } catch (error) {
    console.error("Cron process-campaigns failed:", error);
    return NextResponse.json(
      { error: "Failed to process campaign sends" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
