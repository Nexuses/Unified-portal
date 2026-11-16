import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  listLinkedinCampaigns,
  startLinkedinCampaign,
} from "@/lib/linkedin-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const campaigns = await listLinkedinCampaigns(new ObjectId(session.projectId));
    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("List LinkedIn campaigns failed:", error);
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
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      csv?: string;
      delayAfterAcceptDays?: number;
      delayAfterMessageDays?: number;
    } | null;
    const started = await startLinkedinCampaign(new ObjectId(session.projectId), body ?? {});
    return NextResponse.json(started);
  } catch (error) {
    console.error("Start LinkedIn campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the campaign" },
      { status: 400 },
    );
  }
}
