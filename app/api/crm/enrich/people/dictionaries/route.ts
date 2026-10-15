import { NextResponse } from "next/server";
import { getRuntimeAliasBundles } from "@/lib/people/search-aliases";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";

/** Read-only synonym dictionaries for People search. */
export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) {
    return session;
  }

  const bundles = await getRuntimeAliasBundles();
  return NextResponse.json({
    jobTitle: bundles.jobTitle,
    department: bundles.department,
    industry: bundles.industry,
    jobTitleGroups: bundles.jobTitleGroups,
  });
}
