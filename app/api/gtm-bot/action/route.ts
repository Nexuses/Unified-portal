import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { BoatError } from "@/lib/boat";
import {
  getGtmBotStatus,
  openGtmBot,
  setGtmBotAlwaysOn,
  startGtmBot,
  stopGtmBot,
} from "@/lib/gtm-bot-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

// Setup creates a computer, installs software and waits for it to answer.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const projectId = new ObjectId(session.projectId);
  const body = (await request.json().catch(() => ({}))) as { action?: string; alwaysOn?: unknown };

  try {
    switch (body.action) {
      case "start":
        await startGtmBot(projectId, session.projectName || "gtm-bot");
        return NextResponse.json({ ok: true, status: await getGtmBotStatus(projectId) });
      case "stop":
        await stopGtmBot(projectId);
        return NextResponse.json({ ok: true, status: await getGtmBotStatus(projectId) });
      case "open":
        return NextResponse.json({
          ok: true,
          link: await openGtmBot(projectId, { id: session.id, fullName: session.fullName }),
        });
      case "always_on":
        await setGtmBotAlwaysOn(projectId, body.alwaysOn === true);
        return NextResponse.json({ ok: true, status: await getGtmBotStatus(projectId) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const status = error instanceof BoatError && error.status >= 400 && error.status < 500 ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GTM Bot action failed" },
      { status },
    );
  }
}
