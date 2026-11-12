import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  getFreshAircallRecordingUrl,
  getProjectAircallCall,
} from "@/lib/aircall-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const aircallCallId = Number(id);
    if (!Number.isFinite(aircallCallId) || aircallCallId <= 0) {
      return NextResponse.json({ error: "Invalid call id" }, { status: 400 });
    }

    const projectId = new ObjectId(session.projectId);
    const local = await getProjectAircallCall(projectId, aircallCallId);
    if (!local) {
      return NextResponse.json(
        { error: "Call not found in this project. Sync Aircall first." },
        { status: 404 },
      );
    }

    const remoteUrl = await getFreshAircallRecordingUrl(aircallCallId);
    const audio = await fetch(remoteUrl, { cache: "no-store" });
    if (!audio.ok || !audio.body) {
      return NextResponse.json(
        { error: `Could not download recording (${audio.status})` },
        { status: 502 },
      );
    }

    const contentType = audio.headers.get("content-type") || "audio/mpeg";
    return new NextResponse(audio.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `inline; filename="aircall-${aircallCallId}.mp3"`,
      },
    });
  } catch (error) {
    console.error("Aircall recording proxy failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load call recording",
      },
      { status: 500 },
    );
  }
}
