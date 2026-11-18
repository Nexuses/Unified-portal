import { NextResponse } from "next/server";
import { getPlatformStatusPage } from "@/lib/platform-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public status. No login. */
export async function GET() {
  const page = await getPlatformStatusPage();
  return NextResponse.json(page, {
    headers: { "Cache-Control": "no-store" },
  });
}
