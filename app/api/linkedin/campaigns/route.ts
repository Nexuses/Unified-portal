import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteLinkedinCampaigns,
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
      listName?: string;
      fileName?: string;
      csv?: string;
      delayAfterAcceptDays?: number;
      delayAfterMessageDays?: number;
      sendDays?: number[];
      windowStart?: string;
      windowEnd?: string;
      timezone?: string;
    } | null;
    const userId = ObjectId.isValid(session.id) ? new ObjectId(session.id) : null;
    const started = await startLinkedinCampaign(
      new ObjectId(session.projectId),
      userId,
      body ?? {},
    );
    return NextResponse.json(started);
  } catch (error) {
    console.error("Start LinkedIn campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the campaign" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.map((id) => String(id)) : [];
    if (!ids.length) {
      return NextResponse.json({ error: "No campaigns selected" }, { status: 400 });
    }
    const result = await deleteLinkedinCampaigns(new ObjectId(session.projectId), ids);
    return NextResponse.json({ deleted: result.deleted });
  } catch (error) {
    console.error("Delete LinkedIn campaigns failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete campaigns" },
      { status: 500 },
    );
  }
}
