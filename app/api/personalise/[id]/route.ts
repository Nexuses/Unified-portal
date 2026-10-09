import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPersonaliseCampaignSnapshot } from "@/lib/personalise-view";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const { id } = await context.params;
    const snapshot = await getPersonaliseCampaignSnapshot(new ObjectId(session.projectId), id);
    if (!snapshot) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load personalise campaign:", error);
    return NextResponse.json({ error: "Could not load the campaign." }, { status: 500 });
  }
}
