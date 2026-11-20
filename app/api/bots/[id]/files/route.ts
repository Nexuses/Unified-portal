import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { readBotFile } from "@/lib/ai-bots-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    const path = request.nextUrl.searchParams.get("path") ?? "";
    const file = await readBotFile(new ObjectId(session.projectId), id, path);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not download" }, { status: 400 });
  }
}
