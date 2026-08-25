import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export async function requirePortalSession(): Promise<
  SessionUser | NextResponse
> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return user;
}

export function isSessionError(
  value: SessionUser | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
