import { NextRequest, NextResponse } from "next/server";
import {
  isCampaignRecipientFilter,
  listCampaignSendRecipients,
} from "@/lib/campaign-blasts-server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const found = await getDripCampaignByShareToken(token);
    if (!found) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const filter = String(request.nextUrl.searchParams.get("filter") ?? "audience");
    if (!isCampaignRecipientFilter(filter)) {
      return NextResponse.json({ error: "Invalid recipient filter" }, { status: 400 });
    }

    const recipients = await listCampaignSendRecipients(
      found.projectId,
      found.campaign.id,
      filter,
    );

    return NextResponse.json(
      recipients.map((recipient) => ({
        ...recipient,
        contactId: undefined,
      })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to list public campaign recipients:", error);
    return NextResponse.json(
      { error: "Failed to load contacts" },
      { status: 500 },
    );
  }
}
