import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  listProjectInboxThreadMessages,
  markInboxThreadRead,
} from "@/lib/master-inbox-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ threadKey: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { threadKey: encoded } = await context.params;
    const threadKey = decodeURIComponent(encoded);
    if (!threadKey) {
      return NextResponse.json({ error: "Thread required" }, { status: 400 });
    }

    const messages = await listProjectInboxThreadMessages(
      new ObjectId(session.projectId),
      threadKey,
    );
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Failed to load inbox thread:", error);
    return NextResponse.json(
      { error: "Failed to load thread" },
      { status: 500 },
    );
  }
}

export async function PATCH(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { threadKey: encoded } = await context.params;
    const threadKey = decodeURIComponent(encoded);
    if (!threadKey) {
      return NextResponse.json({ error: "Thread required" }, { status: 400 });
    }

    const messages = await markInboxThreadRead(
      new ObjectId(session.projectId),
      threadKey,
    );
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Failed to mark inbox thread read:", error);
    return NextResponse.json(
      { error: "Failed to update thread" },
      { status: 500 },
    );
  }
}
