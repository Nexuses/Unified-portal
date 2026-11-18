import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getAllEvents } from "@/lib/events";
import { normalizeEventFormat } from "@/lib/event-format";
import { AllEventsBoard } from "@/components/all-events-board";

export const dynamic = "force-dynamic";

export default async function AllEventPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect("/login");
  }
  const events = await getAllEvents(session.projectId);

  return (
    <>
      <div className="crm-page-head drip-page-head">
        <div>
          <h2>Event Campaign</h2>
        </div>
        <div className="crm-actions">
          <Link href="/portal/marketing/events/new" className="btn-dark">
            Create campaign
          </Link>
        </div>
      </div>
      <AllEventsBoard
        events={events.map((event) => ({
          id: event.id,
          eventName: event.eventName,
          eventDate: event.eventDate,
          eventTimeStart: event.eventTimeStart,
          eventTimeEnd: event.eventTimeEnd,
          status: event.status,
          platform: event.platform,
          eventFormat: normalizeEventFormat(event.eventFormat),
          publicId: event.publicId,
        }))}
      />
    </>
  );
}
