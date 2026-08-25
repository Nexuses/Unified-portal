import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectSender, sendProjectTestEmail } from "@/lib/smtp-senders-server";
import { injectCampaignTracking, trackingOrigin } from "@/lib/campaign-tracking";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json()) as {
      senderId?: string;
      to?: string[];
      subject?: string;
      html?: string;
      fromName?: string;
      replyTo?: string;
    };

    const to = Array.isArray(body.to) ? body.to : [];
    if (!body.senderId) {
      return NextResponse.json({ error: "Select a sender first." }, { status: 400 });
    }

    const projectId = new ObjectId(session.projectId);
    const sender = ObjectId.isValid(body.senderId)
      ? await getProjectSender(projectId, new ObjectId(body.senderId))
      : null;
    const html = injectCampaignTracking(
      body.html ?? "",
      trackingOrigin(sender?.trackingDomain),
      `test-${Date.now()}`,
    );

    const result = await sendProjectTestEmail(projectId, {
      senderId: body.senderId,
      to,
      subject: body.subject ?? "",
      html,
      fromName: body.fromName,
      replyTo: body.replyTo,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send test email";
    console.error("Failed to send test email:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
