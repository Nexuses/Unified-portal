import { NextResponse } from "next/server";
import { pollCalendarRsvpInbox, processCalendarRsvpIcsPayload } from "@/lib/calendar-rsvp-inbox";
import { revalidateDashboardPages } from "@/lib/revalidate-dashboard";

function authorizeCron(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return true;
  }
  return request.headers.get("x-cron-secret") === secret;
}

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let manualProcessed = 0;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { ics?: string };
      if (body.ics?.trim()) {
        manualProcessed = await processCalendarRsvpIcsPayload(body.ics);
      }
    }

    const inboxResult = await pollCalendarRsvpInbox();
    if (manualProcessed > 0 || inboxResult.processed > 0) {
      revalidateDashboardPages();
    }

    return NextResponse.json({
      message: "Calendar RSVP sync complete.",
      manualProcessed,
      inboxProcessed: inboxResult.processed,
      inboxSkipped: inboxResult.skipped ?? false,
      inboxReason: inboxResult.reason ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar RSVP sync failed.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
