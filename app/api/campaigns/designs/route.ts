import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { listProjectCampaignDesigns } from "@/lib/drip-campaigns-server";
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

    const designs = await listProjectCampaignDesigns(
      new ObjectId(session.projectId),
    );
    return NextResponse.json({ designs }, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to list campaign designs:", error);
    return NextResponse.json(
      { error: "Failed to load saved designs" },
      { status: 500 },
    );
  }
}
