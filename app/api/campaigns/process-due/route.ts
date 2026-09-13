import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  processDueCampaignBlasts,
  requestOrigin,
} from "@/lib/campaign-blasts-server";
import { processDueAutomationFollowUps } from "@/lib/automations-server";
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

    const projectId = new ObjectId(session.projectId);
    const origin = requestOrigin(request.url, request.headers);
    const reports = await processDueCampaignBlasts(projectId, origin);
    const followUps = await processDueAutomationFollowUps(projectId, origin);
    return NextResponse.json({ reports, followUps });
  } catch (error) {
    console.error("Failed to process campaign sends:", error);
    return NextResponse.json(
      { error: "Failed to process campaign sends" },
      { status: 500 },
    );
  }
}
