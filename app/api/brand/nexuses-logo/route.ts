import { NextResponse } from "next/server";
import { NEXUSES_LOGO_URL } from "@/lib/nexuses-logo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const response = await fetch(NEXUSES_LOGO_URL, {
      cache: "force-cache",
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!response.ok) {
      return new NextResponse(null, { status: 404 });
    }
    const buffer = await response.arrayBuffer();
    const contentType =
      response.headers.get("content-type") || "image/svg+xml";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Nexuses logo fetch failed:", error);
    return new NextResponse(null, { status: 500 });
  }
}
