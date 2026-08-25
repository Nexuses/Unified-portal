import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectCampaignReports } from "@/lib/campaign-blasts-server";
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

    const reports = await getProjectCampaignReports(
      new ObjectId(session.projectId),
    );
    return NextResponse.json({ reports });
  } catch (error) {
    console.error("Failed to load campaign stats:", error);
    return NextResponse.json(
      { error: "Failed to load campaign stats" },
      { status: 500 },
    );
  }
}
