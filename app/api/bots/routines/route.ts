import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { createRoutine, listRoutines } from "@/lib/ai-bots-routines-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  return NextResponse.json({ routines: await listRoutines(new ObjectId(session.projectId)) });
}

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ routine: await createRoutine(new ObjectId(session.projectId), session.id, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the routine" }, { status: 400 });
  }
}
