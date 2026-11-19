import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { after } from "next/server";
import {
  createScheduledInviteBatch,
  dispatchDueScheduledInvites,
  parseScheduledInviteDateTime,
  type ScheduledInviteTab,
} from "@/lib/scheduled-invites";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";
import { sanitizeInviteMessageHtml } from "@/lib/sanitize-invite-message-html";

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
      tab?: unknown;
      submissionIds?: unknown;
      scheduledDate?: unknown;
      scheduledTime?: unknown;
      customMessage?: unknown;
      useEventBanner?: unknown;
    };

    const scheduledDate =
      typeof body.scheduledDate === "string" ? body.scheduledDate.trim() : "";
    const scheduledTime =
      typeof body.scheduledTime === "string" ? body.scheduledTime.trim() : "";
    const scheduledAt = parseScheduledInviteDateTime(scheduledDate, scheduledTime);
    if (!scheduledAt) {
      return NextResponse.json({ message: "Choose a valid schedule date and time." }, { status: 400 });
    }

    const tab =
      body.tab === "invite_to" || body.tab === "invited" ? (body.tab as ScheduledInviteTab) : null;
    const submissionIds = Array.isArray(body.submissionIds)
      ? body.submissionIds.filter((value): value is string => typeof value === "string")
      : undefined;

    if (!tab && (!submissionIds || submissionIds.length === 0)) {
      return NextResponse.json(
        { message: "Choose contacts or a tab to schedule invites." },
        { status: 400 }
      );
    }

    const customMessage =
      typeof body.customMessage === "string"
        ? sanitizeInviteMessageHtml(body.customMessage)
        : "";
    const useEventBanner = body.useEventBanner === true;

    const created = await createScheduledInviteBatch({
      eventId: id,
      tab,
      submissionIds,
      scheduledAt,
      customMessage,
      useEventBanner,
    });

    await revalidateEventPagesByEventId(id);

    after(async () => {
      const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
      const cappedDelayMs = Math.min(delayMs, 5 * 60 * 1000);
      if (cappedDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, cappedDelayMs));
      }
      try {
        await dispatchDueScheduledInvites();
      } catch (error) {
        console.error("Scheduled invite after-dispatch failed:", error);
      }
    });

    return NextResponse.json(
      {
        message: `Invites scheduled for ${created.submissionCount} contact${
          created.submissionCount === 1 ? "" : "s"
        }.`,
        batchId: created.id,
        scheduledAt: created.scheduledAt,
        submissionCount: created.submissionCount,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to schedule invites.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
