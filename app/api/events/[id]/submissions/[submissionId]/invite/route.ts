import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { sendSubmissionInviteForEvent } from "@/lib/send-submission-invite";
import { getEventById } from "@/lib/events";
import { sanitizeInviteMessageHtml } from "@/lib/sanitize-invite-message-html";

type RouteContext = {
  params: Promise<{ id: string; submissionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id, submissionId } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    let customMessage = "";
    let useEventBanner = false;
    const body = (await request.json()) as {
      customMessage?: unknown;
      useEventBanner?: unknown;
    };
    if (typeof body.customMessage === "string") {
      customMessage = sanitizeInviteMessageHtml(body.customMessage);
    }
    if (body.useEventBanner === true) {
      useEventBanner = true;
    }

    const event = await getEventById(id);
    if (!event) {
      return NextResponse.json({ message: "Event not found." }, { status: 404 });
    }

    const result = await sendSubmissionInviteForEvent(event, submissionId, {
      customMessage,
      useEventBanner,
    });

    return NextResponse.json(
      {
        message: "Invite sent.",
        inviteSentAt: result.inviteSentAt,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send invite.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
