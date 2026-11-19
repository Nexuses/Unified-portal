import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { botComputer } from "@/lib/ai-bots-server";
import { BoatError } from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

// Starting a computer can take a couple of minutes on a cold start.
export const maxDuration = 180;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    const body = ((await request.json().catch(() => ({}))) ?? {}) as { action?: string };
    const action = body.action === "start" || body.action === "desktop" || body.action === "stop" ? body.action : "status";
    return NextResponse.json({ computer: await botComputer(new ObjectId(session.projectId), id, action) });
  } catch (error) {
    const status = error instanceof BoatError && error.status >= 400 && error.status < 500 ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Computer action failed" }, { status });
  }
}
