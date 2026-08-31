import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { ensureCampaignShareToken } from "@/lib/drip-campaigns-server";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import { publicCampaignReportPath } from "@/lib/portal-nav";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

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
    const token = await ensureCampaignShareToken(
      new ObjectId(session.projectId),
      id,
    );
    if (!token) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const url = `${requestOrigin(request.url, request.headers)}${publicCampaignReportPath(token)}`;
    return NextResponse.json(
      { token, url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to create campaign share link:", error);
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 },
    );
  }
}
