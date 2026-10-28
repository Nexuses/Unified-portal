import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getContactCampaignSendEmail } from "@/lib/crm-contact-send-email";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; sendId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id, sendId } = await context.params;
    if (!ObjectId.isValid(id) || !ObjectId.isValid(sendId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const email = await getContactCampaignSendEmail(
      new ObjectId(session.projectId),
      new ObjectId(id),
      new ObjectId(sendId),
    );
    if (!email) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    return NextResponse.json(email, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load contact campaign email:", error);
    return NextResponse.json(
      { error: "Failed to load email" },
      { status: 500 },
    );
  }
}
