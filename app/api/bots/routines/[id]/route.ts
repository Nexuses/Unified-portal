import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { deleteRoutine, updateRoutine } from "@/lib/ai-bots-routines-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      routine: await updateRoutine(new ObjectId(session.projectId), session.projectName, id, body),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the routine" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    await deleteRoutine(new ObjectId(session.projectId), id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete the routine" }, { status: 400 });
  }
}
