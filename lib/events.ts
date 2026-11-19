import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { cache } from "react";
import type { EventSmtpConfig } from "@/lib/event-smtp";
import { normalizeEventSmtpConfig } from "@/lib/event-smtp";
import { getDb } from "@/lib/mongodb";
import type { EventEmailFlows } from "@/lib/event-email-flows";
import {
  type EventFormat,
  isSharedSessionFormat,
  normalizeEventFormat,
} from "@/lib/event-format";
import type { EventPlatform } from "@/lib/event-platform";
import { normalizeEventPlatform, resolveMeetingLink } from "@/lib/event-platform";
import {
  extractRawEventCalendarsField,
  normalizeEventCalendarsArray,
} from "@/lib/normalize-event-calendars";

export type { EventFormat } from "@/lib/event-format";
export {
  EVENT_FORMAT_OPTIONS,
  eventFormatLabel,
  isSharedSessionFormat,
  isWaitlistedWebinarFormat,
  isWebinarFormat,
  normalizeEventFormat,
} from "@/lib/event-format";

export type EventPart = {
  title: string;
  content: string;
};

export type EventHost = {
  name: string;
  designation: string;
};

export type { EventPlatform } from "@/lib/event-platform";
export { normalizeEventPlatform, PLATFORM_OPTIONS } from "@/lib/event-platform";

export type EventCalendar = {
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink?: string;
};

export type EventDocument = {
  _id?: ObjectId;
  publicId: string;
  /** Portal project this campaign belongs to. */
  projectId: string;
  projectName: string;
  /** Portal SMTP sender used for invite and reminder mail. */
  senderId?: string;
  /** Portal SMTP sender used for calendar (.ics) invites. Falls back to senderId. */
  inviteSenderId?: string;
  eventName: string;
  /** SMTP from-name for invite/reminder notification emails for this event. */
  senderName?: string;
  /** SMTP from-email for invite/reminder notification emails. Falls back to SMTP_FROM_EMAIL when unset. */
  senderEmail?: string;
  /** Per-event SMTP transport for notification emails. Falls back to server env SMTP when unset. */
  smtpConfig?: EventSmtpConfig;
  /** Reply-To address on invite and reminder notification emails. */
  replyToEmail?: string;
  /** SMTP from-name for calendar invite (ICS) emails. Falls back to senderName when unset. */
  inviteSenderName?: string;
  /** SMTP from-email for calendar invite (ICS) emails. Falls back to senderEmail when unset. */
  inviteSenderEmail?: string;
  /** Per-event SMTP transport for calendar invite (ICS) emails. Falls back to smtpConfig when unset. */
  inviteSmtpConfig?: EventSmtpConfig;
  /** Reply-To address on calendar invite (ICS) emails. Falls back to replyToEmail when unset. */
  inviteReplyToEmail?: string;
  /** Agenda points for the calendar invite body (one point per line). */
  calendarInviteAgenda?: string;
  eventBanner: string;
  /** Optional banner image URL shown at the top of invite/reminder emails. Falls back to event banner. */
  emailBannerUrl?: string;
  /** When true (default), emails include the event banner image at the top. */
  emailIncludeEventBanner?: boolean;
  /** Logo URL for the top-left of the public event page header. */
  publicHeaderLogo?: string;
  eventDate: string;
  /** Last bookable date for 1-to-1 availability (inclusive). Start is {@link eventDate}. */
  oneToOneBookingEndDate?: string;
  /** Weekly recurring availability for 1-to-1 booking. */
  oneToOneWeeklyHours?: Array<{
    dayOfWeek: number;
    enabled: boolean;
    ranges: Array<{ start: string; end: string }>;
  }>;
  /** How many days ahead invitees can book (from today). */
  oneToOneBookingHorizonDays?: number;
  /** Minimum days notice before the first bookable slot. */
  oneToOneMinNoticeDays?: number;
  /** Meeting length when splitting weekly availability windows. */
  oneToOneMeetingDurationMinutes?: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: EventPlatform;
  platformLink?: string;
  ownerName?: string;
  ownerEmail?: string;
  eventCalendars?: EventCalendar[];
  registrationTitle: string;
  hostedBy: string;
  companyLogo: string;
  companyName: string;
  hostContact: string;
  aboutEvent: string;
  scheduleHeading?: string;
  /** Duration label for the schedule section (e.g. "What happens in 90 minutes"). Omitted on legacy docs. */
  scheduleDurationMinutes?: number;
  scheduleParts: EventPart[];
  hosts: EventHost[];
  eventMoreDetails: string;
  hashTagOne: string;
  hashTagTwo: string;
  hashTags: string[];
  registerNowText: string;
  registerSupportText: string;
  registerLink: string;
  whyTitle: string;
  whyContent: string;
  questionTitle: string;
  questions: string[];
  aboutWhy: string;
  endLine: string;
  /** `one_to_one` = multiple bookable slots; `webinar` = single shared slot for all attendees. */
  eventFormat?: EventFormat;
  /** Custom subject/message templates for automated emails. */
  emailFlows?: EventEmailFlows;
  /** CRM list id for "{eventName} - Registration" (public registrants). */
  registrationListId?: string;
  /** Opaque token for the public event report (`/er/{token}`). */
  shareToken?: string;
  status: "draft" | "published";
  createdAt: Date;
  updatedAt: Date;
};

