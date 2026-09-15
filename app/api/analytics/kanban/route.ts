import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectKanbanBoard,
  listProjectKanbanBoards,
} from "@/lib/analytics-kanban-server";
import type { KanbanCampaignRef } from "@/lib/analytics-kanban";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const lists = await listProjectKanbanBoards(new ObjectId(session.projectId));
    return NextResponse.json(lists, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to list kanban boards:", error);
    return NextResponse.json(
      { error: "Failed to load kanban lists" },
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
      name?: string;
      campaigns?: KanbanCampaignRef[];
    } | null;
    const board = await createProjectKanbanBoard(new ObjectId(session.projectId), {
      name: String(body?.name ?? ""),
      campaigns: Array.isArray(body?.campaigns) ? body.campaigns : [],
    });
    return NextResponse.json(board, { status: 201, headers: NO_STORE });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create kanban list";
    const status =
      message.includes("required") || message.includes("Select") ? 400 : 500;
    console.error("Failed to create kanban board:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
