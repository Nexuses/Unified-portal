import { eventPublicUrl } from "@/lib/event-public-url";
import { isSharedSessionFormat } from "@/lib/event-format";
import { buildCalendarInviteUid } from "@/lib/calendar-invite-uid";
import type { EventDocument } from "@/lib/events";
import { sendSubmissionInviteEmail } from "@/lib/invite-email";
import { getSubmissionByIdForEvent, markSubmissionInviteSent } from "@/lib/submissions";

export async function sendSubmissionInviteForEvent(
  event: EventDocument & { id: string; publicId: string },
  submissionId: string,
  options?: { customMessage?: string; useEventBanner?: boolean }
) {
  const submission = await getSubmissionByIdForEvent(event.id, submissionId);
  if (!submission) {
    throw new Error("Submission not found.");
  }

  const isSharedSession = isSharedSessionFormat(event.eventFormat);
  const calendarInviteUid = isSharedSession
    ? submission.calendarInviteUid ?? buildCalendarInviteUid(event.publicId, submissionId)
    : undefined;

  await sendSubmissionInviteEmail(
    event,
    {
      name: submission.name,
      email: submission.email,
    },
    "reminder",
    {
      eventDate: submission.calendarEventDate ?? event.eventDate,
      eventTimeStart: submission.calendarEventTimeStart ?? event.eventTimeStart,
      eventTimeEnd: submission.calendarEventTimeEnd ?? event.eventTimeEnd,
      platform: submission.calendarPlatform ?? event.platform,
      platformLink: submission.calendarPlatformLink ?? event.platformLink ?? "",
    },
    isSharedSession
      ? {
          acceptInviteUrl: `${eventPublicUrl(event.publicId)}/accept-invite?sid=${submissionId}`,
          calendarInviteUid,
          customMessage: options?.customMessage,
          viewerTimeZone: submission.viewerTimeZone ?? null,
          fromInviteRoute: true,
          useEventBanner: options?.useEventBanner,
        }
      : {
          calendarInviteUid,
          customMessage: options?.customMessage,
          viewerTimeZone: submission.viewerTimeZone ?? null,
          fromInviteRoute: true,
          useEventBanner: options?.useEventBanner,
        }
  );

  const updated = await markSubmissionInviteSent(event.id, submissionId, calendarInviteUid);
  return {
    inviteSentAt: updated?.inviteSentAt?.toISOString() ?? new Date().toISOString(),
  };
}
