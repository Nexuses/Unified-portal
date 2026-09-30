import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createAdminApiKey,
  listAdminApiKeys,
} from "@/lib/api-keys-server";
import {
  isAdminSessionError,
  requireAdminSession,
} from "@/lib/require-admin-session";

export async function GET() {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const keys = await listAdminApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("Failed to list admin API keys:", error);
    return NextResponse.json(
      { error: "Failed to list API keys" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name : "";

    try {
      const created = await createAdminApiKey({
        createdBy: new ObjectId(admin.id),
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
    console.error("Failed to create admin API key:", error);
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 },
    );
  }
}
