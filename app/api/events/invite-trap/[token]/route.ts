import { NextResponse } from "next/server";
import { PUBLIC_APP_ORIGIN } from "@/lib/campaign-tracking";
import { markSubmissionBotClick } from "@/lib/invite-trap";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    await markSubmissionBotClick(token);
  } catch (error) {
    console.error("Invite trap click failed:", error);
  }
  return NextResponse.redirect(`${PUBLIC_APP_ORIGIN}/nxs-click-trap`, 302);
}
