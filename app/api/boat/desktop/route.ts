import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { boatConfigured, ensureProjectBoat, isBoatRunning, openBoatDesktop } from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 60;

/** Fresh desktop URL for this project's Boat computer. URLs expire in about 10 minutes. */
export async function POST() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    if (!boatConfigured()) {
      return NextResponse.json(
        { error: "Boat is not set up. Add BOAT_API_KEY on the server." },
        { status: 503 },
      );
    }
    const sandbox = await ensureProjectBoat(new ObjectId(session.projectId));
    if (!isBoatRunning(sandbox.state)) {
      return NextResponse.json(
        { error: `The computer is ${sandbox.state}. Try again in a few seconds.`, state: sandbox.state },
        { status: 409 },
      );
    }
    const desktopUrl = await openBoatDesktop(sandbox.id);
    return NextResponse.json({
      sandboxId: sandbox.id,
      name: sandbox.name,
      state: sandbox.state,
      desktopUrl,
    });
  } catch (error) {
    console.error("Boat desktop failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open the computer" },
      { status: 500 },
    );
  }
}
