import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { CreateEventForm } from "@/components/create-event-form";
import { eventFormatLabel, isSharedSessionFormat, normalizeEventFormat } from "@/lib/event-format";
import { getEventById } from "@/lib/events";
import { normalizeTimeInput, toWallDateYmd } from "@/lib/public-event-time";
import {
  DEFAULT_ONE_TO_ONE_HORIZON_DAYS,
  DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES,
  DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS,
  deriveWeeklyHoursFromLegacyEvent,
  normalizeWeeklyHours,
} from "@/lib/one-to-one-weekly-hours";
import { normalizeEventCalendarsArray } from "@/lib/normalize-event-calendars";

type EditEventPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: EditEventPageProps) {
  const { id } = await params;
  const session = await getSessionUser();
  if (!session) {
    redirect("/login");
  }
  const event = await getEventById(id, session.projectId);

  if (!event) {
    notFound();
  }

  const eventFormat = normalizeEventFormat(event.eventFormat);
  const isWebinar = isSharedSessionFormat(eventFormat);
  const weeklyHours =
    Array.isArray(event.oneToOneWeeklyHours) && event.oneToOneWeeklyHours.length > 0
      ? normalizeWeeklyHours(event.oneToOneWeeklyHours)
      : deriveWeeklyHoursFromLegacyEvent({
          eventTimeStart: event.eventTimeStart,
          eventTimeEnd: event.eventTimeEnd,
          eventCalendars: normalizeEventCalendarsArray(event.eventCalendars),
        });

  return (
    <>
      <div className="crm-page-head drip-page-head">
        <div className="drip-detail-title-wrap">
          <Link href={`/portal/marketing/events/${id}`} className="drip-back" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h2>{event.eventName}</h2>
            <p>{eventFormatLabel(eventFormat)}</p>
          </div>
        </div>
      </div>

      <div className="event-workspace is-plain">
      <CreateEventForm
        key={`${id}:${event.eventDate}:${event.eventTimeStart}:${event.eventTimeEnd}:${eventFormat}`}
        mode="edit"
        eventId={id}
        initialData={{
          eventFormat,
          projectName: event.projectName,
          eventName: event.eventName,
          senderId: event.senderId ?? "",
          senderName: event.senderName ?? "",
          senderEmail: event.senderEmail ?? "",
          replyToEmail: event.replyToEmail ?? "",
          inviteSenderId: event.inviteSenderId ?? "",
          inviteSenderName: event.inviteSenderName ?? "",
          inviteSenderEmail: event.inviteSenderEmail ?? "",
          inviteReplyToEmail: event.inviteReplyToEmail ?? "",
          calendarInviteAgenda: event.calendarInviteAgenda ?? "",
          eventBanner: event.eventBanner,
          emailIncludeEventBanner: event.emailIncludeEventBanner !== false,
          publicHeaderLogo: event.publicHeaderLogo ?? "",
          eventDate: toWallDateYmd(event.eventDate),
          oneToOneBookingEndDate: event.oneToOneBookingEndDate ?? "",
          oneToOneWeeklyHours: weeklyHours,
          oneToOneBookingHorizonDays:
            typeof event.oneToOneBookingHorizonDays === "number" &&
            event.oneToOneBookingHorizonDays > 0
              ? event.oneToOneBookingHorizonDays
              : DEFAULT_ONE_TO_ONE_HORIZON_DAYS,
          oneToOneMinNoticeDays:
            typeof event.oneToOneMinNoticeDays === "number" && event.oneToOneMinNoticeDays >= 0
              ? event.oneToOneMinNoticeDays
              : DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS,
          oneToOneMeetingDurationMinutes:
            typeof event.oneToOneMeetingDurationMinutes === "number" &&
            event.oneToOneMeetingDurationMinutes >= 15
              ? event.oneToOneMeetingDurationMinutes
              : DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES,
          eventTimeStart: normalizeTimeInput(event.eventTimeStart),
          eventTimeEnd: normalizeTimeInput(event.eventTimeEnd),
          platform: event.platform,
          platformLink: event.platformLink ?? "",
          ownerName: isWebinar ? "" : (event.ownerName ?? ""),
          ownerEmail: isWebinar ? "" : (event.ownerEmail ?? ""),
          sameDayTimeSlots: [],
          eventCalendars: [],
          registrationTitle: event.registrationTitle,
          companyLogo: event.companyLogo,
          companyName: event.companyName,
          hostContact: event.hostContact,
          aboutEvent: event.aboutEvent,
          scheduleHeading: event.scheduleHeading ?? "",
          scheduleDurationMinutes:
            typeof event.scheduleDurationMinutes === "number" &&
            Number.isFinite(event.scheduleDurationMinutes) &&
            event.scheduleDurationMinutes >= 1
              ? Math.min(10080, Math.floor(event.scheduleDurationMinutes))
              : 90,
          scheduleParts: event.scheduleParts,
          hosts: event.hosts,
          eventMoreDetails: event.eventMoreDetails,
          hashTags:
            Array.isArray(event.hashTags) && event.hashTags.length > 0
              ? event.hashTags
              : [event.hashTagOne ?? "", event.hashTagTwo ?? ""].filter(Boolean),
          registerNowText: event.registerNowText,
          registerLink: event.registerLink,
          whyTitle: event.whyTitle,
          whyContent: event.whyContent,
          questionTitle: event.questionTitle,
          questions: event.questions.map((question) => ({ question })),
          aboutWhy: event.aboutWhy,
          endLine: event.endLine,
          emailFlows: event.emailFlows ?? {},
        }}
      />
      </div>
    </>
  );
}