import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { startSenderTrackingDomain } from "@/lib/smtp-senders-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid sender id" }, { status: 400 });
    }

    const body = (await request.json()) as { trackingDomain?: string };
    const result = await startSenderTrackingDomain(
      new ObjectId(session.projectId),
      new ObjectId(id),
      body.trackingDomain ?? "",
    );

    if (!result) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save tracking domain";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
