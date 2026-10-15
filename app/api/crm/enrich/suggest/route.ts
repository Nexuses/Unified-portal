import { NextRequest, NextResponse } from "next/server";
import { isSuggestField, suggestEnrichValues } from "@/lib/datatool-server";
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
    const field = request.nextUrl.searchParams.get("field") ?? "";
    const q = request.nextUrl.searchParams.get("q") ?? "";
    if (!isSuggestField(field)) {
      return NextResponse.json({ error: "Unknown field" }, { status: 400 });
    }
    const suggestions = await suggestEnrichValues(field, q);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load suggestions";
    const status = /not set/i.test(message) ? 503 : 500;
    console.error("CRM enrich suggest failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