export type EventPayload = Omit<
  EventDocument,
  "_id" | "createdAt" | "updatedAt" | "status" | "publicId"
> & {
  status?: "draft" | "published";
};

export { extractRawEventCalendarsField, normalizeEventCalendarsArray };

function eventsCollection() {
  return getDb().then((db) => db.collection<EventDocument>("events"));
}

function ensureEventId(event: EventDocument) {
  if (!event._id) {
    throw new Error("Event ID is missing.");
  }
  return event._id;
}

function randomPublicId(length: number) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(
    { length },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

async function generateUniquePublicId() {
  const collection = await eventsCollection();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = randomPublicId(7);
    const exists = await collection.findOne({ publicId: candidate });
    if (!exists) {
      return candidate;
    }
  }

  return randomPublicId(7);
}

async function withPublicId(event: EventDocument) {
  const eventId = ensureEventId(event);

  if (event.publicId) {
    return event;
  }

  const publicId = await generateUniquePublicId();
  const collection = await eventsCollection();
  await collection.updateOne(
    { _id: eventId },
    { $set: { publicId, updatedAt: new Date() } }
  );

  return { ...event, publicId };
}

function normalizeEventPlatformFields(payload: {
  platform?: unknown;
  platformLink?: unknown;
}) {
  const platform = normalizeEventPlatform(payload.platform);
  return {
    platform,
    platformLink: resolveMeetingLink(platform, payload.platformLink),
  };
}

export async function createEvent(payload: EventPayload) {
  const collection = await eventsCollection();
  const now = new Date();
  const publicId = await generateUniquePublicId();
  const eventFormat = normalizeEventFormat(payload.eventFormat);
  const platformFields = normalizeEventPlatformFields(payload);
  const smtpConfig = normalizeEventSmtpConfig(payload.smtpConfig);
  const inviteSmtpConfig = normalizeEventSmtpConfig(payload.inviteSmtpConfig);
  const {
    smtpConfig: _omitSmtp,
    inviteSmtpConfig: _omitInviteSmtp,
    ...payloadWithoutSmtp
  } = payload;
  const doc = {
    ...payloadWithoutSmtp,
    ...platformFields,
    ...(smtpConfig ? { smtpConfig } : {}),
    ...(inviteSmtpConfig ? { inviteSmtpConfig } : {}),
    eventFormat,
    eventCalendars: isSharedSessionFormat(eventFormat)
      ? []
      : normalizeEventCalendarsArray(payload.eventCalendars),
    publicId,
    status: payload.status ?? "draft",
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(doc);
  return result.insertedId.toString();
}

function eventIdFilter(id: string, projectId?: string) {
  const filter: Record<string, unknown> = { _id: new ObjectId(id) };
  if (projectId) {
    filter.projectId = projectId;
  }
  return filter;
}

export async function updateEvent(
  id: string,
  payload: Partial<EventPayload>,
  projectId?: string,
) {
  if (!ObjectId.isValid(id)) {
    return;
  }
  const collection = await eventsCollection();
  const patch: Record<string, unknown> = { ...payload, updatedAt: new Date() };
  if (
    Object.prototype.hasOwnProperty.call(payload, "platform") ||
    Object.prototype.hasOwnProperty.call(payload, "platformLink")
  ) {
    Object.assign(patch, normalizeEventPlatformFields(payload));
  }
  const hasFormat = Object.prototype.hasOwnProperty.call(payload, "eventFormat");
  const format = hasFormat ? normalizeEventFormat(payload.eventFormat) : null;

  if (hasFormat) {
    patch.eventFormat = format;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "eventCalendars")) {
    patch.eventCalendars = isSharedSessionFormat(format)
      ? []
      : normalizeEventCalendarsArray(payload.eventCalendars);
  } else if (isSharedSessionFormat(format)) {
    patch.eventCalendars = [];
  }
  if (isSharedSessionFormat(format)) {
    patch.ownerName = "";
    patch.ownerEmail = "";
    patch.eventCalendars = [];
  }
  const unset: Record<string, ""> = {};
  if (Object.prototype.hasOwnProperty.call(payload, "smtpConfig")) {
    const normalizedSmtp = normalizeEventSmtpConfig(payload.smtpConfig);
    if (normalizedSmtp) {
      patch.smtpConfig = normalizedSmtp;
    } else {
      delete patch.smtpConfig;
      unset.smtpConfig = "";
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "inviteSmtpConfig")) {
    const normalizedInviteSmtp = normalizeEventSmtpConfig(payload.inviteSmtpConfig);
    if (normalizedInviteSmtp) {
      patch.inviteSmtpConfig = normalizedInviteSmtp;
    } else {
      delete patch.inviteSmtpConfig;
      unset.inviteSmtpConfig = "";
    }
  }
  const updateDoc: { $set: Record<string, unknown>; $unset?: Record<string, ""> } = {
    $set: patch,
  };
  if (Object.keys(unset).length > 0) {
    updateDoc.$unset = unset;
  }
  await collection.updateOne(eventIdFilter(id, projectId), updateDoc);
}

