import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import {
  ensureProjectLeadReportsShare,
  LEAD_REPORTS_SHARE_TTL_DAYS,
  leadReportsShareExpiresAt,
} from "@/lib/lead-reports-share-server";
import { publicLeadReportsPath } from "@/lib/portal-nav";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    let columns: string[] | undefined;
    try {
      const body = (await request.json()) as { columns?: unknown };
      if (Array.isArray(body.columns)) {
        columns = body.columns.filter((value): value is string => typeof value === "string");
      }
    } catch {
      columns = undefined;
    }

    const share = await ensureProjectLeadReportsShare(
      new ObjectId(session.projectId),
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      {
        title: "Lead reports",
        columns,
      },
    );
    const url = `${requestOrigin(request.url, request.headers)}${publicLeadReportsPath(share.token)}`;
    return NextResponse.json(
      {
        token: share.token,
        url,
        columns: share.columns,
        expiresAt: leadReportsShareExpiresAt(share).toISOString(),
        ttlDays: LEAD_REPORTS_SHARE_TTL_DAYS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to create lead reports share:", error);
    return NextResponse.json(
      { error: "Failed to create public URL" },
      { status: 500 },
    );
  }
}
