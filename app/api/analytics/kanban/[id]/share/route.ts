import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createKanbanShare, kanbanShareExpiresAt } from "@/lib/analytics-kanban-server";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import { publicKanbanPath } from "@/lib/portal-nav";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    const share = await createKanbanShare(
      new ObjectId(session.projectId),
      id,
      session.projectName,
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
    );
    if (!share) {
      return NextResponse.json({ error: "Kanban not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        token: share.token,
        url: `${requestOrigin(request.url, request.headers)}${publicKanbanPath(share.token)}`,
        expiresAt: kanbanShareExpiresAt(share).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to create kanban share link:", error);
    return NextResponse.json({ error: "Failed to create public URL" }, { status: 500 });
  }
}
