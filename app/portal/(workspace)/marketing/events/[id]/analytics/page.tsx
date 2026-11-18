import { ObjectId } from "mongodb";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { eventPublicUrl } from "@/lib/event-public-url";
import { EventAnalyticsBoard } from "@/components/event-analytics-board";
import { getEventPageAnalytics } from "@/lib/event-page-analytics";
import { getEventById } from "@/lib/events";
import { getDb } from "@/lib/mongodb";

type EventAnalyticsPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function EventAnalyticsPage({ params }: EventAnalyticsPageProps) {
  const { id } = await params;
  const event = await getEventById(id);

  if (!event) {
    notFound();
  }

  const db = await getDb();
  const registrationCount =
    ObjectId.isValid(id)
      ? await db.collection("event_submissions").countDocuments({ eventId: new ObjectId(id) })
      : 0;

  const analytics = await getEventPageAnalytics(id, { registrationCount });
  const publicUrl = eventPublicUrl(event.publicId);

  return (
    <EventAnalyticsBoard
      eventId={id}
      eventName={event.eventName}
      publicId={event.publicId}
      publicUrl={publicUrl}
      analytics={analytics}
    />
  );
}
