import { NextResponse } from "next/server";
import { eventPublicUrl } from "@/lib/event-public-url";
import { isSharedSessionFormat, isWebinarFormat } from "@/lib/event-format";
import { buildCalendarInviteUid } from "@/lib/calendar-invite-uid";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { getEventById } from "@/lib/events";
import { sendSubmissionInviteEmail } from "@/lib/invite-email";
import { getReminderCandidates, markReminderSent } from "@/lib/submissions";

function parseIstDateTime(date: string, time: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) {
    return null;
  }
  const utcMs = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    Number(t[1]) - 5,
    Number(t[2]) - 30,
    0
  );
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt;
}

async function runReminderDispatch(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const now = new Date();
    const candidates = await getReminderCandidates(300);
    let sentCount = 0;

    for (const submission of candidates) {
      const submissionId = submission._id?.toString();
      if (!submissionId) {
        continue;
      }
      const event = await getEventById(submission.eventId.toString());
      if (!event) {
        continue;
      }
      const slotDate = submission.calendarEventDate ?? event.eventDate;
      const slotStart = submission.calendarEventTimeStart ?? event.eventTimeStart;
      const slotEnd = submission.calendarEventTimeEnd ?? event.eventTimeEnd;
      const slotPlatform = submission.calendarPlatform ?? event.platform;
      const slotPlatformLink = submission.calendarPlatformLink ?? event.platformLink ?? "";
      const isSharedSession = isSharedSessionFormat(event.eventFormat);
      const isOpenWebinar = isWebinarFormat(event.eventFormat);
      const calendarInviteUid = isSharedSession
        ? submission.calendarInviteUid ?? buildCalendarInviteUid(event.publicId, submissionId)
        : undefined;
      const inviteOptions = isOpenWebinar
        ? {
            acceptInviteUrl: `${eventPublicUrl(event.publicId)}/accept-invite?sid=${submissionId}`,
            calendarInviteUid,
            viewerTimeZone: submission.viewerTimeZone ?? null,
            submissionId,
          }
        : {
            calendarInviteUid,
            viewerTimeZone: submission.viewerTimeZone ?? null,
            submissionId,
          };
      const eventStart = parseIstDateTime(slotDate, slotStart);
      if (!eventStart) {
        continue;
      }

      const oneDayBefore = new Date(eventStart.getTime() - 24 * 60 * 60 * 1000);
      const oneHourBefore = new Date(eventStart.getTime() - 60 * 60 * 1000);

      if (
        (submission.reminderDayEnabled ?? true) &&
        !submission.reminderDaySentAt &&
        now >= oneDayBefore
      ) {
        await sendSubmissionInviteEmail(
          event,
          { name: submission.name, email: submission.email },
          "reminder",
          {
            eventDate: slotDate,
            eventTimeStart: slotStart,
            eventTimeEnd: slotEnd,
            platform: slotPlatform,
            platformLink: slotPlatformLink,
          },
          inviteOptions
        );
        await markReminderSent(submissionId, "day");
        sentCount += 1;
        continue;
      }

      if (
        (submission.reminderHourEnabled ?? true) &&
        !submission.reminderHourSentAt &&
        now >= oneHourBefore
      ) {
        await sendSubmissionInviteEmail(
          event,
          { name: submission.name, email: submission.email },
          "reminder",
          {
            eventDate: slotDate,
            eventTimeStart: slotStart,
            eventTimeEnd: slotEnd,
            platform: slotPlatform,
            platformLink: slotPlatformLink,
          },
          inviteOptions
        );
        await markReminderSent(submissionId, "hour");
        sentCount += 1;
      }
    }

    return NextResponse.json({ message: "Reminder dispatch complete.", sentCount });
  } catch {
    return NextResponse.json(
      { message: "Failed to dispatch reminders." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return runReminderDispatch(request);
}

export async function POST(request: Request) {
  return runReminderDispatch(request);
}
