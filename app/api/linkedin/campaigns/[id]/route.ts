import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  addLinkedinStage,
  getLinkedinCampaign,
  moveLinkedinContact,
  processDueLinkedinMessages,
  setLinkedinCampaignPaused,
} from "@/lib/linkedin-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await context.params;
    await processDueLinkedinMessages().catch((error) => {
      console.error("LinkedIn follow-up check failed:", error);
    });
    const campaign = await getLinkedinCampaign(new ObjectId(session.projectId), id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("LinkedIn campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the campaign" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await context.params;
    const projectId = new ObjectId(session.projectId);
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      label?: string;
      color?: string;
      contactId?: string;
      stage?: string;
    } | null;
    const campaign =
      body?.action === "pause" || body?.action === "resume"
        ? await setLinkedinCampaignPaused(projectId, id, body.action === "pause")
        : body?.action === "add-stage"
          ? await addLinkedinStage(projectId, id, String(body.label || ""), body.color)
          : body?.action === "move"
            ? await moveLinkedinContact(
                projectId,
                id,
                String(body.contactId || ""),
                String(body.stage || ""),
              )
            : null;
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("LinkedIn campaign update failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update the campaign" },
      { status: 400 },
    );
  }
}
