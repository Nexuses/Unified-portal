import { NextRequest, NextResponse } from "next/server";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { ensureEventShareToken } from "@/lib/events";
import { publicEventReportPath } from "@/lib/portal-nav";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const token = await ensureEventShareToken(id, access.session.projectId);
    if (!token) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const url = `${requestOrigin(request.url, request.headers)}${publicEventReportPath(token)}`;
    return NextResponse.json(
      { token, url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to create event share link:", error);
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 },
    );
  }
}
