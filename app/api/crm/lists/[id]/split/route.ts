import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { mapList } from "@/lib/crm";
import { splitList } from "@/lib/crm-import";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 300;

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
      return NextResponse.json({ error: "Invalid list id" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const partNames = Array.isArray(body.partNames)
      ? body.partNames.map((name: unknown) => String(name ?? ""))
      : Array.isArray(body.parts)
        ? body.parts.map((part: unknown) =>
            typeof part === "string"
              ? part
              : String((part as { name?: unknown })?.name ?? ""),
          )
        : [];

    const projectId = new ObjectId(session.projectId);
    const listId = new ObjectId(id);
    const userId = ObjectId.isValid(session.id)
      ? new ObjectId(session.id)
      : null;

    try {
      const result = await splitList(projectId, listId, partNames, userId);
      return NextResponse.json({
        sourceListId: result.sourceListId,
        lists: result.lists.map(mapList),
        counts: result.counts,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to split list";
      const status =
        message === "List not found"
          ? 404
          : message.startsWith("Split into") ||
              message.startsWith("Cannot split") ||
              message.startsWith("This list has") ||
              message.startsWith("Each part") ||
              message.startsWith("A list named") ||
              message.startsWith("That list name") ||
              message.startsWith("The Unsubscribe")
            ? 400
            : 500;
      return NextResponse.json({ error: message }, { status });
    }
  } catch (error) {
    console.error("Failed to split list:", error);
    return NextResponse.json({ error: "Failed to split list" }, { status: 500 });
  }
}
