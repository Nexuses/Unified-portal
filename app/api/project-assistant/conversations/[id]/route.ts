import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { deleteProjectAssistantConversation } from "@/lib/project-assistant-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    await deleteProjectAssistantConversation(
      new ObjectId(session.projectId),
      id,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete chat";
    console.error("Project assistant delete chat failed:", error);
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 500 },
    );
  }
}
