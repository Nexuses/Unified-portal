import { NextResponse } from "next/server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";

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

    return NextResponse.json(found.campaign, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load public campaign report:", error);
    return NextResponse.json(
      { error: "Failed to load report" },
      { status: 500 },
    );
  }
}
