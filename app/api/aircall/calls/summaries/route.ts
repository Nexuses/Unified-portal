import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { summariseNextCallRecording } from "@/lib/aircall-recording-notes";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Summarise the next call recording that does not have notes yet. */
export async function POST() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const result = await summariseNextCallRecording(new ObjectId(session.projectId));
    return NextResponse.json({
      call: result.call,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error("Aircall recording summary failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to summarise recording",
      },
      { status: 500 },
    );
  }
}
