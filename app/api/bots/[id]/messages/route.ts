import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { clearMessages, listMessages, sendToBot } from "@/lib/ai-bots-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    return NextResponse.json({ messages: await listMessages(new ObjectId(session.projectId), id, session.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the chat" }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    const body = ((await request.json().catch(() => ({}))) ?? {}) as { content?: unknown };
    const projectId = new ObjectId(session.projectId);
    await sendToBot(projectId, session.projectName, id, String(body.content ?? ""), {
      id: session.id,
      name: session.fullName || "You",
    });
    return NextResponse.json({ messages: await listMessages(projectId, id, session.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const { id } = await params;
    await clearMessages(new ObjectId(session.projectId), id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clear the chat" }, { status: 400 });
  }
}
