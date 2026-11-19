import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { deleteBot, updateBot } from "@/lib/ai-bots-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ bot: await updateBot(new ObjectId(session.projectId), id, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the bot" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    await deleteBot(new ObjectId(session.projectId), id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete the bot" }, { status: 400 });
  }
}
