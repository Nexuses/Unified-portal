import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  deleteInboxSignature,
  listInboxSignatures,
  saveInboxSignature,
} from "@/lib/inbox-signatures-server";
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
    const signatures = await listInboxSignatures(new ObjectId(session.projectId));
    return NextResponse.json({ signatures });
  } catch (error) {
    console.error("Failed to load inbox signatures:", error);
    return NextResponse.json({ error: "Failed to load signatures" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const body = (await request.json().catch(() => null)) as {
      senderId?: string;
      html?: string;
      autoAdd?: boolean;
    } | null;
    const signature = await saveInboxSignature(
      new ObjectId(session.projectId),
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      {
        senderId: String(body?.senderId ?? ""),
        html: String(body?.html ?? ""),
        autoAdd: body?.autoAdd !== false,
      },
    );
    return NextResponse.json({ signature });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save signature";
    console.error("Failed to save inbox signature:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const senderId = request.nextUrl.searchParams.get("senderId") ?? "";
    await deleteInboxSignature(new ObjectId(session.projectId), senderId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete inbox signature:", error);
    return NextResponse.json({ error: "Failed to delete signature" }, { status: 500 });
  }
}
