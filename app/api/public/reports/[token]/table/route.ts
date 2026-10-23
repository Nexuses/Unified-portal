import { NextResponse } from "next/server";
import { listCampaignSendsForExport } from "@/lib/campaign-blasts-server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";
import { buildCampaignReportTables } from "@/lib/campaign-report-tables";

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

    const hideBotClicks =
      new URL(request.url).searchParams.get("hideBotClicks") === "1";
    const sends = await listCampaignSendsForExport(
      found.projectId,
      found.campaign.id,
      found.campaign.kind,
    );
    return NextResponse.json(
      buildCampaignReportTables({
        campaignName: found.campaign.name,
        timezone: found.campaign.timezone || "Asia/Kolkata",
        sentAt: found.campaign.sentAt,
        sends,
        hideBotClicks,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to load public campaign report table:", error);
    return NextResponse.json({ error: "Failed to load the report table" }, { status: 500 });
  }
}
