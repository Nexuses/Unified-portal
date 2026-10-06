import { NextRequest, NextResponse } from "next/server";
import { addEdmLink, deleteEdmMemory, listEdmLinks } from "@/lib/edm-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const links = await listEdmLinks(session.projectId);
    return NextResponse.json({
      logoUrl: session.projectLogoUrl,
      projectName: session.projectName,
      links,
    });
  } catch (error) {
    console.error("Failed to load EDM memory:", error);
    return NextResponse.json({ error: "Failed to load memory" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      link?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    const link = typeof body?.link === "string" ? body.link : "";

    const saved = await addEdmLink(session.projectId, name, link);
    return NextResponse.json({ link: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save memory";
    const status = message === "Failed to save memory" ? 500 : 400;
    if (status === 500) console.error("Failed to save EDM memory:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const id = request.nextUrl.searchParams.get("id") ?? "";
    const removed = await deleteEdmMemory(session.projectId, id);
    if (!removed) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete EDM memory:", error);
    return NextResponse.json({ error: "Failed to delete link" }, { status: 500 });
  }
}
