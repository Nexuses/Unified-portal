import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { runInApiCredit } from "@/lib/api-credits-server";
import { askProjectAssistant } from "@/lib/project-assistant-chat-server";
import {
  appendProjectAssistantMessages,
  createProjectAssistantConversation,
  getProjectAssistantConversation,
  listProjectAssistantConversations,
  listProjectAssistantMessages,
} from "@/lib/project-assistant-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const body = (await request.json().catch(() => null)) as {
      message?: string;
      conversationId?: string;
    } | null;
    const message = String(body?.message || "").trim();
    if (!message) {
      return NextResponse.json({ error: "Ask something first." }, { status: 400 });
    }

    const projectId = new ObjectId(session.projectId);
    let conversationId = String(body?.conversationId || "").trim();
    if (conversationId) {
      const existing = await getProjectAssistantConversation(
        projectId,
        conversationId,
      );
      if (!existing) {
        return NextResponse.json({ error: "Chat not found." }, { status: 404 });
      }
    } else {
      const created = await createProjectAssistantConversation(projectId);
      conversationId = created.id;
    }

    const prior = await listProjectAssistantMessages(projectId, conversationId, 40);
    const history = [
      ...prior.map((item) => ({ role: item.role, content: item.content })),
      { role: "user" as const, content: message },
    ];

    return await runInApiCredit(session.projectId, "assistant", async () => {
      const reply = await askProjectAssistant({
        projectId,
        projectName: session.projectName,
        userName: session.fullName,
        userId: session.id,
        history,
      });
      const saved = await appendProjectAssistantMessages(projectId, conversationId, [
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ]);
      const conversations = await listProjectAssistantConversations(projectId);
      return NextResponse.json({
        reply,
        conversationId,
        messages: saved,
        conversations,
      });
    });
  } catch (error) {
    console.error("Project assistant chat failed:", error);
    if (isApiCreditLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The assistant could not answer right now.",
      },
      { status: 500 },
    );
  }
}
