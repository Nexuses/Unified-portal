import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { deleteProjectAssistantIntegration } from "@/lib/project-assistant-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    await deleteProjectAssistantIntegration(new ObjectId(session.projectId), id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Project assistant disconnect failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to disconnect tool",
      },
      { status: 400 },
    );
  }
}
