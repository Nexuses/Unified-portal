import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { duplicateCloudCampaign } from "@/lib/cloud-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const campaign = await duplicateCloudCampaign(new ObjectId(session.projectId), id);
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Duplicate cloud campaign failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not duplicate campaign",
      },
      { status: 400 },
    );
  }
}
