import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { verifyProjectSender } from "@/lib/smtp-senders-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid sender id" }, { status: 400 });
    }

    const sender = await verifyProjectSender(
      new ObjectId(session.projectId),
      new ObjectId(id),
    );

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    return NextResponse.json(sender);
  } catch (error) {
    console.error("Failed to verify SMTP sender:", error);
    return NextResponse.json(
      { error: "Failed to verify sender" },
      { status: 500 },
    );
  }
}
