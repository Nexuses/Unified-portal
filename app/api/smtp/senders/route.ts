import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectSender,
  getProjectSenders,
  isSmtpProviderId,
} from "@/lib/smtp-senders-server";
import { parseSenderInput } from "@/lib/smtp-senders";
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

    const senders = await getProjectSenders(new ObjectId(session.projectId));
    return NextResponse.json(senders);
  } catch (error) {
    console.error("Failed to fetch SMTP senders:", error);
    return NextResponse.json(
      { error: "Failed to fetch senders" },
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

    const body = await request.json();
    const providerId = String(body.provider ?? "");

    if (!isSmtpProviderId(providerId)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const parsed = parseSenderInput(providerId, body);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const duplicate = await getProjectSenders(new ObjectId(session.projectId));
    if (
      duplicate.some(
        (sender) =>
          sender.provider === providerId &&
          sender.fromEmail.toLowerCase() === parsed.data.fromEmail.toLowerCase(),
      )
    ) {
      return NextResponse.json(
        { error: "This sender is already configured for this provider" },
        { status: 409 },
      );
    }

    const sender = await createProjectSender(
      new ObjectId(session.projectId),
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      parsed.data,
    );

    return NextResponse.json(sender, { status: 201 });
  } catch (error) {
    console.error("Failed to create SMTP sender:", error);
    return NextResponse.json(
      { error: "Failed to add sender" },
      { status: 500 },
    );
  }
}
