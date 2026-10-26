import { NextResponse } from "next/server";
import { getPublicContactByShareToken } from "@/lib/crm-contacts-server";
import { getProjectBranding } from "@/lib/project-branding";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const found = await getPublicContactByShareToken(token);
    if (!found) {
      return new NextResponse(null, { status: 404 });
    }

    const branding = await getProjectBranding(found.projectId);
    const logoUrl = branding.logoUrl?.trim() || "";
    if (!/^https?:\/\//i.test(logoUrl)) {
      return new NextResponse(null, { status: 404 });
    }

    const response = await fetch(logoUrl, {
      cache: "no-store",
      headers: { Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return new NextResponse(null, { status: 404 });
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > 6_000_000) {
      return new NextResponse(null, { status: 404 });
    }
    const contentType = response.headers.get("content-type") || "image/png";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType.startsWith("image/")
          ? contentType
          : "image/png",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error) {
    console.error("Public project logo failed:", error);
    return new NextResponse(null, { status: 500 });
  }
}