export async function updateEventStatus(
  id: string,
  status: "draft" | "published",
  projectId?: string,
) {
  if (!ObjectId.isValid(id)) {
    return;
  }
  const collection = await eventsCollection();
  await collection.updateOne(eventIdFilter(id, projectId), {
    $set: { status, updatedAt: new Date() },
  });
}

export async function deleteEventById(id: string, projectId?: string) {
  if (!ObjectId.isValid(id)) {
    return false;
  }
  const collection = await eventsCollection();
  const result = await collection.deleteOne(eventIdFilter(id, projectId));
  return result.deletedCount > 0;
}

function withNormalizedEventFields<T extends Record<string, unknown>>(event: T) {
  const eventFormat = normalizeEventFormat(event.eventFormat);
  const platformFields = normalizeEventPlatformFields(event);
  return {
    ...event,
    eventFormat,
    ...platformFields,
  };
}

export async function getEventById(id: string, projectId?: string) {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  const collection = await eventsCollection();
  const event = await collection.findOne(eventIdFilter(id, projectId));
  if (!event) {
    return null;
  }

  const eventWithPublicId = await withPublicId(event);
  const eventId = ensureEventId(eventWithPublicId);

  const rawCals =
    extractRawEventCalendarsField(eventWithPublicId) ?? eventWithPublicId.eventCalendars;
  return withNormalizedEventFields({
    ...eventWithPublicId,
    id: eventId.toString(),
    eventCalendars: normalizeEventCalendarsArray(rawCals),
  });
}

export async function getEventByPublicId(publicId: string) {
  const collection = await eventsCollection();
  const event = await collection.findOne({ publicId });
  if (!event) {
    return null;
  }
  const eventId = ensureEventId(event);

  const rawCals = extractRawEventCalendarsField(event) ?? event.eventCalendars;
  return withNormalizedEventFields({
    ...event,
    id: eventId.toString(),
    eventCalendars: normalizeEventCalendarsArray(rawCals),
  });
}

async function fetchAllEventsUncached(projectId?: string) {
  const collection = await eventsCollection();
  const events = await collection
    .find(projectId ? { projectId } : {})
    .sort({ createdAt: -1 })
    .toArray();
  const eventsWithPublicId = await Promise.all(events.map(withPublicId));
  return eventsWithPublicId.map((event) => {
    const rawCals = extractRawEventCalendarsField(event) ?? event.eventCalendars;
    return withNormalizedEventFields({
      ...event,
      id: ensureEventId(event).toString(),
      eventCalendars: normalizeEventCalendarsArray(rawCals),
    });
  });
}

/** Events for one portal project. Deduped within a request. */
export const getAllEvents = cache(fetchAllEventsUncached);

export async function getEventByShareToken(shareToken: string) {
  const token = String(shareToken ?? "").trim();
  if (!token) {
    return null;
  }
  const collection = await eventsCollection();
  const event = await collection.findOne({ shareToken: token });
  if (!event) {
    return null;
  }
  const eventId = ensureEventId(event);
  const rawCals = extractRawEventCalendarsField(event) ?? event.eventCalendars;
  return withNormalizedEventFields({
    ...event,
    id: eventId.toString(),
    eventCalendars: normalizeEventCalendarsArray(rawCals),
  });
}

export async function ensureEventShareToken(
  eventId: string,
  projectId?: string,
) {
  if (!ObjectId.isValid(eventId)) {
    return null;
  }
  const collection = await eventsCollection();
  const existing = await collection.findOne(eventIdFilter(eventId, projectId));
  if (!existing) {
    return null;
  }
  if (existing.shareToken) {
    return existing.shareToken;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareToken = randomBytes(18).toString("base64url");
    const taken = await collection.findOne(
      { shareToken },
      { projection: { _id: 1 } },
    );
    if (taken) {
      continue;
    }

    const result = await collection.updateOne(
      { _id: existing._id, shareToken: { $exists: false } },
      { $set: { shareToken, updatedAt: new Date() } },
    );
    if (result.modifiedCount > 0 || result.matchedCount === 0) {
      const fresh = await collection.findOne({ _id: existing._id });
      return fresh?.shareToken ?? shareToken;
    }
  }

  throw new Error("Could not create a share link");
}
