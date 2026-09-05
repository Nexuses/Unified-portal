import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getSessionUserFromApiKey } from "@/lib/api-keys-server";

export async function requirePortalSession(): Promise<
  SessionUser | NextResponse
> {
  const cookieUser = await getSessionUser();
  if (cookieUser) {
    return cookieUser;
  }

  const headerStore = await headers();
  const apiUser = await getSessionUserFromApiKey(
    headerStore.get("authorization"),
  );
  if (apiUser) {
    return apiUser;
  }

  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export function isSessionError(
  value: SessionUser | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
