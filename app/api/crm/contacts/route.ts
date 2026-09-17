import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { mapContact, type ContactDoc } from "@/lib/crm";
import { deleteContacts } from "@/lib/crm-contacts-server";
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
    const contacts = await db
      .collection<ContactDoc>("contacts")
      .find({ projectId: new ObjectId(session.projectId) })
      .sort({ lastName: 1, firstName: 1 })
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
