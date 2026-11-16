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

function parseRange(header: string | null, size: number) {
  if (!header || !header.startsWith("bytes=") || size <= 0) {
    return null;
  }
  const [startRaw, endRaw] = header.slice("bytes=".length).split("-", 2);
  const start = startRaw ? Number(startRaw) : 0;
  const end = endRaw ? Number(endRaw) : size - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: NextRequest, context: RouteContext) {
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
    if (!audio.ok) {
      return NextResponse.json(
        { error: `Could not download recording (${audio.status})` },
        { status: 502 },
      );
    }

    // Buffer so we can send Content-Length + byte ranges (needed for scrub/seek).
    const buffer = Buffer.from(await audio.arrayBuffer());
    const size = buffer.byteLength;
    const contentType = audio.headers.get("content-type") || "audio/mpeg";
    const range = parseRange(request.headers.get("range"), size);
    const commonHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="aircall-${aircallCallId}.mp3"`,
    };

    if (range) {
      const { start, end } = range;
      const chunk = buffer.subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
      });
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        ...commonHeaders,
        "Content-Length": String(size),
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
