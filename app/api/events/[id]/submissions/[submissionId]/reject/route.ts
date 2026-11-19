import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { rejectWaitlistSubmission } from "@/lib/submissions";
import { getEventById } from "@/lib/events";
import { sendSubmissionInviteEmail } from "@/lib/invite-email";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";

type RouteContext = {
  params: Promise<{ id: string; submissionId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { id, submissionId } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const updated = await rejectWaitlistSubmission(id, submissionId);
    if (!updated) {
      return NextResponse.json({ message: "Submission not found." }, { status: 404 });
    }

    const event = await getEventById(id);
    if (event) {
      try {
        await sendSubmissionInviteEmail(
          event,
          {
            name: updated.name,
            email: updated.email,
          },
          "waitlist_rejection",
          {
            eventDate: updated.calendarEventDate ?? event.eventDate,
            eventTimeStart: updated.calendarEventTimeStart ?? event.eventTimeStart,
            eventTimeEnd: updated.calendarEventTimeEnd ?? event.eventTimeEnd,
            platform: updated.calendarPlatform ?? event.platform,
            platformLink: updated.calendarPlatformLink ?? event.platformLink ?? "",
          },
          { viewerTimeZone: updated.viewerTimeZone, submissionId }
        );
      } catch (emailError) {
        console.error("Failed to send waitlist rejection email:", emailError);
      }
    }

    await revalidateEventPagesByEventId(id);
    return NextResponse.json(
      {
        message: "Registrant rejected.",
        waitlistStatus: "rejected",
        waitlistRejectedAt:
          updated.waitlistRejectedAt?.toISOString() ?? new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reject registrant.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
