import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/campaign-send-worker";
import { runPlatformStatusCheck } from "@/lib/platform-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Backup trigger: Authorization: Bearer <CRON_SECRET> */
export async function POST(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await runPlatformStatusCheck();
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
