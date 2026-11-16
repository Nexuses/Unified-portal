import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  BOAT_MEMORY_INSTRUCTIONS_MAX,
  getProjectBoatMemory,
  patchProjectBoatMemory,
  type BoatMemoryDefaults,
} from "@/lib/boat-memory";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const memory = await getProjectBoatMemory(new ObjectId(session.projectId));
    return NextResponse.json({ memory });
  } catch (error) {
    console.error("Boat memory GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load computer memory" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as {
      instructions?: string;
      defaults?: BoatMemoryDefaults;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const patch: {
      instructions?: string;
      defaults?: BoatMemoryDefaults;
      updatedBy?: string;
    } = {
      updatedBy: session.email || undefined,
    };

    if (typeof body.instructions === "string") {
      if (body.instructions.length > BOAT_MEMORY_INSTRUCTIONS_MAX + 200) {
        return NextResponse.json(
          { error: `Instructions must be under ${BOAT_MEMORY_INSTRUCTIONS_MAX} characters` },
          { status: 400 },
        );
      }
      patch.instructions = body.instructions;
    }

    if (body.defaults && typeof body.defaults === "object") {
      const defaults: BoatMemoryDefaults = {};
      if (body.defaults.preferredProvider === "gmail" || body.defaults.preferredProvider === "outlook") {
        defaults.preferredProvider = body.defaults.preferredProvider;
      }
      if (typeof body.defaults.defaultProfileId === "string") {
        defaults.defaultProfileId = body.defaults.defaultProfileId;
      }
      if (typeof body.defaults.notes === "string") {
        defaults.notes = body.defaults.notes;
      }
      patch.defaults = defaults;
    }

    if (patch.instructions === undefined && patch.defaults === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const memory = await patchProjectBoatMemory(new ObjectId(session.projectId), patch);
    return NextResponse.json({ memory });
  } catch (error) {
    console.error("Boat memory PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save computer memory" },
      { status: 500 },
    );
  }
}
