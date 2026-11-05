import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectAssistantConversation,
  listProjectAssistantConversations,
} from "@/lib/project-assistant-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const conversations = await listProjectAssistantConversations(
      new ObjectId(session.projectId),
    );
    return NextResponse.json(
      { conversations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Project assistant conversations failed:", error);
    return NextResponse.json(
      { error: "Failed to load chats" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const body = (await request.json().catch(() => null)) as {
      title?: string;
    } | null;
    const conversation = await createProjectAssistantConversation(
      new ObjectId(session.projectId),
      body?.title,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error("Project assistant create chat failed:", error);
    return NextResponse.json(
      { error: "Failed to create chat" },
      { status: 500 },
    );
  }
}
