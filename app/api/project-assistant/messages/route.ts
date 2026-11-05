import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  clearProjectAssistantMessages,
  listProjectAssistantMessages,
} from "@/lib/project-assistant-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim();
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }
    const messages = await listProjectAssistantMessages(
      new ObjectId(session.projectId),
      conversationId,
    );
    return NextResponse.json(
      { messages },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Project assistant messages failed:", error);
    return NextResponse.json(
      { error: "Failed to load chat" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const conversationId =
      request.nextUrl.searchParams.get("conversationId")?.trim() || undefined;
    await clearProjectAssistantMessages(
      new ObjectId(session.projectId),
      conversationId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Project assistant clear chat failed:", error);
    return NextResponse.json(
      { error: "Failed to clear chat" },
      { status: 500 },
    );
  }
}
