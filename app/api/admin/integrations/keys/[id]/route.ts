import { NextResponse } from "next/server";
import { revokeAdminApiKey } from "@/lib/api-keys-server";
import {
  isAdminSessionError,
  requireAdminSession,
} from "@/lib/require-admin-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const { id } = await context.params;
    const revoked = await revokeAdminApiKey(id);
    if (!revoked) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to revoke admin API key:", error);
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 },
    );
  }
}
