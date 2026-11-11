import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  createCloudCampaign,
  listCloudCampaigns,
} from "@/lib/cloud-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const campaigns = await listCloudCampaigns(new ObjectId(session.projectId));
    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("List cloud campaigns failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load campaigns" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const campaign = await createCloudCampaign(
      new ObjectId(session.projectId),
      String(body?.name ?? "").trim() || "Cloud campaign",
    );
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Create cloud campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create campaign" },
      { status: 400 },
    );
  }
}
