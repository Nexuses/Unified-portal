import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectEmailHealth } from "@/lib/email-health-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const health = await getProjectEmailHealth(
      new ObjectId(session.projectId),
    );
    return NextResponse.json(health, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load email health:", error);
    return NextResponse.json(
      { error: "Failed to load email health" },
      { status: 500 },
    );
  }
}
