import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { runInApiCredit } from "@/lib/api-credits-server";
import { askPortalAssistant, type AssistantMessage } from "@/lib/assistant-server";
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
    const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
    const history: AssistantMessage[] = (Array.isArray(body?.messages) ? body.messages : [])
      .filter(
        (item): item is AssistantMessage =>
          Boolean(item) &&
          typeof item === "object" &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.trim().length > 0,
      );
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return NextResponse.json({ error: "Ask a question first" }, { status: 400 });
    }
    return await runInApiCredit(session.projectId, "assistant", async () => {
      const { content: reply, cards } = await askPortalAssistant({
        projectId: new ObjectId(session.projectId),
        projectName: session.projectName,
        userName: session.fullName,
        history,
      });
      return NextResponse.json({ reply, cards });
    });
  } catch (error) {
    console.error("Assistant failed:", error);
    if (isApiCreditLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    return NextResponse.json(
      { error: "The assistant could not answer right now. Try again in a moment." },
      { status: 500 },
    );
  }
}
