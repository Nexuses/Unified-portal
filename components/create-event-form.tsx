"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
import { ImageUploadField } from "@/components/image-upload-field";
import { EventHtmlEditor } from "@/components/event-html-editor";
import { EventEmailFlowPanel } from "@/components/event-email-flow-panel";
import { isConnectedSender } from "@/lib/smtp-senders";
import {
  extractRawEventCalendarsField,
  normalizeEventCalendarsArray,
} from "@/lib/normalize-event-calendars";
import {
  EVENT_FORMAT_OPTIONS,
  type EventFormat,
  eventFormatLabel,
  isSharedSessionFormat,
  isWaitlistedWebinarFormat,
  normalizeEventFormat,
} from "@/lib/event-format";
import {
  flattenOtherDateCalendars,
  type OtherDateCalendar,
  type SameDayTimeSlot,
} from "@/lib/event-form-calendars";
import {
  DEFAULT_ONE_TO_ONE_HORIZON_DAYS,
  DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES,
  DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS,
  defaultWeeklyHours,
  deriveWeeklyHoursFromLegacyEvent,
  firstWeeklySlotPreview,
  normalizeWeeklyHours,
  type WeeklyDayHours,
} from "@/lib/one-to-one-weekly-hours";
import { OneToOneAvailabilityEditor } from "@/components/one-to-one-availability-editor";
import { type EventPlatform, normalizeEventPlatform, PLATFORM_OPTIONS, platformUsesMeetingLink } from "@/lib/event-platform";
import { sanitizeEventHtml } from "@/lib/sanitize-event-html";
import {
  normalizeEventEmailFlows,
  type EventEmailFlows,
} from "@/lib/event-email-flows";
import { normalizeTimeInput, toWallDateYmd } from "@/lib/public-event-time";

export {
  type OtherDateCalendar,
  type SameDayTimeSlot,
} from "@/lib/event-form-calendars";

type SchedulePart = { title: string; content: string };
type Host = { name: string; designation: string };
type WhyQuestion = { question: string };

export type CreateEventFormData = {
  eventFormat: EventFormat;
  projectName: string;
  eventName: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  replyToEmail: string;
  inviteSenderId: string;
  inviteSenderName: string;
  inviteSenderEmail: string;
  inviteReplyToEmail: string;
  calendarInviteAgenda: string;
  eventBanner: string;
  emailIncludeEventBanner: boolean;
  publicHeaderLogo: string;
  eventDate: string;
  oneToOneBookingEndDate: string;
  oneToOneWeeklyHours: WeeklyDayHours[];
  oneToOneBookingHorizonDays: number;
  oneToOneMinNoticeDays: number;
  oneToOneMeetingDurationMinutes: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink: string;
  ownerName: string;
  ownerEmail: string;
  /** Extra start/end rows for the main event date (saved as `eventCalendars` with same date as primary). */
  sameDayTimeSlots: SameDayTimeSlot[];
  /** Other dates; each group can have multiple times on that day. */
  eventCalendars: OtherDateCalendar[];
  registrationTitle: string;
  companyLogo: string;
  companyName: string;
  hostContact: string;
  aboutEvent: string;
  scheduleHeading: string;
  scheduleDurationMinutes: number;
  scheduleParts: SchedulePart[];
  hosts: Host[];
  eventMoreDetails: string;
  hashTags: string[];
  registerNowText: string;
  registerLink: string;
  whyTitle: string;
  whyContent: string;
  questionTitle: string;
  questions: WhyQuestion[];
  aboutWhy: string;
  endLine: string;
  emailFlows: EventEmailFlows;
};

