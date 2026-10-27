import { NextRequest, NextResponse } from "next/server";
import { isAnalyticsShareExpired } from "@/lib/analytics";
import {
  findKanbanShareByToken,
  getSharedKanbanBoard,
} from "@/lib/analytics-kanban-server";
import {
  buildKanbanBoardCsv,
  kanbanCsvFilename,
} from "@/lib/analytics-kanban-csv";

type RouteContext = {
  params: Promise<{ token: string }>;
};

/** Public pipeline CSV download (no portal login). */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const share = await findKanbanShareByToken(token);
    if (!share) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }
    if (isAnalyticsShareExpired(share)) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    const board = await getSharedKanbanBoard(share);
    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    const hideBotClicks =
      request.nextUrl.searchParams.get("hideBotClicks") === "1";
    const csv = buildKanbanBoardCsv(board, { hideBotClicks });
    const filename = kanbanCsvFilename(board.name);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export shared pipeline CSV:", error);
    return NextResponse.json(
      { error: "Failed to export pipeline CSV" },
      { status: 500 },
    );
  }
}
