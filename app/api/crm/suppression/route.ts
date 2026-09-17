import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  bulkImportSuppression,
  bulkImportSuppressionValues,
  getUnsubscribeListEntries,
  removeSuppressionItem,
  type SuppressionKind,
} from "@/lib/unsubscribe-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "50");
    const data = await getUnsubscribeListEntries(new ObjectId(session.projectId), {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    });
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
      values?: unknown;
    };
    const kind: SuppressionKind = body.kind === "domain" ? "domain" : "email";
    const userId = ObjectId.isValid(session.id) ? new ObjectId(session.id) : null;
    const projectId = new ObjectId(session.projectId);

    const values = Array.isArray(body.values)
      ? body.values.map((value) => String(value ?? "").trim()).filter(Boolean)
      : null;

    const result = values
      ? await bulkImportSuppressionValues(projectId, userId, kind, values)
      : await bulkImportSuppression(projectId, userId, kind, String(body.text ?? ""));

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
