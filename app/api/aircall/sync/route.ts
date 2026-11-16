import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  aircallConfigured,
  syncAircallCallsForProject,
} from "@/lib/aircall-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    if (!aircallConfigured()) {
      return NextResponse.json(
        {
          error:
            "Aircall is not configured. Add AIRCALL_API_ID and AIRCALL_API_TOKEN to the server environment.",
        },
        { status: 503 },
      );
    }

    const result = await syncAircallCallsForProject(
      new ObjectId(session.projectId),
      { perPage: 200 },
    );

    return NextResponse.json({
      ok: true,
      projectId: session.projectId,
      projectName: session.projectName,
      ...result,
    });
  } catch (error) {
    console.error("Aircall sync failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to sync Aircall calls",
      },
      { status: 500 },
    );
  }
}
