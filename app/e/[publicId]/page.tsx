import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EventDetailLayout, type EventViewData } from "@/components/event-detail-layout";
import { InviteAcceptedThankYouModal } from "@/components/invite-accepted-thank-you-modal";
import { PublicHeaderClock } from "@/components/public-header-clock";
import { PublicPageAnalytics } from "@/components/public-page-analytics";
import { getEventByPublicId } from "@/lib/events";
import { serializeEventForClient } from "@/lib/serialize-event-for-client";
import { getBookedSlotIndexesByEventId } from "@/lib/submissions";
import { eventPublicOrigin, eventPublicUrl } from "@/lib/event-public-url";
import { resolvePublicHeaderLogo } from "@/lib/public-header-logo";

type PublicEventPageProps = {
  params: Promise<{ publicId: string }>;
};

export const dynamic = "force-dynamic";

const RESERVED_ROUTES = new Set(["login", "signup", "dashboard", "events", "api"]);

function formatEventDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date || "").trim());
  if (!match) {
    return date || "TBA";
  }
  const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(dt.getTime())) {
    return date || "TBA";
  }
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function generateMetadata({ params }: PublicEventPageProps): Promise<Metadata> {
  const { publicId } = await params;
  if (RESERVED_ROUTES.has(publicId)) {
    return {
      title: "Nexuses Event",
      description: "Public event page",
    };
  }

  const event = await getEventByPublicId(publicId);
  if (!event || event.status !== "published") {
    return {
      title: "Event not found | Nexuses Event",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const url = eventPublicUrl(publicId);
  const ogImage = `${eventPublicOrigin()}/api/public-events/${publicId}/og-image`;
  const aboutSnippet = (event.aboutEvent || "").trim().slice(0, 120);
  const description = [
    "Event Details:",
    `Date: ${formatEventDate(event.eventDate)}`,
    `Time: ${event.eventTimeStart || "TBA"} - ${event.eventTimeEnd || "TBA"} IST`,
    `Location: ${event.platform || "Online"}`,
    aboutSnippet,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: `${event.eventName} | Nexuses Event`,
    description,
    openGraph: {
      title: event.eventName,
      description,
      url,
      type: "website",
      siteName: "Nexuses Event",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: event.eventName,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: event.eventName,
      description,
      images: [ogImage],
    },
  };
}

export default async function PublicEventPage({ params }: PublicEventPageProps) {
  const { publicId } = await params;

  if (RESERVED_ROUTES.has(publicId)) {
    notFound();
  }

  const event = await getEventByPublicId(publicId);
  if (!event || event.status !== "published") {
    notFound();
  }
  const bookedSlotIndexes = await getBookedSlotIndexesByEventId(event.id);
  const headerLogo = resolvePublicHeaderLogo(event.publicHeaderLogo);
  const safeEvent = serializeEventForClient(
    event as unknown as Record<string, unknown>
  ) as EventViewData;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f5f5]">
      <PublicPageAnalytics publicId={publicId} />
      <header className="bg-[#f5f5f5]">
        <div className="flex w-full items-center justify-between px-3 py-3 max-md:py-2.5 md:px-4">
          <Link
            href="/"
            className="inline-flex items-center"
          >
            <img
              src={headerLogo}
              alt={event.eventName || "Event"}
              className="h-7 w-auto max-w-[240px] object-contain object-left"
            />
          </Link>
          <PublicHeaderClock />
        </div>
      </header>

      <div className="-mt-4 max-md:-mt-2">
        <Suspense fallback={null}>
          <InviteAcceptedThankYouModal eventName={safeEvent.eventName} />
        </Suspense>
        <EventDetailLayout
          event={safeEvent}
          blockedSlotIndexes={bookedSlotIndexes}
          backHref="/"
          backLabel="← Back"
          showControls={false}
          showBackButton={false}
          visualVariant="public"
        />
      </div>

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
