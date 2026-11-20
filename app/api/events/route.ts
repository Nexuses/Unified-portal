import { NextResponse } from "next/server";
import { requireEventSession } from "@/lib/event-api-guard";
import { connectedSenderEmail } from "@/lib/event-sender-mail";
import { normalizeEventFormat } from "@/lib/event-format";
import { normalizeEventEmailFlows } from "@/lib/event-email-flows";
import { normalizeEventPlatform, resolveMeetingLink } from "@/lib/event-platform";
import { createEvent, getAllEvents } from "@/lib/events";
import { ensureEventRegistrationList } from "@/lib/event-registration-list";
import { normalizeWeeklyHours } from "@/lib/one-to-one-weekly-hours";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";

export async function GET() {
  const session = await requireEventSession();
  if (session instanceof NextResponse) {
    return session;
  }
  try {
    const events = await getAllEvents(session.projectId);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ message: "Failed to load events." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireEventSession();
  if (session instanceof NextResponse) {
    return session;
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const senderId = String(body.senderId ?? "").trim();
    const inviteSenderId = String(body.inviteSenderId ?? "").trim();
    const senderEmail = await connectedSenderEmail(session.projectId, senderId);
    if (!senderEmail) {
      return NextResponse.json(
        { message: "Select a connected sender for invite emails." },
        { status: 400 },
      );
    }
    const inviteSenderEmail = inviteSenderId
      ? await connectedSenderEmail(session.projectId, inviteSenderId)
      : "";
    if (inviteSenderId && !inviteSenderEmail) {
      return NextResponse.json(
        { message: "The calendar sender is disconnected." },
        { status: 400 },
      );
    }

    const eventId = await createEvent({
      projectId: session.projectId,
      projectName: session.projectName,
      eventName: String(body.eventName ?? ""),
      senderId,
      senderName: String(body.senderName ?? ""),
      senderEmail,
      replyToEmail: String(body.replyToEmail ?? "").trim(),
      inviteSenderId: inviteSenderId || senderId,
      inviteSenderName: String(body.inviteSenderName ?? ""),
      inviteSenderEmail: inviteSenderEmail || senderEmail,
      inviteReplyToEmail: String(body.inviteReplyToEmail ?? "").trim(),
      calendarInviteAgenda: String(body.calendarInviteAgenda ?? ""),
      eventBanner: String(body.eventBanner ?? ""),
      emailBannerUrl: String(body.emailBannerUrl ?? "").trim(),
      emailIncludeEventBanner: body.emailIncludeEventBanner !== false,
      customTrackingEnabled: body.customTrackingEnabled === true,
      publicHeaderLogo: String(body.publicHeaderLogo ?? ""),
      eventDate: String(body.eventDate ?? ""),
      oneToOneBookingEndDate: String(body.oneToOneBookingEndDate ?? ""),
      oneToOneWeeklyHours: Array.isArray(body.oneToOneWeeklyHours)
        ? normalizeWeeklyHours(body.oneToOneWeeklyHours)
        : undefined,
      oneToOneBookingHorizonDays: (() => {
        const n = Number(body.oneToOneBookingHorizonDays);
        return Number.isFinite(n) && n > 0 ? Math.min(365, Math.floor(n)) : undefined;
      })(),
      oneToOneMinNoticeDays: (() => {
        const n = Number(body.oneToOneMinNoticeDays);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
      })(),
      oneToOneMeetingDurationMinutes: (() => {
        const n = Number(body.oneToOneMeetingDurationMinutes);
        return Number.isFinite(n) && n >= 15 ? Math.min(240, Math.floor(n)) : undefined;
      })(),
      eventTimeStart: String(body.eventTimeStart ?? ""),
      eventTimeEnd: String(body.eventTimeEnd ?? ""),
      platform: normalizeEventPlatform(body.platform),
      platformLink: resolveMeetingLink(body.platform, body.platformLink),
      ownerName: String(body.ownerName ?? ""),
      ownerEmail: String(body.ownerEmail ?? ""),
      eventCalendars: Array.isArray(body.eventCalendars)
        ? body.eventCalendars.map((item) => ({
            eventDate: String((item as { eventDate?: string }).eventDate ?? ""),
            eventTimeStart: String((item as { eventTimeStart?: string }).eventTimeStart ?? ""),
            eventTimeEnd: String((item as { eventTimeEnd?: string }).eventTimeEnd ?? ""),
            platform: normalizeEventPlatform((item as { platform?: string }).platform),
            platformLink: String((item as { platformLink?: string }).platformLink ?? ""),
          }))
        : [],
      registrationTitle: String(body.registrationTitle ?? ""),
      hostedBy: String(body.hostedBy ?? body.companyName ?? ""),
      companyLogo: String(body.companyLogo ?? ""),
      companyName: String(body.companyName ?? ""),
      hostContact: String(body.hostContact ?? ""),
      aboutEvent: String(body.aboutEvent ?? ""),
      scheduleHeading: String(body.scheduleHeading ?? ""),
      scheduleDurationMinutes: (() => {
        const n = Number(body.scheduleDurationMinutes);
        if (!Number.isFinite(n) || n < 1) {
          return 90;
        }
        return Math.min(10080, Math.floor(n));
      })(),
      scheduleParts: Array.isArray(body.scheduleParts)
        ? body.scheduleParts.map((item) => ({
            title: String((item as { title?: string }).title ?? ""),
            content: String((item as { content?: string }).content ?? ""),
          }))
        : [],
      hosts: Array.isArray(body.hosts)
        ? body.hosts.map((item) => ({
            name: String((item as { name?: string }).name ?? ""),
            designation: String((item as { designation?: string }).designation ?? ""),
          }))
        : [],
      eventMoreDetails: String(body.eventMoreDetails ?? ""),
      hashTagOne: String(body.hashTagOne ?? ""),
      hashTagTwo: String(body.hashTagTwo ?? ""),
      hashTags: Array.isArray(body.hashTags) ? body.hashTags.map((item) => String(item)) : [],
      registerNowText: String(body.registerNowText ?? ""),
      registerSupportText: String(body.registerSupportText ?? ""),
      registerLink: String(body.registerLink ?? ""),
      whyTitle: String(body.whyTitle ?? ""),
      whyContent: String(body.whyContent ?? ""),
      questionTitle: String(body.questionTitle ?? ""),
      questions: Array.isArray(body.questions)
        ? body.questions.map((item) => String(item))
        : [],
      aboutWhy: String(body.aboutWhy ?? ""),
      endLine: String(body.endLine ?? ""),
      eventFormat: normalizeEventFormat(body.eventFormat),
      emailFlows: normalizeEventEmailFlows(
        body.emailFlows,
        normalizeEventFormat(body.eventFormat),
        String(body.eventName ?? "")
      ),
      status: "draft",
    });

    try {
      await ensureEventRegistrationList({
        eventId,
        projectId: session.projectId,
        eventName: String(body.eventName ?? ""),
        userId: session.id,
      });
    } catch {
      // Event create still succeeds if the Registration list could not be created.
    }

    await revalidateEventPagesByEventId(eventId);
    return NextResponse.json({ message: "Event created.", eventId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create event.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
