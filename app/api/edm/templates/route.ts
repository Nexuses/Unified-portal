import { NextRequest, NextResponse } from "next/server";
import { listEdmTemplates, saveEdmTemplate, type EdmDestination } from "@/lib/edm-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

function destinationOf(value: string | null): EdmDestination | undefined {
  if (value === "drip" || value === "oneone") return value;
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const templates = await listEdmTemplates(
      session.projectId,
      destinationOf(request.nextUrl.searchParams.get("destination")),
    );
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Failed to list EDM templates:", error);
    return NextResponse.json({ error: "Failed to list templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      subject?: unknown;
      html?: unknown;
      destinations?: unknown;
    } | null;

    const destinations = Array.isArray(body?.destinations)
      ? body.destinations.filter(
          (item): item is EdmDestination => item === "drip" || item === "oneone",
        )
      : [];
    if (!destinations.length) {
      return NextResponse.json(
        { error: "Choose drip, 1-1, or both" },
        { status: 400 },
      );
    }

    const html = typeof body?.html === "string" ? body.html : "";
    if (!html.trim()) {
      return NextResponse.json({ error: "HTML is empty" }, { status: 400 });
    }

    const template = await saveEdmTemplate({
      projectId: session.projectId,
      name: typeof body?.name === "string" ? body.name : "",
      subject: typeof body?.subject === "string" ? body.subject : "",
      html,
      destinations,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    console.error("Failed to save EDM template:", error);
    const message = error instanceof Error ? error.message : "Failed to save template";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
