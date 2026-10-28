import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  deleteProjectKanbanBoard,
  getProjectKanbanBoard,
  patchProjectKanbanBoard,
} from "@/lib/analytics-kanban-server";
import type {
  KanbanCampaignRef,
  KanbanManualPerson,
  KanbanStage,
} from "@/lib/analytics-kanban";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    const board = await getProjectKanbanBoard(
      new ObjectId(session.projectId),
      id,
    );
    if (!board) {
      return NextResponse.json({ error: "Kanban not found" }, { status: 404 });
    }
    return NextResponse.json(board, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to load kanban board:", error);
    return NextResponse.json(
      { error: "Failed to load kanban" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      stages?: KanbanStage[];
      placements?: Record<string, string>;
      campaigns?: KanbanCampaignRef[];
      manualPeople?: KanbanManualPerson[];
      excludedEmails?: string[];
    } | null;
    const board = await patchProjectKanbanBoard(
      new ObjectId(session.projectId),
      id,
      {
        name: body?.name,
        stages: body?.stages,
        placements: body?.placements,
        campaigns: body?.campaigns,
        manualPeople: body?.manualPeople,
        excludedEmails: body?.excludedEmails,
      },
      {
        skipPeople:
          body?.campaigns === undefined &&
          body?.manualPeople === undefined &&
          body?.excludedEmails === undefined,
      },
    );
    if (!board) {
      return NextResponse.json({ error: "Kanban not found" }, { status: 404 });
    }
    return NextResponse.json(board, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to save kanban board:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save kanban",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    const ok = await deleteProjectKanbanBoard(
      new ObjectId(session.projectId),
      id,
    );
    if (!ok) {
      return NextResponse.json({ error: "Kanban not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to delete kanban board:", error);
    return NextResponse.json(
      { error: "Failed to delete kanban" },
      { status: 500 },
    );
  }
}
