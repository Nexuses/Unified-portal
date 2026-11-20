import { NextRequest, NextResponse } from "next/server";
import { revalidateEventPages } from "@/lib/revalidate-dashboard";
import { eventPublicPath, resolvePublicOrigin } from "@/lib/event-public-url";
import { getEventByPublicId } from "@/lib/events";
import {
  acceptWebinarInviteByPublicId,
  acceptWebinarInviteBySubmissionId,
} from "@/lib/submissions";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

function redirectToEvent(request: NextRequest, publicId: string, query?: "going=1" | "accept-error=1") {
  const origin = resolvePublicOrigin(request);
  const path = query ? `${eventPublicPath(publicId)}?${query}` : eventPublicPath(publicId);
  return NextResponse.redirect(new URL(path, origin));
}

/**
 * Email "Accept invite" hits this GET. Confirm attendance immediately and send
 * the guest to the event page with the thank-you modal — no second Accept step.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { publicId } = await context.params;
  const sid = request.nextUrl.searchParams.get("sid")?.trim() ?? "";
  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";

  if (!sid && !email) {
    return redirectToEvent(request, publicId);
  }

  const event = await getEventByPublicId(publicId).catch((error) => {
    console.error("Accept invite: could not load event", publicId, error);
    return null;
  });
  if (!event || event.status !== "published") {
    return redirectToEvent(request, publicId, "accept-error=1");
  }

  try {
    if (sid) {
      await acceptWebinarInviteBySubmissionId(publicId, sid);
    } else {
      const decodedEmail = decodeURIComponent(email.replace(/ /g, "+"));
      await acceptWebinarInviteByPublicId(publicId, decodedEmail);
    }
  } catch (error) {
    console.error("Accept invite failed:", {
      publicId,
      sid: sid || undefined,
      email: email || undefined,
      error,
    });
    return redirectToEvent(request, publicId, "accept-error=1");
  }

  try {
    revalidateEventPages({ publicId });
  } catch (error) {
    console.error("Accept invite: revalidate failed after successful accept", publicId, error);
  }

  return redirectToEvent(request, publicId, "going=1");
}
