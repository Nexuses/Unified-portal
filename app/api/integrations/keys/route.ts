import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createProjectApiKey,
  listProjectApiKeys,
} from "@/lib/api-keys-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const keys = await listProjectApiKeys(new ObjectId(session.projectId));
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("Failed to list API keys:", error);
    return NextResponse.json(
      { error: "Failed to list API keys" },
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

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name : "";

    try {
      const created = await createProjectApiKey({
        projectId: new ObjectId(session.projectId),
        createdBy: new ObjectId(session.id),
        name,
      });
      return NextResponse.json(
        {
          key: created.key,
          rawKey: created.rawKey,
          warning:
            "Copy this API key now. You will not be able to see it again.",
        },
        { status: 201 },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create API key";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    console.error("Failed to create API key:", error);
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 },
    );
  }
}
