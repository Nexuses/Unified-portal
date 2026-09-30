import { NextResponse } from "next/server";
import { getSessionAdmin, type SessionAdmin } from "@/lib/auth";

export async function requireAdminSession(): Promise<
  SessionAdmin | NextResponse
> {
  const admin = await getSessionAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return admin;
}

export function isAdminSessionError(
  value: SessionAdmin | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
