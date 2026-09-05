import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  deleteProjectAutomation,
  getProjectAutomation,
  patchProjectAutomation,
} from "@/lib/automations-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const automation = await getProjectAutomation(
      new ObjectId(session.projectId),
      id,
    );
    if (!automation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(automation, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to load automation:", error);
    return NextResponse.json(
      { error: "Failed to load automation" },
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
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      kind?: string;
      steps?: unknown;
      status?: string;
    };

    const automation = await patchProjectAutomation(
      new ObjectId(session.projectId),
      id,
      {
        name: body.name,
        kind:
          body.kind === "oneone"
            ? "oneone"
            : body.kind === "drip"
              ? "drip"
              : undefined,
        steps: Array.isArray(body.steps) ? body.steps : undefined,
        status:
          body.status === "draft" ||
          body.status === "scheduled" ||
          body.status === "running" ||
          body.status === "completed"
            ? body.status
            : undefined,
      },
    );

    if (!automation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(automation, { headers: NO_STORE });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update automation";
    console.error("Failed to update automation:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const deleted = await deleteProjectAutomation(
      new ObjectId(session.projectId),
      id,
    );
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to delete automation:", error);
    return NextResponse.json(
      { error: "Failed to delete automation" },
      { status: 500 },
    );
  }
}
