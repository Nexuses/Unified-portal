import { NextRequest, NextResponse } from "next/server";
import { collectEnrichOptions } from "@/lib/datatool";
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

    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const options = await collectEnrichOptions({
      q: q || undefined,
      maxPages: q ? 3 : 5,
    });

    return NextResponse.json(options);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load Data Tool options";
    const status = /DATATOOL_API_KEY|not set/i.test(message) ? 503 : 500;
    console.error("CRM enrich options failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
