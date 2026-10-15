import { NextRequest, NextResponse } from "next/server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";
import { getPitchResearchJob, pitchResearchWorkbook } from "@/lib/pitch-research-server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const { id } = await context.params;
  const job = await getPitchResearchJob(session.projectId, id);
  if (!job) return NextResponse.json({ error: "Research not found" }, { status: 404 });

  const buffer = await pitchResearchWorkbook(job);
  const stamp = job.createdAt.slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pitch-research-${stamp}.xlsx"`,
    },
  });
}
