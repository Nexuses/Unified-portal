import { NextRequest, NextResponse } from "next/server";
import { recordCampaignClick, requestOrigin } from "@/lib/campaign-blasts-server";
import { clientMetaFromHeaders } from "@/lib/engagement-client-meta";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const target = request.nextUrl.searchParams.get("u") || "";

  let redirectTo = "";
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      redirectTo = parsed.toString();
    }
  } catch {
    redirectTo = "";
  }

  if (token && !token.startsWith("test-") && redirectTo) {
    await recordCampaignClick(
      token,
      redirectTo,
      clientMetaFromHeaders(request.headers),
    ).catch(() => undefined);
  }

  const fallback = `${requestOrigin(request.url, request.headers)}/`;
  return NextResponse.redirect(redirectTo || fallback, { status: 302 });
}
