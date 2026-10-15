import { NextRequest, NextResponse } from "next/server";
import {
  AI_SEARCH_MAX_QUERY_LENGTH,
  expandAiSearchFilters,
  parseAiSearchExpandOptions,
} from "@/lib/people/ai-search";
import { parseFiltersHybrid } from "@/lib/people/ai-filters";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) {
    return session;
  }

  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json({ error: "Describe who you are looking for" }, { status: 400 });
    }
    if (query.length > AI_SEARCH_MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Keep it under ${AI_SEARCH_MAX_QUERY_LENGTH} characters` },
        { status: 400 }
      );
    }

    const parsed = await parseFiltersHybrid(query, "people");
    const filters = expandAiSearchFilters(
      parsed,
      parseAiSearchExpandOptions(body.expandOptions)
    );
    return NextResponse.json({ filters });
  } catch (error) {
    console.error("[enrich/people/ai] failed", error);
    const message = error instanceof Error ? error.message : "Failed to build filters";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
