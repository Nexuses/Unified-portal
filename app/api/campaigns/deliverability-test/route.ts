import { NextRequest, NextResponse } from "next/server";
import { runDeliverabilityTest } from "@/lib/deliverability-test";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json()) as {
      senderId?: string;
      subject?: string;
      html?: string;
      fromName?: string;
      replyTo?: string;
      campaignName?: string;
      utmEnabled?: boolean;
      utmSourceEnabled?: boolean;
      utmSource?: string;
      utmMediumEnabled?: boolean;
      utmMedium?: string;
      utmCampaignEnabled?: boolean;
      utmCampaign?: string;
      openTrackingOff?: boolean;
      clickTrackingOff?: boolean;
    };

    if (!body.senderId) {
      return NextResponse.json(
        { error: "Select a sender first." },
        { status: 400 },
      );
    }
    if (!body.html?.trim()) {
      return NextResponse.json(
        { error: "Email HTML is empty." },
        { status: 400 },
      );
    }

    const report = await runDeliverabilityTest({
      projectId: session.projectId,
      senderId: body.senderId,
      subject: body.subject ?? "",
      html: body.html,
      fromName: body.fromName,
      replyTo: body.replyTo,
      campaignName: body.campaignName,
      utmEnabled: body.utmEnabled,
      utmSourceEnabled: body.utmSourceEnabled,
      utmSource: body.utmSource,
      utmMediumEnabled: body.utmMediumEnabled,
      utmMedium: body.utmMedium,
      utmCampaignEnabled: body.utmCampaignEnabled,
      utmCampaign: body.utmCampaign,
      openTrackingOff: body.openTrackingOff,
      clickTrackingOff: body.clickTrackingOff,
    });

    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Deliverability test failed";
    console.error("[deliverability-test]", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
