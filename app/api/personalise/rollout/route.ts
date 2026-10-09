import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { rolloutPersonaliseCampaign } from "@/lib/personalise-rollout";
import type { PersonaliseRolloutInput } from "@/lib/personalise-rollout";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json()) as PersonaliseRolloutInput;
    const result = await rolloutPersonaliseCampaign({
      projectId: new ObjectId(session.projectId),
      userId: ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      body,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not roll out the campaign.";
    console.error("Failed to roll out personalise campaign:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
