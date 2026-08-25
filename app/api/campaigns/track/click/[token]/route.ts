import { NextRequest, NextResponse } from "next/server";
import { recordCampaignClick } from "@/lib/campaign-blasts-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const target = request.nextUrl.searchParams.get("u") || "/";
  if (token && !token.startsWith("test-")) {
    await recordCampaignClick(token).catch(() => undefined);
  }

  let redirectTo = "/";
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      redirectTo = parsed.toString();
    }
  } catch {
    redirectTo = "/";
  }

  return NextResponse.redirect(redirectTo, { status: 302 });
}
