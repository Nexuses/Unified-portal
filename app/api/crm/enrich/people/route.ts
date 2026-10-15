import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { queryEnrichPeople } from "@/lib/people/enrich-people-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const result = await queryEnrichPeople(
      request.nextUrl.searchParams,
      new ObjectId(session.projectId)
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[enrich/people] failed", error);
    const message = error instanceof Error ? error.message : "Failed to load data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
