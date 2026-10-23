import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { enrichContactWithApollo } from "@/lib/crm-contacts-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });
    }

    const result = await enrichContactWithApollo(
      new ObjectId(session.projectId),
      new ObjectId(id),
      session.projectName,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(result.contact);
  } catch (error) {
    console.error("Apollo enrich failed:", error);
    const message =
      error instanceof Error ? error.message : "Apollo enrich failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
