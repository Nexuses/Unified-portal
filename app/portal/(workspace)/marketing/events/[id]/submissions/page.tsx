import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { EventSubmissionsBoard } from "@/components/event-submissions-board";
import { normalizeEventFormat } from "@/lib/event-format";
import { ensureEventRegistrationList } from "@/lib/event-registration-list";
import { getEventById } from "@/lib/events";

type EventSubmissionsPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function EventSubmissionsPage({ params }: EventSubmissionsPageProps) {
  const { id } = await params;
  const event = await getEventById(id);

  if (!event) {
    notFound();
  }

  const session = await getSessionUser();
  let registrationListId = String(event.registrationListId ?? "").trim();
  try {
    registrationListId =
      (await ensureEventRegistrationList({
        eventId: id,
        projectId: String(event.projectId ?? session?.projectId ?? ""),
        eventName: event.eventName,
        registrationListId,
        userId: session?.id,
      })) ?? registrationListId;
  } catch {
    // Keep submissions usable if list ensure fails.
  }

  return (
    <EventSubmissionsBoard
      eventId={id}
      eventName={event.eventName}
      eventFormat={normalizeEventFormat(event.eventFormat)}
      registrationListId={registrationListId || undefined}
    />
  );
}