const emptyForm: CreateEventFormData = {
  eventFormat: "one_to_one",
  projectName: "",
  eventName: "",
  senderId: "",
  senderName: "",
  senderEmail: "",
  replyToEmail: "",
  inviteSenderId: "",
  inviteSenderName: "",
  inviteSenderEmail: "",
  inviteReplyToEmail: "",
  calendarInviteAgenda: "",
  eventBanner: "",
  emailIncludeEventBanner: true,
  publicHeaderLogo: "",
  eventDate: "",
  oneToOneBookingEndDate: "",
  oneToOneWeeklyHours: defaultWeeklyHours(),
  oneToOneBookingHorizonDays: DEFAULT_ONE_TO_ONE_HORIZON_DAYS,
  oneToOneMinNoticeDays: DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS,
  oneToOneMeetingDurationMinutes: DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES,
  eventTimeStart: "",
  eventTimeEnd: "",
  platform: "Zoom",
  platformLink: "",
  ownerName: "",
  ownerEmail: "",
  sameDayTimeSlots: [],
  eventCalendars: [],
  registrationTitle: "",
  companyLogo: "",
  companyName: "",
  hostContact: "",
  aboutEvent: "",
  scheduleHeading: "",
  scheduleDurationMinutes: 90,
  scheduleParts: [{ title: "", content: "" }],
  hosts: [{ name: "", designation: "" }],
  eventMoreDetails: "",
  hashTags: ["", ""],
  registerNowText: "",
  registerLink: "",
  whyTitle: "",
  whyContent: "",
  questionTitle: "",
  questions: [{ question: "" }],
  aboutWhy: "",
  endLine: "",
  emailFlows: {},
};

type CreateEventFormProps = {
  mode?: "create" | "edit";
  eventId?: string;
  initialData?: Partial<CreateEventFormData>;
};

