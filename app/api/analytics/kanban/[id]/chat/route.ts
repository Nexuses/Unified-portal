import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  applyKanbanChatActions,
  parseKanbanChatFallback,
  parseKanbanChatJson,
  type KanbanChatAction,
} from "@/lib/analytics-kanban-chat";
import {
  getProjectKanbanBoard,
  patchProjectKanbanBoard,
} from "@/lib/analytics-kanban-server";
import { chatWithDeepSeek, type ChatMessage } from "@/lib/deepseek";
import { stageIdForPerson } from "@/lib/analytics-kanban";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

const SYSTEM_PROMPT = `You edit a Nexuses analytics kanban board.

Return JSON only:
{"reply":"short confirmation","actions":[]}

Actions:
{"type":"create_stage","name":"Meeting","color":"#22c55e"}
{"type":"move","who":"Jane","to":"Engage"}
{"type":"move","who":"everyone","from":"Prospect","to":"Cold"}

Rules:
- who can be a name, email, "everyone", or "everyone in Stage".
- to/from must be existing stage names unless you also create the stage first.
- If the user only asks a question, return actions: [] and answer in reply.
- Keep reply to 1–3 sentences. No markdown fences.`;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await routeContext.params;
    const projectId = new ObjectId(session.projectId);
    const board = await getProjectKanbanBoard(projectId, id);
    if (!board) {
      return NextResponse.json({ error: "Kanban not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      history?: unknown;
    } | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const history = Array.isArray(body?.history) ? body.history : [];
    const prior: ChatMessage[] = history
      .filter(
        (item): item is { role: string; content: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { content?: unknown }).content === "string" &&
          ((item as { role?: unknown }).role === "user" ||
            (item as { role?: unknown }).role === "assistant"),
      )
      .slice(-8)
      .map((item) => ({
        role: item.role as "user" | "assistant",
        content: item.content.slice(0, 2000),
      }));

    const stageLines = board.stages
      .map((stage) => `${stage.name} (${stage.id})`)
      .join(", ");
    const peopleLines = board.people.slice(0, 60).map((person) => {
      const stage = stageIdForPerson(person, board.placements, board.stages);
      return `${person.fullName} <${person.email}> in ${stage}`;
    });
    const boardContext = `Board: ${board.name}. Stages: ${stageLines}. People: ${
      peopleLines.join(" | ") || "none"
    }${board.people.length > 60 ? ` (+${board.people.length - 60} more)` : ""}`;

    let parsed = parseKanbanChatFallback(message);
    try {
      const content = await chatWithDeepSeek({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: boardContext },
          ...prior,
          { role: "user", content: message },
        ],
      });
      parsed = parseKanbanChatJson(content) || parsed;
    } catch {
      // Keep the local fallback when DeepSeek is missing or fails.
    }

    const actions: KanbanChatAction[] = parsed.actions;
    const applied = applyKanbanChatActions(board, actions);
    const saved =
      actions.length > 0
        ? await patchProjectKanbanBoard(projectId, id, {
            stages: applied.board.stages,
            placements: applied.board.placements,
          })
        : board;

    const reply = [parsed.reply, ...applied.notes]
      .filter(Boolean)
      .join(" ");

    return NextResponse.json(
      { reply, board: saved || applied.board },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("Failed to chat with kanban:", error);
    return NextResponse.json(
      { error: "Failed to chat with kanban" },
      { status: 500 },
    );
  }
}
