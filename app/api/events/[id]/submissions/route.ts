import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";
import { normalizeEventFormat } from "@/lib/event-format";
import { getEventById } from "@/lib/events";
import { resolveEmailBannerUrl } from "@/lib/email-banner";
import { resolveRollingOneToOneSlotsWithExpired } from "@/lib/auto-one-to-one-slots";
import {
  createBulkSubmissionsForEvent,
  getSubmissionsByEventId,
  importProjectListIntoEvent,
} from "@/lib/submissions";
import { toWallDateYmd } from "@/lib/public-event-time";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CalendarSlot = {
  slotIndex: number;
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: string;
};

function normalizeTime(value: string) {
  return String(value ?? "").trim().slice(0, 5);
}

function normalizePlatform(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function signatureOf(slot: {
  eventDate?: string;
  eventTimeStart?: string;
  eventTimeEnd?: string;
  platform?: string;
}) {
  return `${toWallDateYmd(slot.eventDate)}::${normalizeTime(slot.eventTimeStart ?? "")}::${normalizeTime(
    slot.eventTimeEnd ?? ""
  )}::${normalizePlatform(slot.platform ?? "")}`;
}

function bookedCalendarsFromSubmissions(
  submissions: Array<{
    calendarEventDate?: string;
    calendarEventTimeStart?: string;
    calendarEventTimeEnd?: string;
    calendarPlatform?: string;
  }>,
  platformDefault: string
): CalendarSlot[] {
  const seen = new Set<string>();
  const calendars: CalendarSlot[] = [];

  for (const submission of submissions) {
    const eventDate = String(submission.calendarEventDate ?? "").trim();
    const eventTimeStart = normalizeTime(submission.calendarEventTimeStart ?? "");
    const eventTimeEnd = normalizeTime(submission.calendarEventTimeEnd ?? "");
    if (!eventDate || !eventTimeStart || !eventTimeEnd) {
      continue;
    }
    const platform = String(submission.calendarPlatform ?? platformDefault).trim() || platformDefault;
    const sig = signatureOf({ eventDate, eventTimeStart, eventTimeEnd, platform });
    if (seen.has(sig)) {
      continue;
    }
    seen.add(sig);
    calendars.push({
      slotIndex: calendars.length,
      eventDate: toWallDateYmd(eventDate),
      eventTimeStart,
      eventTimeEnd,
      platform,
    });
  }

  return calendars;
}

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const event = await getEventById(id);
    const eventFormat = event ? normalizeEventFormat(event.eventFormat) : "one_to_one";
    const submissions = await getSubmissionsByEventId(id);
    const resolved = event
      ? resolveRollingOneToOneSlotsWithExpired({
          eventFormat,
          eventDate: event.eventDate,
          oneToOneBookingEndDate: event.oneToOneBookingEndDate,
          oneToOneWeeklyHours: event.oneToOneWeeklyHours,
          oneToOneBookingHorizonDays: event.oneToOneBookingHorizonDays,
          oneToOneMinNoticeDays: event.oneToOneMinNoticeDays,
          oneToOneMeetingDurationMinutes: event.oneToOneMeetingDurationMinutes,
          eventTimeStart: event.eventTimeStart,
          eventTimeEnd: event.eventTimeEnd,
          platform: event.platform,
          platformLink: event.platformLink ?? "",
          eventCalendars: event.eventCalendars,
        })
      : { activeSlots: [], expiredSlots: [] };

    const isOneToOne = eventFormat === "one_to_one";
    const calendars: CalendarSlot[] = event
      ? isOneToOne
        ? bookedCalendarsFromSubmissions(submissions, event.platform ?? "")
        : resolved.activeSlots.map((slot, index) => ({
            slotIndex: index,
            eventDate: slot.eventDate ?? "",
            eventTimeStart: slot.eventTimeStart ?? "",
            eventTimeEnd: slot.eventTimeEnd ?? "",
            platform: slot.platform ?? "",
          }))
      : [];

    const expiredFromConfig = event && !isOneToOne
      ? resolved.expiredSlots.map((slot) => ({
          slotIndex: -1,
          eventDate: slot.eventDate ?? "",
          eventTimeStart: slot.eventTimeStart ?? "",
          eventTimeEnd: slot.eventTimeEnd ?? "",
          platform: slot.platform ?? "",
        }))
      : [];
    const activeSignatures = new Set(calendars.map((slot) => signatureOf(slot)));
    const expiredSignatures = new Set(expiredFromConfig.map((slot) => signatureOf(slot)));
    const expiredFromBookings = submissions
      .map((submission) => ({
        slotIndex: -1,
        eventDate: submission.calendarEventDate ?? "",
        eventTimeStart: submission.calendarEventTimeStart ?? "",
        eventTimeEnd: submission.calendarEventTimeEnd ?? "",
        platform: submission.calendarPlatform ?? "",
      }))
      .filter(
        (slot) =>
          slot.eventDate.trim() && slot.eventTimeStart.trim() && slot.eventTimeEnd.trim()
      )
      .filter((slot) => {
        const sig = signatureOf(slot);
        if (!sig || activeSignatures.has(sig) || expiredSignatures.has(sig)) {
          return false;
        }
        expiredSignatures.add(sig);
        return true;
      });
    const expiredCalendars = isOneToOne
      ? []
      : [...expiredFromConfig, ...expiredFromBookings].map((slot, index) => ({
          slotIndex: index,
          eventDate: slot.eventDate ?? "",
          eventTimeStart: slot.eventTimeStart ?? "",
          eventTimeEnd: slot.eventTimeEnd ?? "",
          platform: slot.platform ?? "",
        }));
    return NextResponse.json(
      {
        submissions,
        calendars,
        expiredCalendars,
        eventFormat,
        emailBannerUrl: event?.emailBannerUrl ?? "",
        eventBanner: event?.eventBanner ?? "",
        emailIncludeEventBanner: event?.emailIncludeEventBanner !== false,
        resolvedEmailBannerUrl: event ? resolveEmailBannerUrl(event) : "",
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { message: "Could not load submissions." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }
  try {
    const body = (await request.json()) as {
      slotIndex?: number;
      listId?: string;
      rows?: Array<{ name?: string; email?: string; companyName?: string }>;
    };
    const slotIndex =
      typeof body.slotIndex === "number" && Number.isFinite(body.slotIndex)
        ? body.slotIndex
        : 0;
    if (typeof body.listId === "string" && body.listId.trim()) {
      const importResult = await importProjectListIntoEvent({
        projectId: access.session.projectId,
        eventId: id,
        listId: body.listId.trim(),
        slotIndex,
      });
      const { insertedCount, skippedDuplicateCount } = importResult;
      if (insertedCount > 0) {
        await revalidateEventPagesByEventId(id);
      }
      return NextResponse.json(
        {
          message:
            insertedCount > 0
              ? `Added ${insertedCount} contact${insertedCount === 1 ? "" : "s"} from the list.`
              : skippedDuplicateCount > 0
                ? "Those contacts are already on this event."
                : "No contacts were added.",
          ...importResult,
        },
        { status: insertedCount === 0 && skippedDuplicateCount === 0 ? 400 : 200 },
      );
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ message: "No rows provided." }, { status: 400 });
    }
    const importResult = await createBulkSubmissionsForEvent({
      eventId: id,
      slotIndex,
      rows: rows.map((row) => ({
        name: String(row.name ?? ""),
        email: String(row.email ?? ""),
        companyName: String(row.companyName ?? ""),
      })),
    });
    const { insertedCount, skippedDuplicateCount, invalidCount } = importResult;
    if (insertedCount === 0 && skippedDuplicateCount === 0 && invalidCount > 0) {
      return NextResponse.json(
        { message: "No valid rows found. Need Name and Email.", ...importResult },
        { status: 400 }
      );
    }
    if (insertedCount === 0 && skippedDuplicateCount > 0) {
      return NextResponse.json(
        {
          message:
            skippedDuplicateCount === 1
              ? "That contact is already in this event."
              : `All ${skippedDuplicateCount} contacts are already in this event.`,
          ...importResult,
        },
        { status: 200 }
      );
    }
    await revalidateEventPagesByEventId(id);
    return NextResponse.json(
      {
        message: "Bulk registrants uploaded.",
        insertedCount,
        skippedDuplicateCount,
        invalidCount,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload registrants.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
