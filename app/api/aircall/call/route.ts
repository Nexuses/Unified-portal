import { NextRequest, NextResponse } from "next/server";
import {
  aircallConfigured,
  startAircallOutboundCall,
} from "@/lib/aircall-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    if (!aircallConfigured()) {
      return NextResponse.json(
        {
          error:
            "Aircall is not configured. Add AIRCALL_API_ID and AIRCALL_API_TOKEN.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      to?: string;
      mode?: "start" | "dial";
    } | null;
    const to = String(body?.to || "").trim();
    if (!to) {
      return NextResponse.json(
        { error: "Phone number is required." },
        { status: 400 },
      );
    }

    const result = await startAircallOutboundCall({
      to,
      mode: body?.mode === "dial" ? "dial" : "start",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Aircall call failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to start Aircall call";
    const status = /not available|405/i.test(message)
      ? 409
      : /invalid|required|Enter a valid/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
