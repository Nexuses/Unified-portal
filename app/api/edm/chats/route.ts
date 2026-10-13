import { NextRequest, NextResponse } from "next/server";
import { deleteEdmChat, listEdmChats, saveEdmChat } from "@/lib/edm-chats-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const chats = await listEdmChats(session.projectId);
    return NextResponse.json({ projectId: session.projectId, chats });
  } catch (error) {
    console.error("Failed to load EDM chats:", error);
    return NextResponse.json({ error: "Failed to load chats" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Chat is required" }, { status: 400 });
    }
    const chat = await saveEdmChat(session.projectId, session.id, body);
    return NextResponse.json({ chat });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save chat";
    if (message === "Invalid chat id") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Failed to save EDM chat:", error);
    return NextResponse.json({ error: "Failed to save chat" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const id = request.nextUrl.searchParams.get("id") ?? "";
    const removed = await deleteEdmChat(session.projectId, id);
    if (!removed) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete EDM chat:", error);
    return NextResponse.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}
