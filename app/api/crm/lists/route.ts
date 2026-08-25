import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { mapList, type ListDoc } from "@/lib/crm";
import { createList, importContactsToList } from "@/lib/crm-import";
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

    const db = await getDb();
    const lists = await db
      .collection<ListDoc>("lists")
      .find({ projectId: new ObjectId(session.projectId) })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(lists.map(mapList));
  } catch (error) {
    console.error("Failed to fetch lists:", error);
    return NextResponse.json(
      { error: "Failed to fetch lists" },
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
    const name = String(body.name ?? "").trim();
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    const importFileName = String(body.importFileName ?? "").trim();

    if (!name) {
      return NextResponse.json(
        { error: "List name is required" },
        { status: 400 },
      );
    }

    const projectId = new ObjectId(session.projectId);
    const userId = ObjectId.isValid(session.id)
      ? new ObjectId(session.id)
      : null;

    const list = await createList(
      projectId,
      name,
      userId,
      importFileName || undefined,
    );

    let importSummary = null;
    if (contacts.length > 0) {
      importSummary = await importContactsToList(
        {
          projectId,
          listId: list._id,
          userId,
        },
        contacts.map((row: Record<string, unknown>) => ({
          firstName: String(row.firstName ?? "").trim(),
          lastName: String(row.lastName ?? "").trim(),
          email: String(row.email ?? "").trim(),
          companyName: String(row.companyName ?? "").trim(),
        })),
      );
    }

    const db = await getDb();
    const saved = await db.collection<ListDoc>("lists").findOne({
      _id: list._id,
    });

    return NextResponse.json(
      {
        list: mapList(saved ?? list),
        importSummary,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create list:", error);
    return NextResponse.json(
      { error: "Failed to create list" },
      { status: 500 },
    );
  }
}
