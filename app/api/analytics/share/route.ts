import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { AnalyticsRangeError, resolveAnalyticsShareExpiry } from "@/lib/analytics";
import { createAnalyticsShare } from "@/lib/analytics-server";
import { requestOrigin } from "@/lib/campaign-blasts-server";
import { publicAnalyticsPath } from "@/lib/portal-nav";
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

    const body = (await request.json().catch(() => null)) as
      | { from?: string; to?: string }
      | null;
    const from = String(body?.from ?? "").trim();
    const to = String(body?.to ?? "").trim();
    const share = await createAnalyticsShare(
      new ObjectId(session.projectId),
      session.projectName,
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      from,
      to,
    );
    const url = `${requestOrigin(request.url, request.headers)}${publicAnalyticsPath(share.token)}`;
    return NextResponse.json(
      {
        token: share.token,
        url,
        from: share.from,
        to: share.to,
        expiresAt: resolveAnalyticsShareExpiry(share).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to create analytics share link:", error);
    return NextResponse.json(
      { error: "Failed to create public URL" },
      { status: 500 },
    );
  }
}
