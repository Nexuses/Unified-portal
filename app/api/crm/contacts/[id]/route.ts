import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  getProjectContactDetail,
  updateProjectContact,
  type ContactPatchInput,
} from "@/lib/crm-contacts-server";
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as ContactPatchInput | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const contact = await updateProjectContact(
      new ObjectId(session.projectId),
      new ObjectId(id),
      session.projectName,
      body,
    );

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(contact);
  } catch (error) {
    console.error("Failed to update contact:", error);
    const message =
      error instanceof Error ? error.message : "Failed to update contact";
    const status =
      message.includes("email") || message.includes("Email") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
