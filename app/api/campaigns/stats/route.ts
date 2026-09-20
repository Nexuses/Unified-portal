import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  getCampaignReport,
  getProjectCampaignReports,
} from "@/lib/campaign-blasts-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const projectId = new ObjectId(session.projectId);
    const campaignId = request.nextUrl.searchParams.get("campaignId")?.trim();
    const kindParam = request.nextUrl.searchParams.get("kind");
    const kind =
      kindParam === "oneone" ? "oneone" : kindParam === "drip" ? "drip" : undefined;

    if (campaignId) {
      const report = await getCampaignReport(projectId, campaignId, kind, {
        refresh: true,
      });
      return NextResponse.json({ reports: report ? [report] : [] });
    }

    const reports = await getProjectCampaignReports(projectId, kind);
    return NextResponse.json({ reports });
  } catch (error) {
    console.error("Failed to load campaign stats:", error);
    return NextResponse.json(
      { error: "Failed to load campaign stats" },
      { status: 500 },
    );
  }
}
