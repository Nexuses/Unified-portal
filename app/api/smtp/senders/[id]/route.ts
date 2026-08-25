import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  deleteProjectSender,
  getProjectSenders,
  getProjectSender,
  updateProjectSender,
} from "@/lib/smtp-senders-server";
import { parseSenderInput } from "@/lib/smtp-senders";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid sender id" }, { status: 400 });
    }

    const projectId = new ObjectId(session.projectId);
    const senderId = new ObjectId(id);
    const existing = await getProjectSender(projectId, senderId);

    if (!existing) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = parseSenderInput(existing.provider, body, { mode: "update" });
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const senders = await getProjectSenders(projectId);
    if (
      senders.some(
        (sender) =>
          sender.id !== id &&
          sender.provider === existing.provider &&
          sender.fromEmail.toLowerCase() === parsed.data.fromEmail.toLowerCase(),
      )
    ) {
      return NextResponse.json(
        { error: "This sender is already configured for this provider" },
        { status: 409 },
      );
    }

    const sender = await updateProjectSender(projectId, senderId, parsed.data);
    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    return NextResponse.json(sender);
  } catch (error) {
    console.error("Failed to update SMTP sender:", error);
    return NextResponse.json(
      { error: "Failed to update sender" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid sender id" }, { status: 400 });
    }

    const deleted = await deleteProjectSender(
      new ObjectId(session.projectId),
      new ObjectId(id),
    );

    if (!deleted) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete SMTP sender:", error);
    return NextResponse.json(
      { error: "Failed to delete sender" },
      { status: 500 },
    );
  }
}
