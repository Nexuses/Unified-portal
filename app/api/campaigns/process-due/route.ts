import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  processDueCampaignBlasts,
  requestOrigin,
} from "@/lib/campaign-blasts-server";
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

    const reports = await processDueCampaignBlasts(
      new ObjectId(session.projectId),
      requestOrigin(request.url, request.headers),
    );
    return NextResponse.json({ reports });
  } catch (error) {
    console.error("Failed to process campaign sends:", error);
    return NextResponse.json(
      { error: "Failed to process campaign sends" },
      { status: 500 },
    );
  }
}
