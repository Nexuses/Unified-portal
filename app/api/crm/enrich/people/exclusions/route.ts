import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { countEnrichPeopleExclusions } from "@/lib/people/enrich-people-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const counts = await countEnrichPeopleExclusions(
      request.nextUrl.searchParams,
      new ObjectId(session.projectId)
    );
    return NextResponse.json(counts);
  } catch (error) {
    console.error("[enrich/people/exclusions] failed", error);
    const message = error instanceof Error ? error.message : "Failed to count exclusions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
