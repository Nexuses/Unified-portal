import { NextResponse } from "next/server";
import { getEventByPublicId } from "@/lib/events";
import { recordEventPageView } from "@/lib/event-page-analytics";
import { resolveVisitorLocation } from "@/lib/visitor-location";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

function headerValue(request: Request, name: string) {
  return request.headers.get(name)?.trim() ?? "";
}

export async function POST(request: Request, context: RouteContext) {
  const { publicId } = await context.params;

  try {
    const event = await getEventByPublicId(publicId);
    if (!event || event.status !== "published") {
      return NextResponse.json({ message: "Event not found." }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      visitorId?: unknown;
      path?: unknown;
      referrer?: unknown;
      language?: unknown;
      timezone?: unknown;
      screen?: unknown;
    };

    const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
    if (!visitorId) {
      return NextResponse.json({ message: "visitorId is required." }, { status: 400 });
    }

    const timezone = typeof body.timezone === "string" ? body.timezone : "";
    const location = await resolveVisitorLocation({ request, timezone });

    await recordEventPageView({
      eventId: event.id,
      publicId: event.publicId,
      visitorId,
      path: typeof body.path === "string" ? body.path : `/${event.publicId}`,
      referrer: typeof body.referrer === "string" ? body.referrer : "",
      userAgent: headerValue(request, "user-agent"),
      language: typeof body.language === "string" ? body.language : "",
      timezone,
      screen: typeof body.screen === "string" ? body.screen : "",
      country: location.country,
      region: location.region,
      city: location.city,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record page view.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
