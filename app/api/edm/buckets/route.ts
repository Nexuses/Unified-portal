import { NextResponse } from "next/server";
import { listProjectBuckets } from "@/lib/s3-edm";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const buckets = await listProjectBuckets(session.projectName);
    return NextResponse.json({ buckets, projectName: session.projectName });
  } catch (error) {
    console.error("Failed to list EDM buckets:", error);
    const message = error instanceof Error ? error.message : "Could not list buckets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
