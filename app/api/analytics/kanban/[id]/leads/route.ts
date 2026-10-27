import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { addContactsToKanbanStage } from "@/lib/analytics-kanban-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      stageId?: string;
      contactIds?: string[];
    } | null;
    const stageId = String(body?.stageId ?? "").trim();
    const contactIds = Array.isArray(body?.contactIds) ? body.contactIds : [];
    const board = await addContactsToKanbanStage(
      new ObjectId(session.projectId),
      id,
      stageId,
      contactIds,
    );
    if (!board) {
      return NextResponse.json({ error: "Kanban not found" }, { status: 404 });
    }
    return NextResponse.json(board, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to add kanban leads:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to add leads",
      },
      { status: 400 },
    );
  }
}
