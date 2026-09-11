import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { duplicateProjectDripCampaign } from "@/lib/drip-campaigns-server";
import { parseCampaignKind } from "@/lib/drip-campaigns";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

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
    const kind = parseCampaignKind(request.nextUrl.searchParams.get("kind"));
    const campaign = await duplicateProjectDripCampaign(
      new ObjectId(session.projectId),
      id,
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      kind,
    );

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json(campaign, { status: 201, headers: NO_STORE });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to duplicate campaign";
    console.error("Failed to duplicate drip campaign:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
