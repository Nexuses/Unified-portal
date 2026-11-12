import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  aircallConfigured,
  listProjectAircallCalls,
} from "@/lib/aircall-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") || "200");
    const calls = await listProjectAircallCalls(
      new ObjectId(session.projectId),
      { limit },
    );

    return NextResponse.json({
      configured: aircallConfigured(),
      projectId: session.projectId,
      projectName: session.projectName,
      calls,
    });
  } catch (error) {
    console.error("Aircall list failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load Aircall calls",
      },
      { status: 500 },
    );
  }
}
