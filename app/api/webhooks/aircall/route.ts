import { NextRequest, NextResponse } from "next/server";
import { ingestAircallWebhookCall } from "@/lib/aircall-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Aircall webhook receiver.
 * Subscribe to: call.ended, call.comm_assets_generated
 * URL: https://<host>/api/webhooks/aircall
 *
 * Optional: set AIRCALL_WEBHOOK_TOKEN and match payload.token
 */
export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => null)) as {
      event?: string;
      resource?: string;
      token?: string;
      data?: Record<string, unknown>;
    } | null;

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const expected = (process.env.AIRCALL_WEBHOOK_TOKEN || "").trim();
    if (expected && String(payload.token || "") !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const event = String(payload.event || "");
    if (
      event !== "call.ended" &&
      event !== "call.comm_assets_generated" &&
      event !== "call.answered"
    ) {
      return NextResponse.json({ ok: true, ignored: event || "unknown" });
    }

    const data = payload.data;
    if (!data || typeof data !== "object") {
      return NextResponse.json({ ok: true, ignored: "no_data" });
    }

    const result = await ingestAircallWebhookCall(data);
    return NextResponse.json({
      ok: true,
      event,
      matched: result.matched,
    });
  } catch (error) {
    console.error("Aircall webhook failed:", error);
    // Still 200 so Aircall does not retry forever on app bugs — log and inspect.
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Webhook handler failed",
      },
      { status: 200 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "aircall-webhook",
    hint: "POST call.ended / call.comm_assets_generated events here",
  });
}
