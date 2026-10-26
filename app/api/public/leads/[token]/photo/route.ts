import { NextResponse } from "next/server";
import { getPublicContactPhotoByToken } from "@/lib/crm-contacts-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const photo = await getPublicContactPhotoByToken(token);
    if (!photo) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(new Uint8Array(photo.buffer), {
      status: 200,
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Public lead photo failed:", error);
    return new NextResponse(null, { status: 500 });
  }
}
