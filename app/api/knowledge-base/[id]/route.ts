import { NextRequest, NextResponse } from "next/server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";
import { deleteKnowledgeDoc, getKnowledgeDoc } from "@/lib/knowledge-base-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const { id } = await context.params;
  const doc = await getKnowledgeDoc(session.projectId, id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (request.nextUrl.searchParams.get("download") === "1") {
    const fileName = `${doc.title.replace(/[^\w .-]+/g, "").trim() || "knowledge"}.md`;
    return new NextResponse(doc.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  }
  return NextResponse.json({ doc });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const { id } = await context.params;
  const deleted = await deleteKnowledgeDoc(session.projectId, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
