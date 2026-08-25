import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUnsubscribeListEntries } from "@/lib/unsubscribe-server";
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

    const data = await getUnsubscribeListEntries(new ObjectId(session.projectId));
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load suppression list:", error);
    return NextResponse.json(
      { error: "Failed to load suppression list" },
      { status: 500 },
    );
  }
}
