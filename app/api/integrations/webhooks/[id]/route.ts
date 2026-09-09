import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { revokeProjectWebhook } from "@/lib/webhooks-server";
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
    const ok = await revokeProjectWebhook(
      new ObjectId(session.projectId),
      id,
    );
    if (!ok) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to revoke webhook:", error);
    return NextResponse.json(
      { error: "Failed to revoke webhook" },
      { status: 500 },
    );
  }
}
