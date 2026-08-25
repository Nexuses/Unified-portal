import { NextRequest, NextResponse } from "next/server";
import { getCampaignSendByToken } from "@/lib/campaign-blasts-server";
import { unsubscribeSend } from "@/lib/unsubscribe-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const send = await getCampaignSendByToken(token);
    if (!send) {
      return NextResponse.json({ error: "Unsubscribe link is invalid." }, { status: 404 });
    }

    const result = await unsubscribeSend(send);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to unsubscribe:", error);
    return NextResponse.json(
      { error: "Failed to unsubscribe" },
      { status: 400 },
    );
  }
}
