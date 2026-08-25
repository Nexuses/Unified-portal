import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectContactDetail } from "@/lib/crm-contacts-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });
    }

    const contact = await getProjectContactDetail(
      new ObjectId(session.projectId),
      new ObjectId(id),
      session.projectName,
    );

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(contact);
  } catch (error) {
    console.error("Failed to fetch contact:", error);
    return NextResponse.json(
      { error: "Failed to fetch contact" },
      { status: 500 },
    );
  }
}
