import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  listGmailInboxAccounts,
  listProjectInboxThreads,
  syncProjectGmailInbox,
} from "@/lib/master-inbox-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

function parseSenderId(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "all") {
    return undefined;
  }
  return ObjectId.isValid(trimmed) ? trimmed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const projectId = new ObjectId(session.projectId);
    const senderId = parseSenderId(request.nextUrl.searchParams.get("senderId"));
    const [threads, inboxes] = await Promise.all([
      listProjectInboxThreads(projectId, { senderId }),
      listGmailInboxAccounts(projectId),
    ]);
    return NextResponse.json({ threads, inboxes });
  } catch (error) {
    console.error("Failed to load inbox:", error);
    return NextResponse.json(
      { error: "Failed to load inbox" },
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

    const projectId = new ObjectId(session.projectId);
    const body = (await request.json().catch(() => ({}))) as {
      sinceDays?: number;
      senderId?: string;
    };
    const senderId = parseSenderId(body.senderId);
    const result = await syncProjectGmailInbox(projectId, {
      sinceDays: body.sinceDays,
      senderId,
    });
    const [threads, inboxes] = await Promise.all([
      listProjectInboxThreads(projectId, { senderId }),
      listGmailInboxAccounts(projectId),
    ]);
    return NextResponse.json({ ...result, threads, inboxes });
  } catch (error) {
    console.error("Failed to sync inbox:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to sync Gmail inbox",
      },
      { status: 500 },
    );
  }
}
