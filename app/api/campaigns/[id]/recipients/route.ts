import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  isCampaignRecipientFilter,
  listCampaignSendRecipients,
} from "@/lib/campaign-blasts-server";
import { parseCampaignKind } from "@/lib/drip-campaigns";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

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
    const filter = String(request.nextUrl.searchParams.get("filter") ?? "audience");
    if (!isCampaignRecipientFilter(filter)) {
      return NextResponse.json({ error: "Invalid recipient filter" }, { status: 400 });
    }

    const sequenceRaw = request.nextUrl.searchParams.get("sequence");
    const sequenceIndex =
      sequenceRaw == null || sequenceRaw === "" ? undefined : Number(sequenceRaw);
    if (
      sequenceIndex !== undefined &&
      (!Number.isInteger(sequenceIndex) || sequenceIndex < 0)
    ) {
      return NextResponse.json({ error: "Invalid sequence" }, { status: 400 });
    }

    const recipients = await listCampaignSendRecipients(
      new ObjectId(session.projectId),
      id,
      filter,
      kind,
      {
        sequenceIndex,
        uniqueContacts: request.nextUrl.searchParams.get("unique") === "1",
      },
    );

    return NextResponse.json(recipients, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to list campaign recipients:", error);
    return NextResponse.json(
      { error: "Failed to load recipients" },
      { status: 500 },
    );
  }
}
