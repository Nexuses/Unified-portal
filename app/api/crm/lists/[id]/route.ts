import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { mapContact, mapList, type ContactDoc, type ListDoc } from "@/lib/crm";
import { deleteLists, importContactsToList } from "@/lib/crm-import";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid list id" }, { status: 400 });
    }

    const db = await getDb();
    const projectId = new ObjectId(session.projectId);
    const listId = new ObjectId(id);

    const list = await db.collection<ListDoc>("lists").findOne({
      _id: listId,
      projectId,
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const memberships = await db
      .collection("list_memberships")
      .find({ projectId, listId })
      .toArray();

    const contactIds = memberships.map((item) => item.contactId);
    const contacts =
      contactIds.length === 0
        ? []
        : await db
            .collection<ContactDoc>("contacts")
            .find({ _id: { $in: contactIds } })
            .toArray();

    return NextResponse.json({
      list: mapList(list),
      contacts: contacts.map(mapContact),
    });
  } catch (error) {
    console.error("Failed to fetch list:", error);
    return NextResponse.json(
      { error: "Failed to fetch list" },
      { status: 500 },
    );
  }
}

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

    const body = await request.json();
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: "No contacts to import" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const projectId = new ObjectId(session.projectId);
    const listId = new ObjectId(id);

    const list = await db.collection<ListDoc>("lists").findOne({
      _id: listId,
      projectId,
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const userId = ObjectId.isValid(session.id)
      ? new ObjectId(session.id)
      : null;

    const importSummary = await importContactsToList(
      { projectId, listId, userId },
      contacts.map((row: Record<string, unknown>) => ({
        firstName: String(row.firstName ?? "").trim(),
        lastName: String(row.lastName ?? "").trim(),
        email: String(row.email ?? "").trim(),
        companyName: String(row.companyName ?? "").trim(),
      })),
    );

    const updated = await db.collection<ListDoc>("lists").findOne({
      _id: listId,
    });

    return NextResponse.json({
      list: mapList(updated ?? list),
      importSummary,
    });
  } catch (error) {
    console.error("Failed to import list contacts:", error);
    return NextResponse.json(
      { error: "Failed to import contacts" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid list id" }, { status: 400 });
    }

    const result = await deleteLists(new ObjectId(session.projectId), [id]);
    if (result.deleted === 0) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete list:", error);
    return NextResponse.json(
      { error: "Failed to delete list" },
      { status: 500 },
    );
  }
}
