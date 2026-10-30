import { NextResponse } from "next/server";
import { listCampaignSendsForExport } from "@/lib/campaign-blasts-server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";
import {
  buildCampaignReportExportWorkbook,
  campaignReportFilename,
  parseCampaignReportExportFormat,
} from "@/lib/campaign-report-excel";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const found = await getDripCampaignByShareToken(token);
    if (!found) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const hideBotClicks = url.searchParams.get("hideBotClicks") === "1";
    const format = parseCampaignReportExportFormat(url.searchParams.get("format"));
    const sends = await listCampaignSendsForExport(
      found.projectId,
      found.campaign.id,
      found.campaign.kind,
    );
    const buffer = await buildCampaignReportExportWorkbook(
      {
        campaignName: found.campaign.name,
        timezone: found.campaign.timezone || "Asia/Kolkata",
        sentAt: found.campaign.sentAt,
        sends,
        hideBotClicks,
      },
      format,
    );
    const filename = campaignReportFilename(found.campaign.name, format);

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
