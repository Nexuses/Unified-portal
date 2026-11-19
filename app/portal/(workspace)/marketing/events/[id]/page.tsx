import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { EventDetailLayout, type EventViewData } from "@/components/event-detail-layout";
import { PublishButton } from "@/components/publish-button";
import { getSessionUser } from "@/lib/auth";
import { getEventById } from "@/lib/events";
import { serializeEventForClient } from "@/lib/serialize-event-for-client";
import { getBookedSlotIndexesByEventId } from "@/lib/submissions";

type EventPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: EventPageProps) {
  const { id } = await params;
  const session = await getSessionUser();
  if (!session) {
    redirect("/login");
  }
  const event = await getEventById(id, session.projectId);

  if (!event) {
    notFound();
  }
  const bookedSlotIndexes = await getBookedSlotIndexesByEventId(event.id);
  const safeEvent = serializeEventForClient(
    event as unknown as Record<string, unknown>
  ) as EventViewData;

  return (
    <div>
      <div className="crm-page-head drip-page-head">
        <div className="drip-detail-title-wrap">
          <Link href="/portal/marketing/events" className="drip-back" aria-label="Back to event campaigns">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h2>{event.eventName}</h2>
          </div>
        </div>
        <div className="crm-actions">
          <Link href={`/portal/marketing/events/${event.id}/edit`} className="btn-soft">
            Edit
          </Link>
          <PublishButton
            publicId={event.publicId}
            eventId={event.id}
            initialStatus={event.status ?? "draft"}
          />
        </div>
      </div>
      <EventDetailLayout
        event={safeEvent}
        blockedSlotIndexes={bookedSlotIndexes}
        backHref="/portal/marketing/events"
        backLabel="← Back to event campaigns"
        showControls={false}
        showBackButton={false}
        visualVariant="public"
      />

      <footer className="mx-auto mt-10 w-full max-w-[1000px] border-t border-black/8 px-6 pt-10 pb-16 text-center max-md:mt-8 max-md:px-4 max-md:pt-8 max-md:pb-12 md:px-8">
        <a
          href="http://nexuses.in/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-gradient-to-r from-[#05a6e3] via-[#5b8e7b] to-[#b17713] bg-clip-text text-[16px] font-medium text-transparent"
        >
          Host your event with Nexuses ↗
        </a>
      </footer>
    </div>
  );
}
