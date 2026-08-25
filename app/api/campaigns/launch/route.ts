import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  launchCampaignBlast,
  requestOrigin,
} from "@/lib/campaign-blasts-server";
import type { DripCampaign } from "@/lib/drip-campaigns";
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

    const body = (await request.json()) as {
      campaign?: DripCampaign;
      mode?: "now" | "later";
      scheduledFor?: string;
    };

    if (!body.campaign) {
      return NextResponse.json({ error: "Campaign is required." }, { status: 400 });
    }
    if (body.mode !== "now" && body.mode !== "later") {
      return NextResponse.json({ error: "Choose send now or schedule." }, { status: 400 });
    }

    const report = await launchCampaignBlast({
      projectId: new ObjectId(session.projectId),
      campaign: body.campaign,
      mode: body.mode,
      scheduledFor: body.scheduledFor,
      origin: requestOrigin(request.url, request.headers),
    });

    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to launch campaign";
    console.error("Failed to launch campaign:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
