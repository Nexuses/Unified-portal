import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConfirmGoingClient } from "@/components/confirm-going-client";
import { PublicHeaderClock } from "@/components/public-header-clock";
import { resolveEmailBannerUrl } from "@/lib/email-banner";
import { getEventByPublicId } from "@/lib/events";
import { formatEventEmailDateTime } from "@/lib/public-event-time";
import { resolvePublicHeaderLogo } from "@/lib/public-header-logo";
import { getSubmissionByIdForEvent } from "@/lib/submissions";

type AcceptInvitePageProps = {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ sid?: string; email?: string }>;
};

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({ params, searchParams }: AcceptInvitePageProps) {
  const { publicId } = await params;
  const query = await searchParams;
  const sid = query.sid?.trim() ?? "";
  const email = query.email?.trim() ?? "";

  if (!sid && !email) {
    redirect(`/e/${publicId}`);
  }

  const event = await getEventByPublicId(publicId);
  if (!event || event.status !== "published") {
    notFound();
  }

  const submission = sid ? await getSubmissionByIdForEvent(event.id, sid) : null;
  const eventDate = submission?.calendarEventDate ?? event.eventDate;
  const eventTimeStart = submission?.calendarEventTimeStart ?? event.eventTimeStart;
  const eventTimeEnd = submission?.calendarEventTimeEnd ?? event.eventTimeEnd;
  const platform = submission?.calendarPlatform ?? event.platform;
  const { displayDate, displayTime } = formatEventEmailDateTime(
    eventDate,
    eventTimeStart,
    eventTimeEnd,
    submission?.viewerTimeZone ?? null
  );
  const bannerUrl = resolveEmailBannerUrl(event);

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <header className="bg-[#f3f4f6]">
        <div className="flex w-full items-center justify-between px-3 py-3 max-md:py-2.5 md:px-4">
          <Link href="/" className="inline-flex items-center">
            <img
              src={resolvePublicHeaderLogo(event.publicHeaderLogo)}
              alt={event.eventName || "Event"}
              className="h-7 w-auto max-w-[240px] object-contain object-left"
            />
          </Link>
          <PublicHeaderClock />
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-72px)] max-w-[1000px] items-center justify-center px-4 py-10">
        <ConfirmGoingClient
          publicId={publicId}
          eventName={event.eventName}
          sid={sid}
          email={email}
          bannerUrl={bannerUrl}
          eventDateYmd={eventDate}
          displayDate={displayDate}
          displayTime={displayTime}
          platform={platform}
        />
      </main>
    </div>
  );
}