export function CreateEventForm({
  mode = "create",
  eventId,
  initialData,
}: CreateEventFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const mergedInitial = useMemo(() => {
    const raw = { ...emptyForm, ...initialData };
    const eventFormat = normalizeEventFormat(raw.eventFormat);
    const sharedSession = isSharedSessionFormat(eventFormat);
    const weeklyHours = Array.isArray((raw as { oneToOneWeeklyHours?: unknown }).oneToOneWeeklyHours)
      ? normalizeWeeklyHours((raw as { oneToOneWeeklyHours?: unknown }).oneToOneWeeklyHours)
      : deriveWeeklyHoursFromLegacyEvent({
          eventTimeStart: raw.eventTimeStart,
          eventTimeEnd: raw.eventTimeEnd,
          eventCalendars:
            extractRawEventCalendarsField(raw) ?? raw.eventCalendars,
        });
    const numericDefaults = {
      oneToOneBookingHorizonDays:
        typeof raw.oneToOneBookingHorizonDays === "number" && raw.oneToOneBookingHorizonDays > 0
          ? raw.oneToOneBookingHorizonDays
          : DEFAULT_ONE_TO_ONE_HORIZON_DAYS,
      oneToOneMinNoticeDays:
        typeof raw.oneToOneMinNoticeDays === "number" && raw.oneToOneMinNoticeDays >= 0
          ? raw.oneToOneMinNoticeDays
          : DEFAULT_ONE_TO_ONE_MIN_NOTICE_DAYS,
      oneToOneMeetingDurationMinutes:
        typeof raw.oneToOneMeetingDurationMinutes === "number" &&
        raw.oneToOneMeetingDurationMinutes >= 15
          ? raw.oneToOneMeetingDurationMinutes
          : DEFAULT_ONE_TO_ONE_MEETING_DURATION_MINUTES,
    };

    if (sharedSession) {
      return {
        ...raw,
        eventFormat,
        eventDate: toWallDateYmd(raw.eventDate),
        eventTimeStart: normalizeTimeInput(raw.eventTimeStart),
        eventTimeEnd: normalizeTimeInput(raw.eventTimeEnd),
        emailFlows: normalizeEventEmailFlows(raw.emailFlows, eventFormat, raw.eventName ?? ""),
        oneToOneWeeklyHours: weeklyHours,
        ...numericDefaults,
        sameDayTimeSlots: [],
        eventCalendars: [],
      };
    }

    const preview = firstWeeklySlotPreview({
      oneToOneWeeklyHours: weeklyHours,
      oneToOneBookingHorizonDays: raw.oneToOneBookingHorizonDays,
      oneToOneMinNoticeDays: raw.oneToOneMinNoticeDays,
      oneToOneMeetingDurationMinutes: raw.oneToOneMeetingDurationMinutes,
      eventTimeStart: raw.eventTimeStart,
      eventTimeEnd: raw.eventTimeEnd,
      eventCalendars: extractRawEventCalendarsField(raw) ?? raw.eventCalendars,
      platform: raw.platform,
      platformLink: raw.platformLink,
    });
    return {
      ...raw,
      eventFormat,
      emailFlows: normalizeEventEmailFlows(raw.emailFlows, eventFormat, raw.eventName ?? ""),
      oneToOneWeeklyHours: weeklyHours,
      ...numericDefaults,
      sameDayTimeSlots: [],
      eventCalendars: [],
      ...(preview
        ? {
            eventDate: preview.eventDate,
            eventTimeStart: preview.eventTimeStart,
            eventTimeEnd: preview.eventTimeEnd,
            platform: preview.platform,
            platformLink: preview.platformLink,
          }
        : {}),
    };
  }, [initialData]);

  const [form, setForm] = useState<CreateEventFormData>(mergedInitial);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (mode === "edit") {
      setForm(mergedInitial);
    }
  }, [mode, eventId, mergedInitial]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [senders, setSenders] = useState<Array<{ id: string; fromEmail: string }>>([]);
  const [sendersLoading, setSendersLoading] = useState(true);
  const [isEmailFlowOpen, setIsEmailFlowOpen] = useState(false);
  const isWebinar = isSharedSessionFormat(form.eventFormat);
  const isWaitlistedWebinar = isWaitlistedWebinarFormat(form.eventFormat);
  const showMeetingLink = platformUsesMeetingLink(form.platform);

  function handlePlatformChange(nextPlatform: EventPlatform) {
    setForm((prev) => ({
      ...prev,
      platform: nextPlatform,
      platformLink: platformUsesMeetingLink(nextPlatform) ? prev.platformLink : "",
    }));
  }

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      emailFlows: normalizeEventEmailFlows(prev.emailFlows, prev.eventFormat, prev.eventName),
    }));
  }, [form.eventFormat]);

  const inputClass =
    "mt-2 h-11 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm text-black outline-none transition focus:border-black/30 focus:bg-white";

  function blockNativeFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  useEffect(() => {
    let mounted = true;
    async function loadSenders() {
      setSendersLoading(true);
      try {
        const response = await fetch("/api/smtp/senders");
        const data = (await response.json()) as Array<{
          id?: string;
          fromEmail?: string;
          connection?: { status?: string };
        }>;
        if (!mounted || !response.ok || !Array.isArray(data)) {
          return;
        }
        setSenders(
          data
            .filter((sender) => isConnectedSender(sender) && sender.id && sender.fromEmail)
            .map((sender) => ({ id: String(sender.id), fromEmail: String(sender.fromEmail) })),
        );
      } catch {
        if (mounted) {
          setSenders([]);
        }
      } finally {
        if (mounted) {
          setSendersLoading(false);
        }
      }
    }
    void loadSenders();
    return () => {
      mounted = false;
    };
  }, []);

  function chooseSender(kind: "invite" | "calendar", senderId: string) {
    const selected = senders.find((sender) => sender.id === senderId);
    setForm((prev) =>
      kind === "calendar"
        ? {
            ...prev,
            inviteSenderId: senderId,
            inviteSenderEmail: selected?.fromEmail ?? "",
          }
        : {
            ...prev,
            senderId,
            senderEmail: selected?.fromEmail ?? "",
          },
    );
  }

  async function saveEvent() {
    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      if (!form.senderId) {
        setError("Select a connected sender for invite emails.");
        setIsSubmitting(false);
        return;
      }
      const { sameDayTimeSlots, eventCalendars, ...formWithoutSlots } = form;
      const isWebinarSave = isSharedSessionFormat(form.eventFormat);
      const weeklyPreview = !isWebinarSave
        ? firstWeeklySlotPreview({
            oneToOneWeeklyHours: form.oneToOneWeeklyHours,
            oneToOneBookingHorizonDays: form.oneToOneBookingHorizonDays,
            oneToOneMinNoticeDays: form.oneToOneMinNoticeDays,
            oneToOneMeetingDurationMinutes: form.oneToOneMeetingDurationMinutes,
            platform: form.platform,
            platformLink: form.platformLink,
          })
        : null;
      const sameDayAsCalendars = isWebinarSave
        ? []
        : sameDayTimeSlots.map((row) => ({
            eventDate: form.eventDate,
            eventTimeStart: row.eventTimeStart,
            eventTimeEnd: row.eventTimeEnd,
            platform: normalizeEventPlatform(form.platform),
            platformLink: form.platformLink,
          }));
      const payload = {
        ...formWithoutSlots,
        eventFormat: normalizeEventFormat(form.eventFormat),
        platform: normalizeEventPlatform(form.platform),
        platformLink: platformUsesMeetingLink(form.platform) ? form.platformLink : "",
        ...(isWebinarSave
          ? {
              eventDate: toWallDateYmd(form.eventDate),
              eventTimeStart: normalizeTimeInput(form.eventTimeStart),
              eventTimeEnd: normalizeTimeInput(form.eventTimeEnd),
              ownerName: "",
              ownerEmail: "",
            }
          : {}),
        ...(!isWebinarSave
          ? {
              oneToOneWeeklyHours: form.oneToOneWeeklyHours,
              oneToOneBookingHorizonDays: form.oneToOneBookingHorizonDays,
              oneToOneMinNoticeDays: form.oneToOneMinNoticeDays,
              oneToOneMeetingDurationMinutes: form.oneToOneMeetingDurationMinutes,
              oneToOneBookingEndDate: "",
              eventDate: weeklyPreview?.eventDate ?? form.eventDate,
              eventTimeStart: weeklyPreview?.eventTimeStart ?? form.eventTimeStart,
              eventTimeEnd: weeklyPreview?.eventTimeEnd ?? form.eventTimeEnd,
              eventCalendars: [],
            }
          : {}),
        aboutEvent: sanitizeEventHtml(formWithoutSlots.aboutEvent),
        ...(isWebinarSave
          ? {
              eventCalendars: [
                ...sameDayAsCalendars,
                ...flattenOtherDateCalendars(eventCalendars).map((slot) => ({
                  eventDate: slot.eventDate,
                  eventTimeStart: slot.eventTimeStart,
                  eventTimeEnd: slot.eventTimeEnd,
                  platform: normalizeEventPlatform(slot.platform),
                  platformLink: slot.platformLink,
                })),
              ],
            }
          : {}),
        hashTags: form.hashTags.map((tag) => tag.trim()).filter(Boolean),
        hashTagOne: form.hashTags[0]?.trim() ?? "",
        hashTagTwo: form.hashTags[1]?.trim() ?? "",
        whyContent: "",
        questionTitle: "",
        questions: [],
        emailFlows: normalizeEventEmailFlows(
          form.emailFlows,
          form.eventFormat,
          form.eventName
        ),
        emailIncludeEventBanner: form.emailIncludeEventBanner,
      };

      const response = await fetch(mode === "edit" ? `/api/events/${eventId}` : "/api/events", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "edit" ? { action: "update", payload } : payload),
      });

      const data = (await response.json()) as { message?: string; eventId?: string };
      if (!response.ok) {
        setError(data.message ?? "Unable to save event.");
        return;
      }

      setMessage(data.message ?? "Saved.");
      router.refresh();
      if (mode === "create" && data.eventId) {
        router.push(`/portal/marketing/events/${data.eventId}`);
        return;
      }
      if (eventId) {
        router.push(`/portal/marketing/events/${eventId}`);
      }
    } catch {
      setError("Failed to save event.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form ref={formRef} className="event-form" onSubmit={blockNativeFormSubmit}>
      <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-3">
        <div>
          <p className="text-xs text-black/50">{mode === "edit" ? "Edit Event" : "Create Event"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-black">{form.eventName || "Untitled event"}</p>
            <span className="rounded-full border border-black/10 bg-[#fafaf8] px-2.5 py-0.5 text-[11px] font-medium text-black/60">
              {eventFormatLabel(form.eventFormat)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEmailFlowOpen(true)}
            className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 bg-white px-5 text-sm font-medium text-black hover:bg-black/5"
          >
            Email Flow
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void saveEvent()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#171717] px-6 text-sm font-medium text-white hover:bg-black disabled:opacity-60"
          >
            <ButtonLoadingContent loading={isSubmitting} loadingText="Saving...">
              {mode === "edit" ? "Update Event" : "Save Event"}
            </ButtonLoadingContent>
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <div className="grid gap-8 md:grid-cols-[300px_1fr]">
        <aside className="space-y-5">
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <ImageUploadField
              label="Public header logo"
              kind="header"
              value={form.publicHeaderLogo}
              onChange={(publicHeaderLogo) =>
                setForm((prev) => ({ ...prev, publicHeaderLogo }))
              }
              inputClass={inputClass}
            />
            <p className="mt-2 text-xs text-black/50">
              Shown in the top-left of the public event page. Leave empty to use the default
              Nexuses logo.
            </p>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <ImageUploadField
              label="Event banner"
              kind="banner"
              value={form.eventBanner}
              onChange={(eventBanner) => setForm((prev) => ({ ...prev, eventBanner }))}
              inputClass={inputClass}
            />
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="border-b border-black/10 pb-2 text-sm font-semibold text-black/70">Hosted By</p>
            <div className="mt-3">
              <ImageUploadField
                label="Company logo"
                kind="company"
                value={form.companyLogo}
                onChange={(companyLogo) => setForm((prev) => ({ ...prev, companyLogo }))}
                inputClass={inputClass}
              />
            </div>
            <label className="block">
              <span className="text-sm text-black/70">Company Name</span>
              <input
                type="text"
                className={inputClass}
                placeholder="Company name"
                value={form.companyName}
                onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-sm text-black/70">Host Contact URL</span>
              <input
                type="url"
                className={inputClass}
                placeholder="https://company.com"
                value={form.hostContact}
                onChange={(event) => setForm((prev) => ({ ...prev, hostContact: event.target.value }))}
              />
            </label>
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-black/70">Hash Tags</span>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, hashTags: [...prev.hashTags, ""] }))}
                  className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/5"
                >
                  Add
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {form.hashTags.map((tag, index) => (
                  <div key={`tag-${index}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="#topic"
                      className="h-10 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm outline-none focus:border-black/30"
                      value={tag}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          hashTags: prev.hashTags.map((item, i) => (i === index ? event.target.value : item)),
                        }))
                      }
                    />
                    {form.hashTags.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            hashTags: prev.hashTags.filter((_, i) => i !== index),
                          }))
                        }
                        className="text-xs text-red-600"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className="space-y-8 rounded-2xl border border-black/10 bg-white p-6">
          <section>
            <label className="block">
              <span className="text-sm text-black/70">Event Name</span>
              <input
                type="text"
                className="mt-2 h-14 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-4 text-2xl font-semibold outline-none focus:border-black/30 focus:bg-white"
                placeholder="Event name"
                value={form.eventName}
                onChange={(event) => setForm((prev) => ({ ...prev, eventName: event.target.value }))}
              />
            </label>

            <div className="mt-6 space-y-4 rounded-2xl border border-black/10 bg-[#fafaf8]/60 p-4">
              <div>
                <h3 className="text-sm font-semibold text-black">Sender Email</h3>
                <p className="mt-1 text-xs text-black/45">
                  Used when sending invite and reminder notification emails.
                </p>
              </div>

              <label className="block">
                <span className="text-sm text-black/70">Sender Name</span>
                <input
                  type="text"
                  className={inputClass}
                  value={form.senderName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, senderName: event.target.value }))
                  }
                  placeholder="Your name or team"
                />
                <p className="mt-1.5 text-xs text-black/45">
                  Used as the sender name on invite and reminder emails. Leave blank to use the
                  default SMTP sender name.
                </p>
              </label>

              <label className="block">
                <span className="text-sm text-black/70">Sender</span>
                <select
                  className={inputClass}
                  value={form.senderId}
                  disabled={sendersLoading}
                  onChange={(event) => chooseSender("invite", event.target.value)}
                >
                  <option value="">{sendersLoading ? "Loading senders..." : "Select a connected sender"}</option>
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.fromEmail}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-black/45">
                  Invite and reminder emails send from this mailbox. Disconnected senders are not listed.
                </p>
              </label>

              <label className="block">
                <span className="text-sm text-black/70">Reply-To Email</span>
                <input
                  type="email"
                  className={inputClass}
                  value={form.replyToEmail}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, replyToEmail: event.target.value }))
                  }
                  placeholder="name@company.com"
                />
                <p className="mt-1.5 text-xs text-black/45">
                  Where attendee replies go. Leave blank to omit a reply-to address.
                </p>
              </label>
            </div>

            <div className="mt-4 space-y-4 rounded-2xl border border-black/10 bg-[#fafaf8]/60 p-4">
              <div>
                <h3 className="text-sm font-semibold text-black">Invite Email</h3>
                <p className="mt-1 text-xs text-black/45">
                  Used for the calendar invite (.ics) after a guest accepts. Falls back to Sender
                  Email when left blank.
                </p>
              </div>

              <label className="block">
                <span className="text-sm text-black/70">Sender Name</span>
                <input
                  type="text"
                  className={inputClass}
                  value={form.inviteSenderName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, inviteSenderName: event.target.value }))
                  }
                  placeholder="Your name or team"
                />
                <p className="mt-1.5 text-xs text-black/45">
                  Used as the sender name on calendar invite emails. Leave blank to use the Sender
                  Email name above.
                </p>
              </label>

              <label className="block">
                <span className="text-sm text-black/70">Calendar sender</span>
                <select
                  className={inputClass}
                  value={form.inviteSenderId}
                  disabled={sendersLoading}
                  onChange={(event) => chooseSender("calendar", event.target.value)}
                >
                  <option value="">
                    {sendersLoading ? "Loading senders..." : "Same as invite sender"}
                  </option>
                  {senders.map((sender) => (
                    <option key={`cal-${sender.id}`} value={sender.id}>
                      {sender.fromEmail}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-black/45">
                  Calendar invites (.ics) send from this mailbox. Leave blank to use the invite sender.
                </p>
              </label>

              <label className="block">
                <span className="text-sm text-black/70">Reply-To Email</span>
                <input
                  type="email"
                  className={inputClass}
                  value={form.inviteReplyToEmail}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, inviteReplyToEmail: event.target.value }))
                  }
                  placeholder="name@company.com"
                />
                <p className="mt-1.5 text-xs text-black/45">
                  Where calendar invite replies go. Leave blank to fall back to Sender Email
                  reply-to.
                </p>
              </label>

              <label className="block">
                <span className="text-sm text-black/70">Calendar invite agenda</span>
                <textarea
                  className="mt-2 min-h-[120px] w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 py-3 text-sm text-black outline-none transition focus:border-black/30 focus:bg-white"
                  value={form.calendarInviteAgenda}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, calendarInviteAgenda: event.target.value }))
                  }
                  placeholder="One point per line"
                />
                <p className="mt-1.5 text-xs text-black/45">
                  One point per line. These appear in the calendar invite email body and .ics
                  description after a guest accepts.
                </p>
              </label>
            </div>

            <label className="mt-4 block">
              <span className="text-sm text-black/70">Event type</span>
              <select
                className={inputClass}
                value={form.eventFormat}
                onChange={(event) => {
                  const nextFormat = normalizeEventFormat(event.target.value);
                  setForm((prev) => ({
                    ...prev,
                    eventFormat: nextFormat,
                    ...(isSharedSessionFormat(nextFormat)
                      ? {
                          sameDayTimeSlots: [],
                          eventCalendars: [],
                          ownerName: "",
                          ownerEmail: "",
                        }
                      : {}),
                  }));
                }}
              >
                {EVENT_FORMAT_OPTIONS.map((option: (typeof EVENT_FORMAT_OPTIONS)[number]) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {isWaitlistedWebinar ? (
                <p className="mt-1.5 text-xs text-black/50">
                  Webinar Waitlist uses one shared time slot. Guests join a waitlist; you confirm
                  or reject each registration from Submissions.
                </p>
              ) : isWebinar ? (
                <p className="mt-1.5 text-xs text-black/50">
                  Webinar uses one shared time slot — everyone registers for the same session. Use
                  host contact below if attendees need to reach you.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-black/50">
                  Set weekly hours and booking rules—guests pick from generated slots on the public page.
                </p>
              )}
              <p className="mt-1.5 text-xs text-black/45">
                Submissions and registration follow this event type only — not the platform below.
              </p>
            </label>

            {!isWebinar ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm text-black/70">Owner Name</span>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Host name"
                    value={form.ownerName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, ownerName: event.target.value }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-sm text-black/70">Owner Email</span>
                  <input
                    type="email"
                    className={inputClass}
                    placeholder="name@company.com"
                    value={form.ownerEmail}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, ownerEmail: event.target.value }))
                    }
                  />
                </label>
              </div>
            ) : null}

            <div className="mt-4 space-y-4">
              {isWebinar ? (
                <div className={`grid gap-4 ${showMeetingLink ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                  <label className="block">
                    <span className="text-sm text-black/70">Event Date</span>
                    <input
                      type="date"
                      className={inputClass}
                      value={form.eventDate}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, eventDate: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-black/70">Platform</span>
                    <select
                      className={inputClass}
                      value={form.platform}
                      onChange={(event) =>
                        handlePlatformChange(normalizeEventPlatform(event.target.value))
                      }
                    >
                      {PLATFORM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {showMeetingLink ? (
                    <label className="block">
                      <span className="text-sm text-black/70">Meeting Link</span>
                      <input
                        type="url"
                        placeholder="https://..."
                        className={inputClass}
                        value={form.platformLink}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, platformLink: event.target.value }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : (
                <div className={`grid gap-4 ${showMeetingLink ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
                  <label className="block">
                    <span className="text-sm text-black/70">Platform</span>
                    <select
                      className={inputClass}
                      value={form.platform}
                      onChange={(event) =>
                        handlePlatformChange(normalizeEventPlatform(event.target.value))
                      }
                    >
                      {PLATFORM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {showMeetingLink ? (
                    <label className="block">
                      <span className="text-sm text-black/70">Meeting Link</span>
                      <input
                        type="url"
                        placeholder="https://..."
                        className={inputClass}
                        value={form.platformLink}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, platformLink: event.target.value }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
              )}

              <p className="text-xs text-black/45">
                Platform is where the meeting happens (Zoom, in person, etc.). It does not change
                whether this is 1-1, Webinar, or Webinar Waitlist.
              </p>

              {isWebinar ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-black/70">Start Time</span>
                    <input
                      type="time"
                      className={inputClass}
                      value={form.eventTimeStart}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, eventTimeStart: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-black/70">End Time</span>
                    <input
                      type="time"
                      className={inputClass}
                      value={form.eventTimeEnd}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, eventTimeEnd: event.target.value }))
                      }
                    />
                  </label>
                </div>
              ) : (
                <OneToOneAvailabilityEditor
                  weeklyHours={form.oneToOneWeeklyHours}
                  horizonDays={form.oneToOneBookingHorizonDays}
                  minNoticeDays={form.oneToOneMinNoticeDays}
                  meetingDurationMinutes={form.oneToOneMeetingDurationMinutes}
                  inputClass={inputClass}
                  onWeeklyHoursChange={(value) =>
                    setForm((prev) => ({ ...prev, oneToOneWeeklyHours: value }))
                  }
                  onHorizonDaysChange={(value) =>
                    setForm((prev) => ({ ...prev, oneToOneBookingHorizonDays: value }))
                  }
                  onMinNoticeDaysChange={(value) =>
                    setForm((prev) => ({ ...prev, oneToOneMinNoticeDays: value }))
                  }
                  onMeetingDurationMinutesChange={(value) =>
                    setForm((prev) => ({ ...prev, oneToOneMeetingDurationMinutes: value }))
                  }
                />
              )}
            </div>
          </section>

          <section>
            <h3 className="border-b border-black/10 pb-2 text-base font-semibold text-black">
              About event content
            </h3>
            <p className="mt-2 text-xs text-black/50">
              Put your full story here—agenda, schedule, FAQs, why attend, links, and anything else
              guests should know. You can paste HTML directly (headings, links, lists, images, tables).
              Host names and roles go in the section below only.
            </p>
            <EventHtmlEditor
              minRows={18}
              value={form.aboutEvent}
              onChange={(nextHtml) => setForm((prev) => ({ ...prev, aboutEvent: nextHtml }))}
              placeholder="Write the event description"
            />
          </section>

          <section className="border-t border-black/10 pt-8">
            <div className="flex items-center justify-between border-b border-black/10 pb-2">
              <h3 className="text-base font-semibold text-black">Your hosts</h3>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, hosts: [...prev.hosts, { name: "", designation: "" }] }))}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-medium hover:bg-black/5"
              >
                Add Host
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {form.hosts.map((host, index) => (
                <div key={`host-${index}`} className="grid gap-3 rounded-xl border border-black/10 p-4 md:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Host name"
                    className="h-10 rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm outline-none focus:border-black/30"
                    value={host.name}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        hosts: prev.hosts.map((item, i) =>
                          i === index ? { ...item, name: event.target.value } : item
                        ),
                      }))
                    }
                  />
                  <input
                    type="text"
                    placeholder="Designation"
                    className="h-10 rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm outline-none focus:border-black/30"
                    value={host.designation}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        hosts: prev.hosts.map((item, i) =>
                          i === index ? { ...item, designation: event.target.value } : item
                        ),
                      }))
                    }
                  />
                  {form.hosts.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          hosts: prev.hosts.filter((_, i) => i !== index),
                        }))
                      }
                      className="md:col-span-2 text-left text-xs text-red-600"
                    >
                      Remove host
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      <EventEmailFlowPanel
        open={isEmailFlowOpen}
        onClose={() => setIsEmailFlowOpen(false)}
        eventFormat={form.eventFormat}
        eventName={form.eventName}
        eventDate={form.eventDate}
        eventTimeStart={form.eventTimeStart}
        eventTimeEnd={form.eventTimeEnd}
        platform={form.platform}
        platformLink={form.platformLink}
        emailFlows={form.emailFlows}
        eventBanner={form.eventBanner}
        emailIncludeEventBanner={form.emailIncludeEventBanner}
        onChange={(emailFlows) => setForm((prev) => ({ ...prev, emailFlows }))}
      />
    </form>
  );
}
