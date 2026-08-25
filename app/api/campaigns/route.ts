import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectDripCampaign,
  listProjectDripCampaigns,
} from "@/lib/drip-campaigns-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const campaigns = await listProjectDripCampaigns(
      new ObjectId(session.projectId),
    );
    return NextResponse.json(campaigns, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to list drip campaigns:", error);
    return NextResponse.json(
      { error: "Failed to load campaigns" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json()) as { name?: string };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json(
        { error: "Campaign name is required" },
        { status: 400 },
      );
    }

    const campaign = await createProjectDripCampaign(
      new ObjectId(session.projectId),
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      name,
    );

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create campaign";
    const status = message.includes("already exists") ? 409 : 400;
    console.error("Failed to create drip campaign:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
