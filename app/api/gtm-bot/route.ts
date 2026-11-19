import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getGtmBotStatus } from "@/lib/gtm-bot-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 60;

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    return NextResponse.json(await getGtmBotStatus(new ObjectId(session.projectId)));
  } catch (error) {
    console.error("GTM Bot status failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read GTM Bot" },
      { status: 500 },
    );
  }
}
