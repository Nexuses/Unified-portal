import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  ALL_PROJECTS_STATS_SHARE_TTL_DAYS,
  allProjectsStatsShareExpiresAt,
  createAllProjectsStatsShare,
} from "@/lib/all-projects-stats-share-server";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import { publicAllProjectsStatsPath } from "@/lib/portal-nav";
import {
  isAdminSessionError,
  requireAdminSession,
} from "@/lib/require-admin-session";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const share = await createAllProjectsStatsShare(
      ObjectId.isValid(admin.id) ? new ObjectId(admin.id) : null,
    );
    const url = `${requestOrigin(request.url, request.headers)}${publicAllProjectsStatsPath(share.token)}`;
    return NextResponse.json(
      {
        token: share.token,
        url,
        expiresAt: allProjectsStatsShareExpiresAt(share).toISOString(),
        ttlDays: ALL_PROJECTS_STATS_SHARE_TTL_DAYS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to create all-projects stats share:", error);
    return NextResponse.json(
      { error: "Failed to create public URL" },
      { status: 500 },
    );
  }
}
