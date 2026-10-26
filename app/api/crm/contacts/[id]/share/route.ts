import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import { ensureContactShareToken } from "@/lib/crm-contacts-server";
import { publicLeadReportPath } from "@/lib/portal-nav";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

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
      return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });
    }

    const token = await ensureContactShareToken(
      new ObjectId(session.projectId),
      new ObjectId(id),
    );
    if (!token) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const url = `${requestOrigin(request.url, request.headers)}${publicLeadReportPath(token)}`;
    return NextResponse.json(
      { token, url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to create lead report share link:", error);
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 },
    );
  }
}
