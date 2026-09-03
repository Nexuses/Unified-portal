import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  deleteProjectDripCampaign,
  getProjectDripCampaign,
  updateProjectDripCampaign,
} from "@/lib/drip-campaigns-server";
import type { DripCampaign } from "@/lib/drip-campaigns";
import { parseCampaignKind } from "@/lib/drip-campaigns";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const kind = parseCampaignKind(request.nextUrl.searchParams.get("kind"));
    const campaign = await getProjectDripCampaign(
      new ObjectId(session.projectId),
      id,
      kind,
    );

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json(campaign, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to fetch drip campaign:", error);
    return NextResponse.json(
      { error: "Failed to load campaign" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const kind = parseCampaignKind(request.nextUrl.searchParams.get("kind"));
    const body = (await request.json()) as Partial<DripCampaign>;
    const campaign = await updateProjectDripCampaign(
      new ObjectId(session.projectId),
      id,
      body,
      kind,
    );

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json(campaign, { headers: NO_STORE });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update campaign";
    const status = message.includes("already exists")
      ? 409
      : message.includes("required")
        ? 400
        : 500;
    console.error("Failed to update drip campaign:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    const kind = parseCampaignKind(request.nextUrl.searchParams.get("kind"));
    const deleted = await deleteProjectDripCampaign(
      new ObjectId(session.projectId),
      id,
      kind,
    );

    if (!deleted) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete drip campaign:", error);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 },
    );
  }
}
