import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  launchCampaignBlast,
  requestOrigin,
} from "@/lib/campaign-blasts-server";
import { mergeBlastReport, type DripCampaign } from "@/lib/drip-campaigns";
import {
  getProjectDripCampaign,
  updateProjectDripCampaign,
} from "@/lib/drip-campaigns-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";
import { emitWebhookEventBackground } from "@/lib/webhooks-server";

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json()) as {
      campaign?: DripCampaign;
      mode?: "now" | "later";
      scheduledFor?: string;
    };

    if (!body.campaign) {
      return NextResponse.json({ error: "Campaign is required." }, { status: 400 });
    }
    if (body.mode !== "now" && body.mode !== "later") {
      return NextResponse.json({ error: "Choose send now or schedule." }, { status: 400 });
    }

    const projectId = new ObjectId(session.projectId);
    const kind = body.campaign.kind === "oneone" ? "oneone" : "drip";
    const existing = await getProjectDripCampaign(projectId, body.campaign.id, kind);
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    // Never trust a cross-kind client payload — lock id + kind to the DB row.
    const campaign: DripCampaign = {
      ...existing,
      ...body.campaign,
      id: existing.id,
      kind,
    };

    const report = await launchCampaignBlast({
      projectId,
      campaign,
      mode: body.mode,
      scheduledFor: body.scheduledFor,
      origin: requestOrigin(request.url, request.headers),
    });

    const launched = mergeBlastReport(campaign, report);
    const updated = await updateProjectDripCampaign(
      projectId,
      existing.id,
      launched,
      kind,
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update campaign after launch." },
        { status: 500 },
      );
    }

    emitWebhookEventBackground({
      projectId,
      type: "campaign.launched",
      data: {
        campaignId: existing.id,
        kind,
        name: campaign.name,
        mode: body.mode,
        status: report.status,
        recipients: report.recipients,
        scheduledFor: report.scheduledFor,
      },
    });

    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to launch campaign";
    console.error("Failed to launch campaign:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
