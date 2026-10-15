import { NextRequest, NextResponse } from "next/server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";
import { getPitchResearchJob } from "@/lib/pitch-research-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const { id } = await context.params;
  const job = await getPitchResearchJob(session.projectId, id);
  if (!job) return NextResponse.json({ error: "Research not found" }, { status: 404 });
  return NextResponse.json({ job });
}
