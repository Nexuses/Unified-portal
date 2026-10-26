import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NEXUSES_LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

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
    const contentType = response.headers.get("content-type") || "image/png";
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
