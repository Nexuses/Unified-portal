import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { listCampaignSendsForExport } from "@/lib/campaign-blasts-server";
import { getProjectDripCampaign } from "@/lib/drip-campaigns-server";
import {
  buildCampaignReportWorkbook,
  campaignReportFilename,
} from "@/lib/campaign-report-excel";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const projectId = new ObjectId(session.projectId);
    const campaign = await getProjectDripCampaign(projectId, id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const sends = await listCampaignSendsForExport(projectId, id);
    const buffer = await buildCampaignReportWorkbook({
      campaignName: campaign.name,
      timezone: campaign.timezone || "Asia/Kolkata",
      sentAt: campaign.sentAt,
      sends,
    });
    const filename = campaignReportFilename(campaign.name);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export campaign report:", error);
    return NextResponse.json(
      { error: "Failed to export campaign report" },
      { status: 500 },
    );
  }
}
