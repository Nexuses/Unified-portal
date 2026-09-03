import { NextResponse } from "next/server";
import { listCampaignSendsForExport } from "@/lib/campaign-blasts-server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";
import {
  buildCampaignReportWorkbook,
  campaignReportFilename,
} from "@/lib/campaign-report-excel";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const found = await getDripCampaignByShareToken(token);
    if (!found) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const sends = await listCampaignSendsForExport(
      found.projectId,
      found.campaign.id,
      found.campaign.kind,
    );
    const buffer = await buildCampaignReportWorkbook({
      campaignName: found.campaign.name,
      timezone: found.campaign.timezone || "Asia/Kolkata",
      sentAt: found.campaign.sentAt,
      sends,
    });
    const filename = campaignReportFilename(found.campaign.name);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export public campaign report:", error);
    return NextResponse.json(
      { error: "Failed to export campaign report" },
      { status: 500 },
    );
  }
}
