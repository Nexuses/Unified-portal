import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { mapContact, type ContactDoc } from "@/lib/crm";
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
