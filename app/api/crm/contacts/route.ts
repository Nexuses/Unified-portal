import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { mapContact, type ContactDoc } from "@/lib/crm";
import {
  deleteContacts,
  listProjectContacts,
} from "@/lib/crm-contacts-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const projectId = new ObjectId(session.projectId);
    const params = request.nextUrl.searchParams;
    const pageParam = params.get("page");
    const paginate = pageParam != null || params.has("pageSize") || params.has("q");

    if (paginate) {
      const searchFieldRaw = params.get("searchField") || "all";
      const searchField =
        searchFieldRaw === "name" || searchFieldRaw === "email"
          ? searchFieldRaw
          : "all";

      const data = await listProjectContacts(projectId, {
        page: Number(pageParam ?? "1"),
        pageSize: Number(params.get("pageSize") ?? "50"),
        q: params.get("q") ?? "",
        searchField,
        createdAfter: params.get("createdAfter"),
      });
      return NextResponse.json(data);
    }

    // Legacy full list for pickers that still expect an array.
    const db = await getDb();
    const contacts = await db
      .collection<ContactDoc>("contacts")
      .find({ projectId })
      .sort({ lastName: 1, firstName: 1, email: 1 })
      .toArray();

    return NextResponse.json(contacts.map(mapContact));
  } catch (error) {
    console.error("Failed to fetch contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = await request.json();
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id: unknown) => String(id))
      : [];

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "No contacts selected" },
        { status: 400 },
      );
    }

    const result = await deleteContacts(new ObjectId(session.projectId), ids);
    return NextResponse.json({ deleted: result.deleted });
  } catch (error) {
    console.error("Failed to delete contacts:", error);
    return NextResponse.json(
      { error: "Failed to delete contacts" },
      { status: 500 },
    );
  }
}
