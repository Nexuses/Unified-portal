import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { mapList, type ListDoc } from "@/lib/crm";
import { deleteLists, importContactsToList, renameList } from "@/lib/crm-import";
import {
  listProjectListContactIds,
  listProjectListContacts,
  removeContactsFromList,
} from "@/lib/crm-contacts-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
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

    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") ?? "1");
    const pageSize = Number(params.get("pageSize") ?? "50");
    const q = params.get("q") ?? "";
    const idsOnly =
      params.get("idsOnly") === "1" || params.get("idsOnly") === "true";

    if (idsOnly) {
      const result = await listProjectListContactIds(projectId, listId, { q });
      return NextResponse.json({
        list: mapList(list),
        ids: result.ids,
        total: result.total,
      });
    }

    const contactsPage = await listProjectListContacts(projectId, listId, {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      q,
    });

    return NextResponse.json({
      list: mapList(list),
      contacts: contactsPage.items,
      items: contactsPage.items,
      total: contactsPage.total,
      page: contactsPage.page,
      pageSize: contactsPage.pageSize,
      totalPages: contactsPage.totalPages,
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
        attributes:
          row.attributes &&
          typeof row.attributes === "object" &&
          !Array.isArray(row.attributes)
            ? Object.fromEntries(
                Object.entries(row.attributes as Record<string, unknown>).map(
                  ([key, value]) => [key, String(value ?? "").trim()],
                ),
              )
            : {},
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

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const projectId = new ObjectId(session.projectId);
    const listId = new ObjectId(id);

    if (body.name !== undefined) {
      try {
        const updated = await renameList(
          projectId,
          listId,
          String(body.name ?? ""),
        );
        return NextResponse.json({ list: mapList(updated) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to rename list";
        const status =
          message === "List not found"
            ? 404
            : message === "List name is required" ||
                message === "That list name is reserved" ||
                message === "The Unsubscribe list cannot be renamed" ||
                message === "A list with that name already exists"
              ? 400
              : 500;
        return NextResponse.json({ error: message }, { status });
      }
    }

    const removeContactIds = Array.isArray(body.removeContactIds)
      ? body.removeContactIds.map((value: unknown) => String(value))
      : [];
    if (removeContactIds.length === 0) {
      return NextResponse.json(
        { error: "No contacts selected" },
        { status: 400 },
      );
    }

    const result = await removeContactsFromList(
      projectId,
      listId,
      removeContactIds,
    );
    return NextResponse.json({ removed: result.removed });
  } catch (error) {
    console.error("Failed to update list:", error);
    const message =
      error instanceof Error ? error.message : "Failed to update list";
    return NextResponse.json(
      { error: message },
      { status: message === "List not found" ? 404 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
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
    const deleteContacts = body?.deleteContacts === true;

    const result = await deleteLists(new ObjectId(session.projectId), [id], {
      deleteContacts,
    });
    if (result.deleted === 0) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      contactsDeleted: result.contactsDeleted,
    });
  } catch (error) {
    console.error("Failed to delete list:", error);
    return NextResponse.json(
      { error: "Failed to delete list" },
      { status: 500 },
    );
  }
}
