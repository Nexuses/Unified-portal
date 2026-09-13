import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectDripCampaign,
  deleteProjectDripCampaigns,
  listProjectDripCampaigns,
} from "@/lib/drip-campaigns-server";
import { parseCampaignKind } from "@/lib/drip-campaigns";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const kindParam = request.nextUrl.searchParams.get("kind");
    const kind =
      kindParam === "oneone" ? "oneone" : kindParam === "drip" ? "drip" : undefined;
    const updatedSinceParam = request.nextUrl.searchParams.get("updatedSince");
    const updatedSince = updatedSinceParam
      ? new Date(updatedSinceParam)
      : undefined;
    if (
      updatedSinceParam &&
      (!updatedSince || Number.isNaN(updatedSince.getTime()))
    ) {
      return NextResponse.json(
        { error: "updatedSince must be a valid ISO date" },
        { status: 400 },
      );
    }

    const campaigns = await listProjectDripCampaigns(
      new ObjectId(session.projectId),
      kind,
      { updatedSince },
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

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      kind?: string;
      autoNumber?: boolean;
    };
    const name = String(body.name ?? "").trim();
    const kind = body.kind === "oneone" ? "oneone" : "drip";
    const autoNumber = Boolean(body.autoNumber);
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
      kind,
      { autoNumber },
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

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const kind = parseCampaignKind(request.nextUrl.searchParams.get("kind"));
    const body = await request.json();
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id: unknown) => String(id))
      : [];

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "No campaigns selected" },
        { status: 400 },
      );
    }

    const result = await deleteProjectDripCampaigns(
      new ObjectId(session.projectId),
      ids,
      kind,
    );
    return NextResponse.json({ deleted: result.deleted }, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to delete campaigns:", error);
    return NextResponse.json(
      { error: "Failed to delete campaigns" },
      { status: 500 },
    );
  }
}
