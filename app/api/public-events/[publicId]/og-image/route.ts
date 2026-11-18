import { NextResponse } from "next/server";
import { getEventByPublicId } from "@/lib/events";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

function parseDataUrlImage(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

export async function GET(_: Request, context: RouteContext) {
  const { publicId } = await context.params;
  const event = await getEventByPublicId(publicId);

  if (!event || event.status !== "published") {
    return NextResponse.json({ message: "Image not found." }, { status: 404 });
  }

  const banner = (event.eventBanner || "").trim();

  if (banner.startsWith("data:image/")) {
    const parsed = parseDataUrlImage(banner);
    if (parsed) {
      return new NextResponse(parsed.bytes, {
        status: 200,
        headers: {
          "Content-Type": parsed.mimeType,
          "Cache-Control": "public, max-age=600, s-maxage=600",
        },
      });
    }
  }

  if (/^https?:\/\//i.test(banner)) {
    try {
      const response = await fetch(banner, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NexusesPreviewBot/1.0)",
        },
        cache: "no-store",
      });
      if (response.ok) {
        const contentType = response.headers.get("content-type") || "image/jpeg";
        const arrayBuffer = await response.arrayBuffer();
        return new NextResponse(arrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=600, s-maxage=600",
          },
        });
      }
    } catch {
      return NextResponse.json({ message: "Image not reachable." }, { status: 404 });
    }
    return NextResponse.json({ message: "Image not reachable." }, { status: 404 });
  }

  return NextResponse.json({ message: "Unsupported banner source." }, { status: 400 });
}
