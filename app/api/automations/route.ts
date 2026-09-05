import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectAutomation,
  listProjectAutomations,
} from "@/lib/automations-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const automations = await listProjectAutomations(
      new ObjectId(session.projectId),
    );
    return NextResponse.json(automations, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to list automations:", error);
    return NextResponse.json(
      { error: "Failed to load automations" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      kind?: string;
      steps?: unknown;
      status?: string;
    };

    const automation = await createProjectAutomation(
      new ObjectId(session.projectId),
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      {
        name: body.name,
        kind: body.kind === "oneone" ? "oneone" : "drip",
        steps: Array.isArray(body.steps) ? body.steps : [],
        status:
          body.status === "scheduled" ||
          body.status === "running" ||
          body.status === "completed"
            ? body.status
            : "draft",
      },
    );

    return NextResponse.json(automation, { status: 201, headers: NO_STORE });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create automation";
    console.error("Failed to create automation:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
