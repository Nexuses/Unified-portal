import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import {
  isSharedSessionFormat,
  isWaitlistedWebinarFormat,
} from "@/lib/event-format";
import { getEventById } from "@/lib/events";
import {
  getSubmissionsByEventId,
  setReminderPreferencesForEvent,
  setReminderPreferencesForEventSlot,
} from "@/lib/submissions";
import { getWaitlistedSubmissionStage } from "@/lib/webinar-submission-stage";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const body = (await request.json()) as {
      dayEnabled?: boolean;
      hourEnabled?: boolean;
      slotIndex?: number;
    };
    const dayEnabled = Boolean(body.dayEnabled);
    const hourEnabled = Boolean(body.hourEnabled);
    const slotIndex =
      typeof body.slotIndex === "number" && Number.isFinite(body.slotIndex)
        ? Math.max(0, Math.floor(body.slotIndex))
        : 0;

    const event = await getEventById(id);
    const submissions = await getSubmissionsByEventId(id);
    const isSharedSession = event ? isSharedSessionFormat(event.eventFormat) : false;
    const isWaitlisted = event ? isWaitlistedWebinarFormat(event.eventFormat) : false;
    const eligibleSubmissions = isWaitlisted
      ? submissions.filter((submission) => getWaitlistedSubmissionStage(submission) === "going")
      : submissions;

    if (eligibleSubmissions.length === 0) {
      return NextResponse.json(
        {
          message: isSharedSession
            ? isWaitlisted
              ? "No confirmed seats found."
              : "No registrants found."
            : "No submissions found for this calendar slot.",
        },
        { status: 400 }
      );
    }

    if (!isSharedSession) {
      const submissionsInSlot = submissions.filter(
        (submission) => (submission.calendarSlotIndex ?? 0) === slotIndex
      );
      if (submissionsInSlot.length === 0) {
        return NextResponse.json(
          { message: "No submissions found for this calendar slot." },
          { status: 400 }
        );
      }
    }

    const updated = isSharedSession
      ? await setReminderPreferencesForEvent(id, {
          dayEnabled,
          hourEnabled,
          confirmedWaitlistOnly: isWaitlisted,
        })
      : await setReminderPreferencesForEventSlot(id, slotIndex, {
          dayEnabled,
          hourEnabled,
        });
    return NextResponse.json(
      { message: "Reminder preferences updated.", updatedCount: updated },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { message: "Failed to schedule reminders." },
      { status: 500 }
    );
  }
}
