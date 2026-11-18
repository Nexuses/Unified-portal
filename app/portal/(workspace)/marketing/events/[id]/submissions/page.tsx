import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { EventSubmissionsBoard } from "@/components/event-submissions-board";
import { normalizeEventFormat } from "@/lib/event-format";
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

  return (
    <EventSubmissionsBoard
      eventId={id}
      eventName={event.eventName}
      eventFormat={normalizeEventFormat(event.eventFormat)}
    />
  );
}
