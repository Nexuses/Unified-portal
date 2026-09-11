import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  bulkImportSuppression,
  getUnsubscribeListEntries,
  removeSuppressionItem,
  type SuppressionKind,
} from "@/lib/unsubscribe-server";
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

    const data = await getUnsubscribeListEntries(new ObjectId(session.projectId));
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load suppression list:", error);
    return NextResponse.json(
      { error: "Failed to load suppression list" },
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

    const body = (await request.json()) as {
      kind?: string;
      text?: string;
    };
    const kind: SuppressionKind = body.kind === "domain" ? "domain" : "email";
    const text = String(body.text ?? "");
    const userId = ObjectId.isValid(session.id) ? new ObjectId(session.id) : null;
    const result = await bulkImportSuppression(
      new ObjectId(session.projectId),
      userId,
      kind,
      text,
    );
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to import suppression list";
    console.error("Failed to import suppression list:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json()) as { kind?: string; id?: string };
    const kind: SuppressionKind = body.kind === "domain" ? "domain" : "email";
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Missing item id" }, { status: 400 });
    }

    const result = await removeSuppressionItem(
      new ObjectId(session.projectId),
      kind,
      id,
    );
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove suppression item";
    console.error("Failed to remove suppression item:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
