import { NextResponse } from "next/server";
import {
  createSubmissionFromPublicId,
  getBookedSlotIndexesByEventId,
} from "@/lib/submissions";
import { getEventByPublicId } from "@/lib/events";
import { isWaitlistedWebinarFormat } from "@/lib/event-format";
import { revalidateEventPages } from "@/lib/revalidate-dashboard";
import { normalizeEventCalendarsArray } from "@/lib/normalize-event-calendars";
import { sendSubmissionInviteEmail } from "@/lib/invite-email";
import { normalizeViewerTimeZone } from "@/lib/viewer-time-zone";
import { validateWaitlistRegistrationFields } from "@/lib/waitlist-registration";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { publicId } = await context.params;

  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      companyName?: string;
      phone?: string;
      calendarSlotIndex?: number;
      viewerTimeZone?: string;
    };

    const name = body.name?.trim() ?? "";
    const email = body.email?.trim() ?? "";
    const companyName = body.companyName?.trim() ?? "";
    const phone = body.phone?.trim() ?? "";

    if (!name || !email) {
      return NextResponse.json(
        { message: "Name and email are required." },
        { status: 400 }
      );
    }

    const event = await getEventByPublicId(publicId);
    if (!event) {
      return NextResponse.json({ message: "Event not found." }, { status: 404 });
    }

    if (isWaitlistedWebinarFormat(event.eventFormat)) {
      const validationError = validateWaitlistRegistrationFields({ companyName, phone });
      if (validationError) {
        return NextResponse.json({ message: validationError }, { status: 400 });
      }
    }

    const viewerTimeZone = normalizeViewerTimeZone(body.viewerTimeZone);

    await createSubmissionFromPublicId({
      publicId,
      name,
      email,
      companyName,
      phone,
      calendarSlotIndex:
        typeof body.calendarSlotIndex === "number" ? body.calendarSlotIndex : undefined,
      viewerTimeZone,
    });

    const bookedSlotIndexes = await getBookedSlotIndexesByEventId(event.id);

    const slotSeed = [
        {
          eventDate: event.eventDate,
          eventTimeStart: event.eventTimeStart,
          eventTimeEnd: event.eventTimeEnd,
          platform: event.platform,
          platformLink: event.platformLink ?? "",
        },
        ...normalizeEventCalendarsArray(event.eventCalendars),
      ];
      const slotList = slotSeed.filter(
        (slot) =>
          String(slot.eventDate ?? "").trim() ||
          String(slot.eventTimeStart ?? "").trim() ||
          String(slot.eventTimeEnd ?? "").trim() ||
          String(slot.platform ?? "").trim()
      );
      const requestedIndex =
        typeof body.calendarSlotIndex === "number" && Number.isFinite(body.calendarSlotIndex)
          ? Math.max(0, Math.floor(body.calendarSlotIndex))
          : 0;
      const selectedIndex = Math.min(requestedIndex, Math.max(0, slotList.length - 1));
      const selectedSlot = slotList[selectedIndex] ?? slotSeed[0];
      const emailVariant = isWaitlistedWebinarFormat(event.eventFormat)
        ? "waitlist"
        : "registration";

      try {
        await sendSubmissionInviteEmail(
          event,
          {
            name,
            email,
          },
          emailVariant,
          {
            eventDate: selectedSlot?.eventDate ?? event.eventDate,
            eventTimeStart: selectedSlot?.eventTimeStart ?? event.eventTimeStart,
            eventTimeEnd: selectedSlot?.eventTimeEnd ?? event.eventTimeEnd,
            platform: selectedSlot?.platform ?? event.platform,
            platformLink: selectedSlot?.platformLink ?? event.platformLink ?? "",
          },
          { viewerTimeZone }
        );
      } catch (emailError) {
        console.error("Failed to send registration invite email:", emailError);
      }

    revalidateEventPages({
      eventId: event?.id,
      publicId,
    });
    return NextResponse.json(
      {
        message: isWaitlistedWebinarFormat(event?.eventFormat)
          ? "You're on the waitlist. We'll email you when your seat is confirmed."
          : "Registered successfully.",
        bookedSlotIndexes,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not register.";
    const status =
      message.includes("required") || message.includes("valid phone")
        ? 400
        : message.includes("already submitted") ||
            message.includes("no longer available") ||
            message.includes("not selected")
          ? 409
          : message.includes("not found")
            ? 404
            : 500;
    return NextResponse.json({ message }, { status });
  }
}
