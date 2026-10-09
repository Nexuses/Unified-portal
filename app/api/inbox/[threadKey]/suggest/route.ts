import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { suggestInboxReply } from "@/lib/inbox-ai-reply";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ threadKey: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
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

    const body = (await request.json().catch(() => null)) as { instruction?: string } | null;
    const suggestion = await suggestInboxReply({
      projectId: new ObjectId(session.projectId),
      threadKey,
      instruction: String(body?.instruction ?? ""),
    });
    return NextResponse.json(suggestion);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not suggest a reply.";
    console.error("Failed to suggest inbox reply:", error);
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
