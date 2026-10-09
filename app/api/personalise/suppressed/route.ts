import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { getSuppressionSets, isSuppressedAddress } from "@/lib/unsubscribe-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => ({}))) as { emails?: unknown };
    const emails = Array.isArray(body.emails)
      ? body.emails
          .map((email) => String(email ?? "").trim().toLowerCase())
          .filter((email) => email.includes("@"))
          .slice(0, 2000)
      : [];
    if (emails.length === 0) {
      return NextResponse.json({ suppressed: [] });
    }

    const sets = await getSuppressionSets(new ObjectId(session.projectId));
    const suppressed = [...new Set(emails)].filter((email) => isSuppressedAddress(email, sets));
    return NextResponse.json({ suppressed });
  } catch (error) {
    console.error("Failed to check unsubscribed emails:", error);
    return NextResponse.json({ error: "Could not check the unsubscribe list." }, { status: 500 });
  }
}
