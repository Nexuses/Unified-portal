import { NextResponse } from "next/server";
import { recordCampaignOpen } from "@/lib/campaign-blasts-server";
import { clientMetaFromHeaders } from "@/lib/engagement-client-meta";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (token && !token.startsWith("test-")) {
    await recordCampaignOpen(token, clientMetaFromHeaders(request.headers)).catch(
      () => undefined,
    );
  }

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
