import { NextRequest, NextResponse } from "next/server";
import { findKanbanShareByToken, moveSharedKanbanCards } from "@/lib/analytics-kanban-server";

type RouteContext = { params: Promise<{ token: string }> };

/** Saves card moves made on a public kanban link. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const share = await findKanbanShareByToken(token);
    if (!share) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as { placements?: unknown } | null;
    const raw = body?.placements;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }
    const placements: Record<string, string> = {};
    for (const [email, stageId] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof stageId === "string" && email.length <= 320) {
        placements[email.trim().toLowerCase()] = stageId;
      }
    }
    const saved = await moveSharedKanbanCards(share, placements);
    if (!saved) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }
    return NextResponse.json({ placements: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to save shared kanban move:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
