import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { cloudCampaignReport } from "@/lib/cloud-campaign-tracking";
import { getCloudCampaign } from "@/lib/cloud-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type Params = { params: Promise<{ id: string }> };

/** Engagement report for one cloud campaign (sent / opened / clicked / replied / bounced). */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const projectId = new ObjectId(session.projectId);
    const campaign = await getCloudCampaign(projectId, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const report = await cloudCampaignReport(projectId, id);
    const skipped = campaign.sendLog.filter((entry) => entry.status === "skipped").length;
    return NextResponse.json({
      report: {
        ...report,
        totals: { ...report.totals, skipped, failed: campaign.failedCount },
        tracking: {
          opens: campaign.trackOpens !== false,
          clicks: campaign.trackClicks === true,
          unsubscribe: campaign.unsubscribeFooter === true,
        },
        inboxCheckedAt: campaign.inboxCheckedAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the report" },
      { status: 500 },
    );
  }
}
