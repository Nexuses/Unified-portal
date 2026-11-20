"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractRawEventCalendarsField,
} from "@/lib/normalize-event-calendars";
import {
  EVENT_WALL_TIME_ZONE,
  formatEventSlotForViewer,
  toWallDateYmd,
} from "@/lib/public-event-time";
import { useViewerTimeZone } from "@/lib/use-viewer-time-zone";
import { PublishButton } from "@/components/publish-button";
import { PublicOneToOneBookingFlow } from "@/components/public-one-to-one-booking-flow";
import { PublicRegisterSheet } from "@/components/public-register-sheet";
import {
  type EventFormat,
  isSharedSessionFormat,
  isWaitlistedWebinarFormat,
} from "@/lib/event-format";
import { sanitizeBasicHtml } from "@/lib/sanitize-basic-html";
import { sanitizeEventHtml } from "@/lib/sanitize-event-html";
import { resolveRollingOneToOneSlots } from "@/lib/auto-one-to-one-slots";

export type EventViewData = {
  id: string;
  publicId: string;
  status?: "draft" | "published";
  eventBanner: string;
  publicHeaderLogo?: string;
  eventName: string;
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: string;
  platformLink?: string;
  ownerEmail?: string;
  ownerName?: string;
  oneToOneBookingEndDate?: string;
  oneToOneWeeklyHours?: Array<{
    dayOfWeek: number;
    enabled: boolean;
    ranges: Array<{ start: string; end: string }>;
  }>;
  oneToOneBookingHorizonDays?: number;
  oneToOneMinNoticeDays?: number;
  oneToOneMeetingDurationMinutes?: number;
  eventCalendars?: Array<{
    eventDate: string;
    eventTimeStart: string;
    eventTimeEnd: string;
    platform: string;
    platformLink?: string;
  }>;
  registrationTitle?: string;
  hostedBy: string;
  companyLogo?: string;
  companyName: string;
  hostContact: string;
  hashTags?: string[];
  hashTagOne?: string;
  hashTagTwo?: string;
  eventMoreDetails: string;
  registerLink: string;
  aboutEvent: string;
  scheduleHeading?: string;
  scheduleDurationMinutes?: number;
  scheduleParts: Array<{ title: string; content: string }>;
  hosts: Array<{ name: string; designation: string }>;
  whyTitle: string;
  whyContent: string;
  questionTitle: string;
  questions: string[];
  registerNowText?: string;
  registerSupportText?: string;
  aboutWhy: string;
  endLine: string;
  eventFormat?: EventFormat;
};

type EventDetailLayoutProps = {
  event: EventViewData;
  blockedSlotIndexes?: number[];
  backHref: string;
  backLabel: string;
  showControls: boolean;
  showBackButton?: boolean;
  visualVariant?: "dashboard" | "public";
};

