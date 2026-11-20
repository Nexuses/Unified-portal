import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { EventSubmissionsBoard } from "@/components/event-submissions-board";
import { normalizeEventFormat } from "@/lib/event-format";
import { syncEventRegistrationListWithGoing } from "@/lib/event-registration-list";
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
      (await syncEventRegistrationListWithGoing({
        eventId: id,
        projectId: String(event.projectId ?? session?.projectId ?? ""),
        userId: session?.id,
      })) ?? registrationListId;
  } catch {
    // Keep submissions usable if list sync fails.
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
