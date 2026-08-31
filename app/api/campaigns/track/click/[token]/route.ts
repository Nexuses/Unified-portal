import { NextRequest, NextResponse } from "next/server";
import { recordCampaignClick } from "@/lib/campaign-blasts-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const target = request.nextUrl.searchParams.get("u") || "/";

  let redirectTo = "/";
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      redirectTo = parsed.toString();
    }
  } catch {
    redirectTo = "/";
  }

  if (token && !token.startsWith("test-")) {
    await recordCampaignClick(token, redirectTo).catch(() => undefined);
  }

  return NextResponse.redirect(redirectTo, { status: 302 });
}