/** Parses `YYYY-MM-DD` (HTML date input) as a local calendar date. */
function parseEventDateLocal(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, monthIndex, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatEventDateParts(eventDate: string) {
  const date = parseEventDateLocal(eventDate);
  if (!date) {
    return {
      calendarMonth: "",
      calendarDay: "",
      titleLine: eventDate.trim() || "Date TBA",
    };
  }
  const calendarMonth = date
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  const calendarDay = String(date.getDate());
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const monthLong = date.toLocaleDateString("en-GB", { month: "long" });
  const titleLine = `${weekday} ${calendarDay} ${monthLong}`;
  return { calendarMonth, calendarDay, titleLine };
}

/** Extra calendar row on the same wall date as the primary event (empty slot date = same day). */
function isSameWallDayExtraSlot(
  slotIndex: number,
  slotEventDate: string,
  mainEventDate: string
): boolean {
  if (slotIndex <= 0) {
    return false;
  }
  const mainY = toWallDateYmd(mainEventDate);
  if (!mainY) {
    return false;
  }
  const slotY = toWallDateYmd(slotEventDate);
  if (!slotY) {
    return true;
  }
  return slotY === mainY;
}

function publicSlotCalendarDisplay(
  slot: { eventDate: string; eventTimeStart: string; eventTimeEnd: string },
  viewerTz: string | null
) {
  const v = formatEventSlotForViewer(
    slot.eventDate,
    slot.eventTimeStart,
    slot.eventTimeEnd,
    viewerTz ?? EVENT_WALL_TIME_ZONE
  );
  if (v) {
    return {
      calendarMonth: v.calendarMonth,
      calendarDay: v.calendarDay,
      titleLine: v.titleLine,
      timeSubtitle: `${v.timeRangeLine} ${v.zoneSuffix}`,
    };
  }
  const parts = formatEventDateParts(slot.eventDate);
  return {
    calendarMonth: parts.calendarMonth,
    calendarDay: parts.calendarDay,
    titleLine: parts.titleLine,
    timeSubtitle: `${(slot.eventTimeStart ?? "").trim() || "—"} – ${
      (slot.eventTimeEnd ?? "").trim() || "—"
    }`,
  };
}

function EventRemoteImage({
  src,
  alt,
  width,
  height,
  className,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  const trimmed = src.trim();
  if (!trimmed) {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- project S3 hosts are not fixed
    <img src={trimmed} alt={alt} width={width} height={height} className={className} />
  );
}

export function EventDetailLayout({
  event,
  blockedSlotIndexes = [],
  backHref,
  backLabel,
  showControls,
  showBackButton = true,
  visualVariant = "dashboard",
}: EventDetailLayoutProps) {
  const clean = (value?: string) => (value ?? "").trim();
  const bannerSrc = clean(event.eventBanner) || clean(event.publicHeaderLogo);
  const isPublic = visualVariant === "public";
  const isWebinar = isSharedSessionFormat(event.eventFormat);
  const isWaitlistedWebinar = isWaitlistedWebinarFormat(event.eventFormat);
  const { viewerTimeZone, isReady: isViewerTimeZoneReady } = useViewerTimeZone();
  const displayTimeZone = isPublic
    ? isViewerTimeZoneReady && viewerTimeZone
      ? viewerTimeZone
      : EVENT_WALL_TIME_ZONE
    : null;
  const [remoteBlockedSlotIndexes, setRemoteBlockedSlotIndexes] = useState<number[]>(
    () => blockedSlotIndexes
  );
  const [sessionBookedSlotIndexes, setSessionBookedSlotIndexes] = useState<number[]>([]);
  const slotSyncChannelRef = useRef<BroadcastChannel | null>(null);
  const aboutRaw = clean(event.aboutEvent);
  const aboutUsesHtml = /<\s*[a-z][\s\S]*?>/i.test(aboutRaw);
  const aboutLegacyParagraphs = aboutRaw
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const scheduleParts = event.scheduleParts.filter(
    (part) => clean(part.title) || clean(part.content)
  );
  const hosts = event.hosts.filter((host) => clean(host.name) || clean(host.designation));
  const questions = event.questions.map((item) => item.trim()).filter(Boolean);
  const hashTags =
    Array.isArray(event.hashTags) && event.hashTags.length > 0
      ? event.hashTags.map((tag) => clean(tag)).filter(Boolean)
      : [clean(event.hashTagOne), clean(event.hashTagTwo)].filter(Boolean);
  const companyDisplayName = clean(event.companyName) || clean(event.hostedBy);
  const hostedByDisplay = clean(event.hostedBy);
  const hasWhySection = clean(event.whyTitle) || clean(event.aboutWhy) || clean(event.endLine);

  const calendarRows = useMemo(() => {
    const rawCal =
      extractRawEventCalendarsField(event) ?? (event as Record<string, unknown>).eventCalendars;
    const autoSlots = resolveRollingOneToOneSlots({
      eventFormat: event.eventFormat,
      eventDate: event.eventDate,
      oneToOneBookingEndDate: event.oneToOneBookingEndDate,
      oneToOneWeeklyHours: event.oneToOneWeeklyHours,
      oneToOneBookingHorizonDays: event.oneToOneBookingHorizonDays,
      oneToOneMinNoticeDays: event.oneToOneMinNoticeDays,
      oneToOneMeetingDurationMinutes: event.oneToOneMeetingDurationMinutes,
      eventTimeStart: event.eventTimeStart,
      eventTimeEnd: event.eventTimeEnd,
      platform: event.platform,
      platformLink: event.platformLink ?? "",
      eventCalendars: rawCal,
    });
    const allRows = autoSlots
      .map((slot, index) => ({
        slotIndex: index,
        eventDate: slot.eventDate ?? "",
        eventTimeStart: slot.eventTimeStart ?? "",
        eventTimeEnd: slot.eventTimeEnd ?? "",
        platform: slot.platform ?? "",
        platformLink: slot.platformLink ?? "",
      }))
      .filter(
        (slot) =>
          clean(slot.eventDate) ||
          clean(slot.eventTimeStart) ||
          clean(slot.eventTimeEnd) ||
          clean(slot.platform)
      );
    const hideBookedSlots = isPublic && !isWebinar;
    if (!hideBookedSlots) {
      return allRows;
    }
    const blocked = new Set([...remoteBlockedSlotIndexes, ...sessionBookedSlotIndexes]);
    return allRows.filter((slot) => !blocked.has(slot.slotIndex));
  }, [
    remoteBlockedSlotIndexes,
    sessionBookedSlotIndexes,
    event,
    isPublic,
    isWebinar,
  ]);
  const useOneToOneBookingModal = isPublic && !isWebinar;
  const showPublicCalendarPicker = isPublic && isWebinar && calendarRows.length > 1;
  const [selectedCalendarIndex, setSelectedCalendarIndex] = useState(0);
  const [isCalendarDropdownOpen, setIsCalendarDropdownOpen] = useState(false);
  const [isCalendarSelectionFlash, setIsCalendarSelectionFlash] = useState(false);
  const calendarDropdownRef = useRef<HTMLDivElement>(null);
  const selectedCalendar = calendarRows[selectedCalendarIndex] ?? calendarRows[0];
  useEffect(() => {
    if (selectedCalendarIndex <= calendarRows.length - 1) {
      return;
    }
    setSelectedCalendarIndex(0);
  }, [calendarRows.length, selectedCalendarIndex]);
  const resolvedSlotForTimeDisplay = useMemo(() => {
    return (
      calendarRows[selectedCalendarIndex] ??
      calendarRows[0] ?? {
        eventDate: event.eventDate,
        eventTimeStart: event.eventTimeStart,
        eventTimeEnd: event.eventTimeEnd,
      }
    );
  }, [
    calendarRows,
    selectedCalendarIndex,
    event.eventDate,
    event.eventTimeStart,
    event.eventTimeEnd,
  ]);
  const dateParts = useMemo(() => {
    const d = publicSlotCalendarDisplay(resolvedSlotForTimeDisplay, displayTimeZone);
    return {
      calendarMonth: d.calendarMonth,
      calendarDay: d.calendarDay,
      titleLine: d.titleLine,
    };
  }, [displayTimeZone, resolvedSlotForTimeDisplay]);
  const selectedTimeSubtitle = useMemo(
    () =>
      publicSlotCalendarDisplay(resolvedSlotForTimeDisplay, displayTimeZone).timeSubtitle,
    [displayTimeZone, resolvedSlotForTimeDisplay]
  );
  useEffect(() => {
    if (!isCalendarSelectionFlash) {
      return;
    }
    const timer = window.setTimeout(() => {
      setIsCalendarSelectionFlash(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [isCalendarSelectionFlash]);
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!calendarDropdownRef.current) return;
      if (!calendarDropdownRef.current.contains(event.target as Node)) {
        setIsCalendarDropdownOpen(false);
      }
    }

    if (isCalendarDropdownOpen) {
      window.addEventListener("mousedown", handleOutsideClick);
    }
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [isCalendarDropdownOpen]);
  const calendarInviteOptions = useMemo(
    () =>
      calendarRows.map((slot) => {
        if (isPublic) {
          const v = formatEventSlotForViewer(
            slot.eventDate,
            slot.eventTimeStart,
            slot.eventTimeEnd,
            displayTimeZone ?? EVENT_WALL_TIME_ZONE
          );
          if (v) {
            return {
              slotIndex: slot.slotIndex,
              label: `${v.titleLine} • ${v.timeRangeLine} ${v.zoneSuffix}`,
            };
          }
        }
        const parts = formatEventDateParts(slot.eventDate);
        return {
          slotIndex: slot.slotIndex,
          label: `Slot ${slot.slotIndex + 1} — ${parts.titleLine} — ${slot.eventTimeStart} to ${slot.eventTimeEnd}`,
        };
      }),
    [calendarRows, isPublic, displayTimeZone]
  );
  const scheduleMinutesRaw = event.scheduleDurationMinutes;
  const scheduleMinutes =
    typeof scheduleMinutesRaw === "number" &&
    Number.isFinite(scheduleMinutesRaw) &&
    scheduleMinutesRaw >= 1
      ? Math.min(10080, Math.floor(scheduleMinutesRaw))
      : 90;
  const scheduleMinuteLabel = scheduleMinutes === 1 ? "minute" : "minutes";
  const scheduleHeading = clean(event.scheduleHeading);
  const hasAvailablePublicSlots = !isPublic || calendarRows.length > 0;
  const publicHostName =
    clean(event.ownerName) || companyDisplayName || hosts[0]?.name || "Event host";
  const ownerContactEmail = clean(event.ownerEmail);
  const ownerContactHref = ownerContactEmail
    ? `mailto:${ownerContactEmail}`
    : clean(event.hostContact);

  const handlePublicRegisterSuccess = useCallback(
    (bookedSlotIndex: number, serverBooked?: number[]) => {
      if (isWebinar) {
        return;
      }
      if (Array.isArray(serverBooked)) {
        const next = serverBooked.filter(
          (n) => typeof n === "number" && Number.isFinite(n)
        );
        setRemoteBlockedSlotIndexes([...new Set(next)].sort((a, b) => a - b));
      } else {
        setSessionBookedSlotIndexes((prev) =>
          prev.includes(bookedSlotIndex) ? prev : [...prev, bookedSlotIndex]
        );
        setRemoteBlockedSlotIndexes((prev) =>
          prev.includes(bookedSlotIndex)
            ? prev
            : [...prev, bookedSlotIndex].sort((a, b) => a - b)
        );
      }
      try {
        slotSyncChannelRef.current?.postMessage({ publicId: event.publicId });
      } catch {
        // BroadcastChannel may be unavailable in some environments
      }
    },
    [event.publicId, isWebinar]
  );

  useEffect(() => {
    setRemoteBlockedSlotIndexes(blockedSlotIndexes);
  }, [blockedSlotIndexes]);

  useEffect(() => {
    if (!isPublic) {
      return;
    }
    let cancelled = false;

    async function fetchBookedSlots() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      try {
        const response = await fetch(`/api/public-events/${event.publicId}/booked-slots`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as { bookedSlotIndexes?: number[] };
        const next = Array.isArray(payload.bookedSlotIndexes)
          ? payload.bookedSlotIndexes
          : [];
        setRemoteBlockedSlotIndexes(next);
      } catch {
        // ignore transient network errors; next poll will retry
      }
    }

    void fetchBookedSlots();
    const intervalId = window.setInterval(fetchBookedSlots, 2000);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchBookedSlots();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    let bc: BroadcastChannel | null = null;
    const onBroadcast = (ev: MessageEvent<{ publicId?: string }>) => {
      if (!cancelled && ev.data?.publicId === event.publicId) {
        void fetchBookedSlots();
      }
    };
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("luma-public-event-slot-sync");
      slotSyncChannelRef.current = bc;
      bc.addEventListener("message", onBroadcast);
    }

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (bc) {
        bc.removeEventListener("message", onBroadcast);
        bc.close();
      }
      slotSyncChannelRef.current = null;
    };
  }, [event.publicId, isPublic]);

  useEffect(() => {
    if (!isPublic) {
      return;
    }
    setSessionBookedSlotIndexes((prev) =>
      prev.filter((slotIndex) => !remoteBlockedSlotIndexes.includes(slotIndex))
    );
  }, [remoteBlockedSlotIndexes, isPublic]);

  return (
    <div
      className={
        isPublic
          ? "mx-auto w-full max-w-[1000px] px-6 py-4 max-md:px-4 md:px-8"
          : "w-full rounded-3xl bg-[#f7f7f4] p-6 md:p-10"
      }
    >
      <header className="mb-6 flex items-center justify-between">
        {showBackButton ? (
          <Link href={backHref} className="text-xs text-black/60 hover:text-black">
            {backLabel}
          </Link>
        ) : (
          <div />
        )}
        {showControls ? (
          <div className="flex items-center gap-3">
            <Link
              href={`/portal/marketing/events/${event.id}/edit`}
              className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 px-5 text-xs font-medium text-black hover:bg-black/5"
            >
              Edit
            </Link>
            <PublishButton
              publicId={event.publicId}
              eventId={event.id}
              initialStatus={event.status ?? "draft"}
            />
          </div>
        ) : (
          <div />
        )}
      </header>

      <div
        className={
          isPublic
            ? "max-md:flex max-md:flex-col max-md:gap-6 gap-8 md:grid md:grid-cols-[330px_1fr] md:items-start"
            : "grid gap-8 md:grid-cols-[260px_1fr]"
        }
      >
        <aside
          className={
            isPublic ? "max-md:contents md:block md:space-y-4" : "space-y-4"
          }
        >
          <div
            className={`overflow-hidden rounded-2xl border border-black/10 bg-white${
              isPublic ? " max-md:order-1 max-md:w-full" : ""
            }`}
          >
            {bannerSrc ? (
              <EventRemoteImage
                src={bannerSrc}
                alt={event.eventName || "Event banner"}
                width={isPublic ? 660 : 520}
                height={isPublic ? 660 : 360}
                className={isPublic ? "aspect-square w-full object-cover" : "h-auto w-full object-cover"}
              />
            ) : (
              <div
                className={
                  isPublic
                    ? "flex aspect-square items-center justify-center bg-[#ecece7] text-sm text-black/50"
                    : "flex h-[180px] items-center justify-center bg-[#ecece7] text-sm text-black/50"
                }
              >
                Event banner
              </div>
            )}
          </div>
          <div
            className={
              isPublic
                ? "max-md:order-3 max-md:mt-0 max-md:w-full mt-6 max-lg:rounded-none max-lg:bg-transparent max-lg:p-0 max-lg:pb-6 max-lg:shadow-none max-lg:ring-0 bg-transparent p-0 md:mt-6 md:border-0 md:bg-transparent md:p-0 lg:rounded-2xl lg:pb-0"
                : "mt-3 max-lg:shadow-none max-lg:ring-0 rounded-2xl border border-black/10 bg-white p-4"
            }
          >
            <p className="border-b border-black/10 pb-2 text-[14px] leading-none font-semibold tracking-tight text-black/55">
              Hosted By
            </p>
            {companyDisplayName || clean(event.companyLogo) ? (
              <div className="mt-3 flex items-center gap-2.5">
                <div className="h-10 w-10 overflow-hidden rounded-full bg-black/10">
                  {clean(event.companyLogo) ? (
                    <EventRemoteImage
                      src={event.companyLogo as string}
                      alt={companyDisplayName || "Company logo"}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                {companyDisplayName ? (
                  <div className="space-y-0.5">
                    <p className="text-[14px] font-semibold tracking-tight text-[#141414]">
                      {companyDisplayName}
                    </p>
                    {hostedByDisplay && hostedByDisplay !== companyDisplayName ? (
                      <p className="text-[14px] font-medium tracking-tight text-[#141414]">
                        {hostedByDisplay}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {clean(event.hostContact) ? (
              <a
                href={event.hostContact}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-[14px] leading-none font-semibold text-black/38 hover:text-black/50"
              >
                Contact the Host
              </a>
            ) : null}
            {hashTags.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {hashTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex h-7 items-center rounded-full border border-black/12 px-3 text-[13px] font-medium leading-none text-black/34"
                  >
                    # {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </aside>

        <main
          className={
            isPublic
              ? "max-md:order-2 max-md:w-full max-md:break-words space-y-4"
              : "rounded-2xl border border-black/10 bg-white p-6"
          }
        >
          <section className={isPublic ? "p-0" : ""}>
            <h1
              className={
                isPublic
                  ? "max-w-[540px] text-[36px] leading-[1.1] font-semibold tracking-tight text-black max-md:max-w-none max-md:text-[1.75rem] max-md:leading-[1.12] sm:max-md:text-[2rem]"
                  : "text-4xl leading-tight font-semibold tracking-tight text-black"
              }
            >
              {event.eventName}
            </h1>
            {isPublic ? (
              hasAvailablePublicSlots ? (
                useOneToOneBookingModal ? null : (
              <div className="mt-5">
                  <div
                    ref={calendarDropdownRef}
                    className={`relative rounded-xl border border-dashed bg-white/75 p-2 transition-colors duration-200 ${
                      isCalendarSelectionFlash
                        ? "border-emerald-500/80"
                        : "border-black/25"
                    }`}
                  >
                  <button
                    type="button"
                    onClick={() => {
                      if (showPublicCalendarPicker) {
                        setIsCalendarDropdownOpen((prev) => !prev);
                      }
                    }}
                    className={`flex w-full items-center justify-between gap-4 rounded-lg px-1 py-1 text-left transition ${
                      showPublicCalendarPicker
                        ? "hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                        : "cursor-default"
                    }`}
                    aria-expanded={showPublicCalendarPicker ? isCalendarDropdownOpen : undefined}
                    aria-label={
                      showPublicCalendarPicker
                        ? "Toggle event calendar options"
                        : "Event date and time"
                    }
                  >
                    <div className="flex items-center gap-5 max-md:items-start max-md:gap-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/12 bg-[#f6f6f4]">
                      <div className="relative h-[40%] bg-[#ececeb] text-center leading-none">
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-bold tracking-[0.08em] text-black/55">
                          {dateParts.calendarMonth || "—"}
                        </span>
                      </div>
                      <div className="flex h-[60%] items-center justify-center text-center">
                        <span className="text-[20px] leading-none text-black/65">
                          {dateParts.calendarDay || "—"}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] leading-snug font-semibold text-black max-md:text-[15px]">
                        {dateParts.titleLine}
                      </p>
                      <p className="mt-1 text-[14px] leading-snug text-black/55 max-md:text-[13px]">
                        {selectedTimeSubtitle}
                      </p>
                    </div>
                    <div className="ml-8 flex items-center gap-3 max-md:ml-5 max-md:gap-2">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-[#f2f2f0] text-black/55">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" className="h-[18px] w-[18px] shrink-0">
                          <path fill="currentColor" d="M48 13.208v22.704c0 1.504-.828 1.332-1.533.783L36.5 29.25v-9.38l9.967-7.446c.87-.725 1.533-.556 1.533.784M27.553 12c3.768-.017 6.837 3.071 6.856 6.9v16.936a1.25 1.25 0 0 1-1.246 1.255H8.856c-3.768.017-6.837-3.071-6.856-6.9V13.255A1.25 1.25 0 0 1 3.246 12Z"></path>
                        </svg>
                      </div>
                      <p className="min-w-0 self-center text-[16px] leading-snug font-semibold text-black max-md:text-[15px]">
                        {selectedCalendar?.platform || event.platform}
                      </p>
                    </div>
                    </div>
                    {showPublicCalendarPicker ? (
                    <span
                      className={`shrink-0 pr-1 text-black/55 transition-transform ${
                        isCalendarDropdownOpen ? "rotate-180" : ""
                      }`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="none"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 7.5L10 12.5L15 7.5"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    ) : null}
                  </button>

                  {showPublicCalendarPicker && isCalendarDropdownOpen ? (
                    <div
                      className={`mt-2 space-y-2 rounded-lg bg-white p-2 ${
                        calendarRows.length > 5
                          ? "max-h-[min(32rem,calc(100vh-14rem))] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
                          : ""
                      }`}
                    >
                    {calendarRows.map((slot, index) => {
                      const row = publicSlotCalendarDisplay(slot, displayTimeZone);
                      return (
                        <button
                          type="button"
                          key={`calendar-slot-${slot.slotIndex}`}
                          onClick={() => {
                            setSelectedCalendarIndex(index);
                            setIsCalendarDropdownOpen(false);
                            setIsCalendarSelectionFlash(true);
                          }}
                          className={`flex w-full items-center gap-5 rounded-md border px-3 py-2 text-left transition max-md:items-start max-md:gap-3 ${
                            selectedCalendarIndex === index
                              ? "border-black/20 bg-black/[0.03]"
                              : "border-black/8 hover:border-black/16 hover:bg-black/[0.02]"
                          }`}
                        >
                          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/12 bg-[#f6f6f4]">
                            <div className="relative h-[40%] bg-[#ececeb] text-center leading-none">
                              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-bold tracking-[0.08em] text-black/55">
                                {row.calendarMonth || "—"}
                              </span>
                            </div>
                            <div className="flex h-[60%] items-center justify-center text-center">
                              <span className="text-[20px] leading-none text-black/65">
                                {row.calendarDay || "—"}
                              </span>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] leading-snug font-semibold text-black max-md:text-[14px]">
                              {row.titleLine} • {row.timeSubtitle}
                            </p>
                          </div>
                          <div className="ml-8 flex items-center gap-3 max-md:ml-5 max-md:gap-2">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-[#f2f2f0] text-black/55">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" className="h-[18px] w-[18px] shrink-0">
                                <path fill="currentColor" d="M48 13.208v22.704c0 1.504-.828 1.332-1.533.783L36.5 29.25v-9.38l9.967-7.446c.87-.725 1.533-.556 1.533.784M27.553 12c3.768-.017 6.837 3.071 6.856 6.9v16.936a1.25 1.25 0 0 1-1.246 1.255H8.856c-3.768.017-6.837-3.071-6.856-6.9V13.255A1.25 1.25 0 0 1 3.246 12Z"></path>
                              </svg>
                            </div>
                            <p className="min-w-0 self-center text-[16px] leading-snug font-semibold text-black max-md:text-[15px]">
                              {slot.platform || "Zoom"}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                    </div>
                  ) : null}
                  </div>
              </div>
                )
              ) : (
              <div className="mt-5">
                  <div className="rounded-2xl border border-dashed border-black/30 bg-[linear-gradient(135deg,#ffffff_0%,#f8f8f5_100%)] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-[#f3f3ef] text-black/65">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
                          <path d="M4 7.5h16v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z" stroke="currentColor" strokeWidth="1.5" />
                          <path d="m4.5 8 7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[15px] leading-snug font-semibold text-black">Contact the event owner</p>
                        <p className="mt-1 text-[13px] text-black/55">This event is fully booked. Reach out to request the next available slot.</p>
                      </div>
                    </div>
                    {ownerContactHref ? (
                      <a
                        href={ownerContactHref}
                        className="mt-3 inline-flex h-10 items-center justify-center rounded-xl border border-black/15 bg-white px-4 text-sm font-medium text-black/75 transition hover:border-black/25 hover:text-black"
                      >
                        {ownerContactEmail || "Contact owner by email"}
                      </a>
                    ) : (
                      <p className="mt-2 text-sm text-black/55">Owner contact unavailable</p>
                    )}
                  </div>
              </div>
              )
            ) : (
              <div
                className={`mt-4 text-sm text-black/70 ${
                  calendarRows.length > 1 ? "space-y-3" : "space-y-1"
                }`}
              >
                {calendarRows.map((slot) => {
                  const parts = formatEventDateParts(slot.eventDate || event.eventDate);
                  const timeStart = clean(slot.eventTimeStart) || event.eventTimeStart;
                  const timeEnd = clean(slot.eventTimeEnd) || event.eventTimeEnd;
                  const platformLabel = clean(slot.platform) || event.platform;
                  return (
                    <div
                      key={`dashboard-calendar-${slot.slotIndex}`}
                      className={calendarRows.length > 1 ? "space-y-1" : undefined}
                    >
                      {!isWebinar &&
                      calendarRows.length > 1 &&
                      isSameWallDayExtraSlot(
                        slot.slotIndex,
                        slot.eventDate || event.eventDate,
                        event.eventDate
                      ) ? (
                        <p className="text-black/50">
                          Time on same day · slot {slot.slotIndex + 1}
                        </p>
                      ) : null}
                      <p>{parts.titleLine}</p>
                      <p>
                        {timeStart} - {timeEnd}
                      </p>
                      <p>{platformLabel}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className={isPublic ? "p-0" : "mt-6 rounded-xl border border-black/10 bg-[#f8f8f6] p-4"}>
            <div className={isPublic ? "overflow-hidden rounded-xl border border-black/10 bg-white" : ""}>
              {isPublic ? (
                <div className="border-b border-black/10 bg-[#f2f2f0] px-4 py-2">
                  <p className="text-[14px] font-medium text-black/60">Registration</p>
                </div>
              ) : (
                <p className="text-xs text-black/50">Registration</p>
              )}
              <div className={isPublic ? "p-4" : ""}>
                <div className={isPublic ? "mt-4" : "mt-3"}>
                  {isPublic ? (
                    hasAvailablePublicSlots ? (
                      useOneToOneBookingModal ? (
                        <PublicOneToOneBookingFlow
                          publicId={event.publicId}
                          eventName={event.eventName}
                          hostName={publicHostName}
                          platform={event.platform}
                          slots={calendarRows}
                          onRegisterSuccess={handlePublicRegisterSuccess}
                        />
                      ) : (
                        <PublicRegisterSheet
                          publicId={event.publicId}
                          calendarSlotIndex={selectedCalendar?.slotIndex ?? 0}
                          calendarOptions={calendarInviteOptions}
                          hideSlotPicker={isWebinar || calendarInviteOptions.length <= 1}
                          waitlistMode={isWaitlistedWebinar}
                          onRegisterSuccess={handlePublicRegisterSuccess}
                        />
                      )
                    ) : (
                      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                        This event is fully booked.
                      </p>
                    )
                  ) : (
                    clean(event.registerLink) ? (
                      <a
                        href={event.registerLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#171717] text-sm font-medium text-white"
                      >
                        Register
                      </a>
                    ) : null
                  )}
                </div>
              </div>
            </div>
          </section>

          {aboutRaw ? (
            <section className={isPublic ? "p-0" : "mt-8 border-t border-black/10 pt-6"}>
            <h2
              className={
                isPublic
                  ? "border-b border-black/12 pb-3 text-[16px] leading-none font-semibold tracking-tight text-[#141414]"
                  : "border-b border-black/12 pb-3 text-[16px] leading-none font-semibold tracking-tight text-[#141414]"
              }
            >
              About Event
            </h2>
            {aboutUsesHtml ? (
              <div
                className="about-event-body mt-6 text-[16px] leading-[1.5] text-[#141414] [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-black/15 [&_blockquote]:pl-4 [&_h1]:mt-8 [&_h1]:text-[22px] [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:text-[#141414] [&_h3]:mt-6 [&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:text-[#141414] [&_hr]:my-8 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-black/15 [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-black/10 [&_td]:p-2 [&_th]:border [&_th]:border-black/10 [&_th]:bg-black/[0.03] [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6"
                dangerouslySetInnerHTML={{ __html: sanitizeEventHtml(aboutRaw) }}
              />
            ) : (
              <div className="mt-6 space-y-6">
                {(aboutLegacyParagraphs.length > 0 ? aboutLegacyParagraphs : [aboutRaw]).map(
                  (paragraph, index) => (
                    <p
                      key={`${paragraph.slice(0, 20)}-${index}`}
                      className={
                        index === 0
                          ? "whitespace-pre-line text-[16px] leading-[1.5] font-semibold text-[#141414]"
                          : "whitespace-pre-line text-[16px] leading-[1.5] text-[#141414]"
                      }
                    >
                      {paragraph}
                    </p>
                  )
                )}
              </div>
            )}
            </section>
          ) : null}

          {scheduleParts.length ? (
            <section className="mt-8 border-t border-black/10 pt-6">
            {scheduleHeading ? (
              <h2
                className={
                  isPublic
                    ? "text-[16px] leading-none font-semibold tracking-tight text-[#141414]"
                    : "text-[16px] leading-none font-semibold tracking-tight text-[#141414]"
                }
              >
                {scheduleHeading}
              </h2>
            ) : null}
            <div className="mt-6 space-y-7">
              {scheduleParts.map((part, index) => (
                <div key={`${part.title}-${index}`}>
                  <p className="text-[16px] leading-[1.45] text-[#141414]">
                    <span className="font-semibold text-[#141414]">
                      {`Part ${index + 1} — ${part.title || "Session"}`}
                    </span>{" "}
                    {part.content}
                  </p>
                </div>
              ))}
            </div>
          </section>
          ) : null}

          {hosts.length ? (
            <section className="mt-8 border-t border-black/10 pt-6">
            <h2
              className={
                isPublic
                  ? "text-[16px] leading-none font-semibold tracking-tight text-[#141414]"
                  : "text-[16px] leading-none font-semibold tracking-tight text-[#141414]"
              }
            >
              Your hosts
            </h2>
            <div className="mt-6 space-y-5">
              {hosts.map((host, index) => (
                <p key={`${host.name}-${index}`} className="text-[16px] leading-[1.45] text-[#141414]">
                  <span className="font-semibold text-[#141414]">{host.name}</span>
                  {clean(host.designation) ? `, ${host.designation}` : ""}
                </p>
              ))}
            </div>
          </section>
          ) : null}

          {clean(event.eventMoreDetails) || clean(event.registerSupportText) ? (
            <section className="mt-8 border-t border-black/10 pt-6">
              {clean(event.eventMoreDetails) ? (
                <p className="text-[16px] leading-[1.45] font-semibold text-[#141414]">
                  {event.eventMoreDetails}
                </p>
              ) : null}
              <div className="mt-4 text-[16px] leading-[1.45] text-[#141414]">
                <span className="font-semibold text-[#141414]">Register Now</span>{" "}
                {hasAvailablePublicSlots ? (
                  useOneToOneBookingModal ? (
                    <PublicOneToOneBookingFlow
                      publicId={event.publicId}
                      eventName={event.eventName}
                      hostName={publicHostName}
                      platform={event.platform}
                      slots={calendarRows}
                      triggerVariant="link"
                      onRegisterSuccess={handlePublicRegisterSuccess}
                    />
                  ) : (
                    <PublicRegisterSheet
                      publicId={event.publicId}
                      triggerVariant="link"
                      calendarSlotIndex={selectedCalendar?.slotIndex ?? 0}
                      calendarOptions={calendarInviteOptions}
                      hideSlotPicker={isWebinar || calendarInviteOptions.length <= 1}
                      waitlistMode={isWaitlistedWebinar}
                      onRegisterSuccess={handlePublicRegisterSuccess}
                    />
                  )
                ) : (
                  <span className="text-red-700">All slots are booked</span>
                )}
              </div>
              {clean(event.registerSupportText) ? (
                <p className="mt-4 whitespace-pre-line text-[16px] leading-[1.45] text-[#141414]">
                  {event.registerSupportText}
                </p>
              ) : null}
            </section>
          ) : null}

          {hasWhySection ? (
            <section className="mt-8 border-t border-black/10 pt-6">
              {clean(event.whyTitle) ? (
                <h2 className="text-[16px] font-semibold text-black">{event.whyTitle}</h2>
              ) : null}
              {clean(event.aboutWhy) ? (
                <div
                  className="mt-3 text-[16px] leading-[1.5] text-black/80"
                  dangerouslySetInnerHTML={{ __html: sanitizeBasicHtml(event.aboutWhy) }}
                />
              ) : null}
              {clean(event.endLine) ? (
                <p className="mt-4 text-[16px] font-medium text-black/80">{event.endLine}</p>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
