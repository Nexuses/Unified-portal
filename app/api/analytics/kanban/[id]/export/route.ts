import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectKanbanBoard } from "@/lib/analytics-kanban-server";
import {
  buildKanbanBoardCsv,
  kanbanCsvFilename,
} from "@/lib/analytics-kanban-csv";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const board = await getProjectKanbanBoard(
      new ObjectId(session.projectId),
      id,
      { freshPeople: true },
    );
    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    const csv = buildKanbanBoardCsv(board);
    const filename = kanbanCsvFilename(board.name);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export pipeline CSV:", error);
    return NextResponse.json(
      { error: "Failed to export pipeline CSV" },
      { status: 500 },
    );
  }
}
