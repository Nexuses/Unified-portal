import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { listProjectAlerts } from "@/lib/portal-alerts-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

/** Active alerts for the signed-in project (topbar bell). */
export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const alerts = await listProjectAlerts(new ObjectId(session.projectId));
    return NextResponse.json({ alerts });
  } catch (error) {
    return NextResponse.json(
      { alerts: [], error: error instanceof Error ? error.message : "Could not load alerts" },
      { status: 500 },
    );
  }
}
