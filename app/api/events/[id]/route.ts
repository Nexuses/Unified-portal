import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { connectedSenderEmail } from "@/lib/event-sender-mail";
import { deleteEventById, updateEvent, updateEventStatus, type EventPayload } from "@/lib/events";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";
import { deleteSubmissionsByEventId } from "@/lib/submissions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }
  return NextResponse.json({ event: access.event });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const body = (await request.json()) as {
      action?: "publish" | "unpublish" | "update";
      payload?: Record<string, unknown>;
    };

    if (body.action === "publish") {
      await updateEventStatus(id, "published", access.session.projectId);
      await revalidateEventPagesByEventId(id);
      return NextResponse.json({ message: "Event published." });
    }

    if (body.action === "unpublish") {
      await updateEventStatus(id, "draft", access.session.projectId);
      await revalidateEventPagesByEventId(id);
      return NextResponse.json({ message: "Event moved to draft." });
    }

    if (body.action === "update" && body.payload) {
      const payload = { ...body.payload } as Record<string, unknown>;
      delete payload.projectId;
      delete payload.projectName;
      delete payload.smtpConfig;
      delete payload.inviteSmtpConfig;
      const senderId = String(payload.senderId ?? "").trim();
      const inviteSenderId = String(payload.inviteSenderId ?? "").trim();
      if (senderId) {
        const senderEmail = await connectedSenderEmail(access.session.projectId, senderId);
        if (!senderEmail) {
          return NextResponse.json(
            { message: "Select a connected sender for invite emails." },
            { status: 400 },
          );
        }
        payload.senderEmail = senderEmail;
      }
      if (inviteSenderId) {
        const inviteSenderEmail = await connectedSenderEmail(
          access.session.projectId,
          inviteSenderId,
        );
        if (!inviteSenderEmail) {
          return NextResponse.json(
            { message: "The calendar sender is disconnected." },
            { status: 400 },
          );
        }
        payload.inviteSenderEmail = inviteSenderEmail;
      }
      await updateEvent(id, payload as Partial<EventPayload>, access.session.projectId);
      await revalidateEventPagesByEventId(id);
      return NextResponse.json({ message: "Event updated." });
    }

    return NextResponse.json({ message: "Invalid action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update event.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    await deleteSubmissionsByEventId(id);
    const deleted = await deleteEventById(id, access.session.projectId);
    if (!deleted) {
      return NextResponse.json({ message: "Event not found." }, { status: 404 });
    }
    await revalidateEventPagesByEventId(id);
    return NextResponse.json({ message: "Event deleted." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete event.";
    return NextResponse.json({ message }, { status: 500 });
  }
}