import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { createBot, listBots } from "@/lib/ai-bots-server";
import { boatConfigured } from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const bots = await listBots(new ObjectId(session.projectId), session.id);
    return NextResponse.json({ bots, computerReady: boatConfigured() });
  } catch (error) {
    console.error("[bots] list failed:", error);
    return NextResponse.json({ error: "Could not load bots" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ bot: await createBot(new ObjectId(session.projectId), body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the bot" }, { status: 400 });
  }
}
