import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectWebhook,
  listProjectWebhooks,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const webhooks = await listProjectWebhooks(
      new ObjectId(session.projectId),
    );
    return NextResponse.json({ webhooks, events: WEBHOOK_EVENTS });
  } catch (error) {
    console.error("Failed to list webhooks:", error);
    return NextResponse.json(
      { error: "Failed to list webhooks" },
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

    const body = (await request.json().catch(() => null)) as {
      url?: unknown;
      events?: unknown;
    } | null;

    try {
      const created = await createProjectWebhook({
        projectId: new ObjectId(session.projectId),
        createdBy: ObjectId.isValid(session.id)
          ? new ObjectId(session.id)
          : null,
        url: typeof body?.url === "string" ? body.url : "",
        events: body?.events,
      });
      return NextResponse.json(
        {
          webhook: created.webhook,
          secret: created.secret,
          warning:
            "Copy this webhook signing secret now. You will not be able to see it again.",
        },
        { status: 201 },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create webhook";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    console.error("Failed to create webhook:", error);
    return NextResponse.json(
      { error: "Failed to create webhook" },
      { status: 500 },
    );
  }
}
