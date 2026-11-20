import { ObjectId } from "mongodb";
import { after } from "next/server";
import type { ContactDoc, ListDoc, ListMembershipDoc } from "@/lib/crm";
import { getDb } from "@/lib/mongodb";
import { isSharedSessionFormat, isWaitlistedWebinarFormat, isWebinarFormat, normalizeEventFormat } from "@/lib/event-format";
import { resolveMeetingLink } from "@/lib/event-platform";
import { getEventById, getEventByPublicId } from "@/lib/events";
import {
  addRegistrationContactToEventList,
  ensureEventRegistrationList,
} from "@/lib/event-registration-list";
import { sendAcceptedCalendarInviteEmail } from "@/lib/invite-email";
import {
  extractRawEventCalendarsField,
} from "@/lib/normalize-event-calendars";
import { resolveRollingOneToOneSlots } from "@/lib/auto-one-to-one-slots";
import {
  DEFAULT_ONE_TO_ONE_BUFFER_MINUTES,
  resolveBlockedSlotIndexes,
  type BookedInterval,
} from "@/lib/one-to-one-booking-slots";
import { toWallDateYmd } from "@/lib/public-event-time";
import { normalizeViewerTimeZone } from "@/lib/viewer-time-zone";
import {
  normalizeRegistrationPhone,
  validateWaitlistRegistrationFields,
} from "@/lib/waitlist-registration";
import type { WaitlistStatus } from "@/lib/webinar-submission-stage";

type SubmissionDocument = {
  _id?: ObjectId;
  eventId: ObjectId;
  name: string;
  email: string;
  emailNormalized?: string;
  companyName: string;
  phone?: string;
  calendarSlotIndex?: number;
  calendarEventDate?: string;
  calendarEventTimeStart?: string;
  calendarEventTimeEnd?: string;
  calendarPlatform?: string;
  calendarPlatformLink?: string;
  createdAt: Date;
  inviteSentAt?: Date;
  inviteAcceptedAt?: Date;
  calendarInviteUid?: string;
  source?: "csv" | "registration" | "list";
  sourceListId?: string;
  sourceListName?: string;
  trapToken?: string;
  botClick?: boolean;
  botClickedAt?: Date;
  waitlistStatus?: WaitlistStatus;
  waitlistConfirmedAt?: Date;
  waitlistRejectedAt?: Date;
  viewerTimeZone?: string;
  remindersEnabled?: boolean;
  reminderDayEnabled?: boolean;
  reminderHourEnabled?: boolean;
  reminderDaySentAt?: Date;
  reminderHourSentAt?: Date;
};

export type EventSubmission = {
  id: string;
  name: string;
  email: string;
  companyName: string;
  phone: string;
  calendarSlotIndex: number;
  calendarEventDate: string;
  calendarEventTimeStart: string;
  calendarEventTimeEnd: string;
  calendarPlatform: string;
  calendarPlatformLink: string;
  createdAt: string;
  inviteSentAt: string | null;
  inviteAcceptedAt: string | null;
  source: "csv" | "registration" | "list" | null;
  sourceListId: string | null;
  sourceListName: string | null;
  botClick: boolean;
  botClickedAt: string | null;
  waitlistStatus: WaitlistStatus | null;
  waitlistConfirmedAt: string | null;
  waitlistRejectedAt: string | null;
  remindersEnabled: boolean;
  reminderDayEnabled: boolean;
  reminderHourEnabled: boolean;
};

function submissionsCollection() {
  return getDb().then((db) => db.collection<SubmissionDocument>("event_submissions"));
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function bookingsFromSubmissionDocs(
  items: Array<{
    calendarSlotIndex?: number;
    calendarEventDate?: string;
    calendarEventTimeStart?: string;
    calendarEventTimeEnd?: string;
  }>,
  slots: Array<{ eventDate: string; eventTimeStart: string; eventTimeEnd: string }>
): BookedInterval[] {
  const bookings: BookedInterval[] = [];
  for (const item of items) {
    const date = String(item.calendarEventDate ?? "").trim();
    const start = String(item.calendarEventTimeStart ?? "").trim();
    const end = String(item.calendarEventTimeEnd ?? "").trim();

    if (date && start && end) {
      bookings.push({
        eventDate: toWallDateYmd(date),
        eventTimeStart: start,
        eventTimeEnd: end,
      });
      continue;
    }

    const legacyIndex =
      typeof item.calendarSlotIndex === "number" && Number.isFinite(item.calendarSlotIndex)
        ? item.calendarSlotIndex
        : 0;
    const slot = slots[legacyIndex];
    if (slot) {
      bookings.push({
        eventDate: slot.eventDate,
        eventTimeStart: slot.eventTimeStart,
        eventTimeEnd: slot.eventTimeEnd,
      });
    }
  }
  return bookings;
}

function resolveEventSlots(event: {
  eventFormat?: "one_to_one" | "webinar" | "webinar_waitlisted";
  eventDate: string;
  oneToOneBookingEndDate?: string;
  oneToOneWeeklyHours?: unknown;
  oneToOneBookingHorizonDays?: number;
  oneToOneMinNoticeDays?: number;
  oneToOneMeetingDurationMinutes?: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: string;
  platformLink?: string;
  eventCalendars?: Array<{
    eventDate?: string;
    eventTimeStart?: string;
    eventTimeEnd?: string;
    platform?: string;
    platformLink?: string;
  }>;
}) {
  const rawSlots = resolveRollingOneToOneSlots({
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
    eventCalendars: extractRawEventCalendarsField(event) ?? event.eventCalendars,
  });
  const slots = rawSlots.filter(
    (slot) =>
      String(slot.eventDate ?? "").trim() ||
      String(slot.eventTimeStart ?? "").trim() ||
      String(slot.eventTimeEnd ?? "").trim() ||
      String(slot.platform ?? "").trim()
  );
  return { rawSlots, slots };
}

export async function createSubmissionFromPublicId(input: {
  publicId: string;
  name: string;
  email: string;
  companyName?: string;
  phone?: string;
  calendarSlotIndex?: number;
  viewerTimeZone?: string | null;
}) {
  const event = await getEventByPublicId(input.publicId);
  if (!event) {
    throw new Error("Event not found.");
  }

  const { rawSlots } = resolveEventSlots(event);
  const requestedIndex =
    typeof input.calendarSlotIndex === "number" && Number.isFinite(input.calendarSlotIndex)
      ? Math.max(0, Math.floor(input.calendarSlotIndex))
      : 0;
  const selectedIndex = Math.min(requestedIndex, Math.max(0, rawSlots.length - 1));
  const selectedSlot = rawSlots[selectedIndex] ?? rawSlots[0];

  const collection = await submissionsCollection();
  const normalizedEmail = normalizeEmail(input.email);
  const viewerTimeZone = normalizeViewerTimeZone(input.viewerTimeZone);
  const isOpenWebinar = isWebinarFormat(normalizeEventFormat(event.eventFormat));
  const isWaitlisted = isWaitlistedWebinarFormat(normalizeEventFormat(event.eventFormat));
  const companyName = String(input.companyName ?? "").trim();
  const phone = normalizeRegistrationPhone(input.phone);

  if (isWaitlisted) {
    const validationError = validateWaitlistRegistrationFields({
      companyName,
      phone,
    });
    if (validationError) {
      throw new Error(validationError);
    }
  }

  const emailMatch = {
    $or: [
      { emailNormalized: normalizedEmail },
      {
        email: {
          $regex: `^${escapeRegExp(String(input.email ?? "").trim())}$`,
          $options: "i",
        },
      },
    ],
  };

  const registrationEventId = String(event.id ?? event._id?.toString() ?? "");
  const registrationProjectId = String(event.projectId ?? "");
  const registrationEventName = String(event.eventName ?? "");
  let registrationListId = event.registrationListId;

  async function syncRegistrationList(companyForList: string) {
    try {
      registrationListId =
        (await ensureEventRegistrationList({
          eventId: registrationEventId,
          projectId: registrationProjectId,
          eventName: registrationEventName,
          registrationListId,
        })) ?? registrationListId;
      await addRegistrationContactToEventList({
        projectId: registrationProjectId,
        registrationListId,
        name: input.name,
        email: input.email,
        companyName: companyForList,
        phone,
      });
    } catch {
      // Registration should still succeed if CRM sync fails.
    }
  }

  if (isOpenWebinar || isWaitlisted) {
    const existing = await collection.findOne({
      eventId: event._id,
      ...emailMatch,
    });
    if (existing) {
      if (isWaitlisted) {
        const status = String(existing.waitlistStatus ?? "pending").toLowerCase();
        if (status === "rejected") {
          throw new Error("This email was not selected for this event.");
        }
        await collection.updateOne(
          { _id: existing._id },
          {
            $set: {
              name: input.name,
              email: input.email,
              emailNormalized: normalizedEmail,
              companyName,
              phone,
              source: "registration",
              waitlistStatus: status === "confirmed" ? "confirmed" : "pending",
              ...(viewerTimeZone ? { viewerTimeZone } : {}),
            },
          }
        );
        await syncRegistrationList(companyName);
        return;
      }
      const nextCompany =
        String(input.companyName ?? "").trim() ||
        String(existing.companyName ?? "").trim();
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            name: input.name,
            email: input.email,
            emailNormalized: normalizedEmail,
            companyName: nextCompany,
            source: "registration",
            inviteAcceptedAt: new Date(),
            ...(viewerTimeZone ? { viewerTimeZone } : {}),
          },
        }
      );
      await syncRegistrationList(nextCompany);
      return;
    }
  } else {
    const existingSubmissions = await collection
      .find({ eventId: event._id })
      .project({
        email: 1,
        emailNormalized: 1,
        calendarSlotIndex: 1,
        calendarEventDate: 1,
        calendarEventTimeStart: 1,
        calendarEventTimeEnd: 1,
      })
      .toArray();

    const duplicate = existingSubmissions.find((item) => {
      const normalized = normalizeEmail(item.emailNormalized || item.email || "");
      if (normalized !== normalizedEmail) {
        return false;
      }
      const slotIndex =
        typeof item.calendarSlotIndex === "number" && Number.isFinite(item.calendarSlotIndex)
          ? item.calendarSlotIndex
          : 0;
      return slotIndex === selectedIndex;
    });
    if (duplicate) {
      throw new Error("This email is already submitted for this event.");
    }

    const existingBookings = bookingsFromSubmissionDocs(existingSubmissions, rawSlots);
    const blockedIndexes = resolveBlockedSlotIndexes(
      rawSlots,
      existingBookings,
      DEFAULT_ONE_TO_ONE_BUFFER_MINUTES
    );
    if (blockedIndexes.includes(selectedIndex)) {
      throw new Error("This time slot is no longer available.");
    }
  }

  await collection.insertOne({
    eventId: event._id,
    name: input.name,
    email: input.email,
    emailNormalized: normalizedEmail,
    companyName,
    ...(phone ? { phone } : {}),
    calendarSlotIndex: selectedIndex,
    calendarEventDate: String(selectedSlot?.eventDate ?? event.eventDate ?? ""),
    calendarEventTimeStart: String(selectedSlot?.eventTimeStart ?? event.eventTimeStart ?? ""),
    calendarEventTimeEnd: String(selectedSlot?.eventTimeEnd ?? event.eventTimeEnd ?? ""),
    calendarPlatform: String(selectedSlot?.platform ?? event.platform ?? ""),
    calendarPlatformLink: resolveMeetingLink(
      selectedSlot?.platform ?? event.platform,
      selectedSlot?.platformLink ?? event.platformLink
    ),
    createdAt: new Date(),
    source: "registration",
    ...(viewerTimeZone ? { viewerTimeZone } : {}),
    ...(isWaitlisted
      ? {
          waitlistStatus: "pending" as const,
        }
      : isOpenWebinar
        ? {
            inviteAcceptedAt: new Date(),
          }
        : {}),
  });
  await syncRegistrationList(companyName);
}

export type BulkSubmissionImportResult = {
  insertedCount: number;
  skippedDuplicateCount: number;
  invalidCount: number;
};

export async function createBulkSubmissionsForEvent(input: {
  eventId: string;
  slotIndex?: number;
  rows: Array<{ name: string; email: string; companyName?: string }>;
  source?: "csv" | "list";
  sourceListId?: string;
  sourceListName?: string;
}): Promise<BulkSubmissionImportResult> {
  if (!ObjectId.isValid(input.eventId)) {
    throw new Error("Invalid event.");
  }
  const event = await getEventById(input.eventId);
  if (!event) {
    throw new Error("Event not found.");
  }
  const { rawSlots } = resolveEventSlots(event);
  const requestedIndex =
    typeof input.slotIndex === "number" && Number.isFinite(input.slotIndex)
      ? Math.max(0, Math.floor(input.slotIndex))
      : 0;
  const selectedIndex = Math.min(requestedIndex, Math.max(0, rawSlots.length - 1));
  const selectedSlot = rawSlots[selectedIndex] ?? rawSlots[0];
  const collection = await submissionsCollection();
  const existing = await collection
    .find({ eventId: new ObjectId(input.eventId) })
    .project({ email: 1, emailNormalized: 1, calendarSlotIndex: 1 })
    .toArray();
  const isSharedSession = isSharedSessionFormat(event.eventFormat);
  const existingEmails = new Set(
    existing
      .filter((item) => {
        if (isSharedSession) {
          return true;
        }
        const slot =
          typeof item.calendarSlotIndex === "number" && Number.isFinite(item.calendarSlotIndex)
            ? item.calendarSlotIndex
            : 0;
        return slot === selectedIndex;
      })
      .map((item) => normalizeEmail(item.emailNormalized || item.email || ""))
      .filter(Boolean)
  );
  const fileSeen = new Set<string>();
  let skippedDuplicateCount = 0;
  let invalidCount = 0;

  const now = new Date();
  const docs = input.rows
    .map((row) => ({
      name: String(row.name ?? "").trim(),
      email: String(row.email ?? "").trim(),
      companyName: String(row.companyName ?? "").trim(),
    }))
    .filter((row) => {
      if (!row.name || !row.email) {
        invalidCount += 1;
        return false;
      }
      return true;
    })
    .filter((row) => {
      const normalized = normalizeEmail(row.email);
      if (!normalized) {
        invalidCount += 1;
        return false;
      }
      if (existingEmails.has(normalized) || fileSeen.has(normalized)) {
        skippedDuplicateCount += 1;
        return false;
      }
      fileSeen.add(normalized);
      return true;
    })
    .map((row) => ({
      eventId: new ObjectId(input.eventId),
      name: row.name,
      email: row.email,
      emailNormalized: normalizeEmail(row.email),
      companyName: row.companyName,
      calendarSlotIndex: selectedIndex,
      calendarEventDate: String(selectedSlot?.eventDate ?? event.eventDate ?? ""),
      calendarEventTimeStart: String(selectedSlot?.eventTimeStart ?? event.eventTimeStart ?? ""),
      calendarEventTimeEnd: String(selectedSlot?.eventTimeEnd ?? event.eventTimeEnd ?? ""),
      calendarPlatform: String(selectedSlot?.platform ?? event.platform ?? ""),
      calendarPlatformLink: resolveMeetingLink(
        selectedSlot?.platform ?? event.platform,
        selectedSlot?.platformLink ?? event.platformLink
      ),
      createdAt: now,
      source: input.source === "list" ? ("list" as const) : ("csv" as const),
      ...(input.sourceListId
        ? { sourceListId: input.sourceListId, sourceListName: input.sourceListName ?? "" }
        : {}),
    }));

  if (docs.length === 0) {
    return { insertedCount: 0, skippedDuplicateCount, invalidCount };
  }
  const result = await collection.insertMany(docs);
  return {
    insertedCount: result.insertedCount,
    skippedDuplicateCount,
    invalidCount,
  };
}

export async function getSubmissionsByEventId(eventId: string) {
  if (!ObjectId.isValid(eventId)) {
    return [];
  }

  const collection = await submissionsCollection();
  const submissions = await collection
    .find({ eventId: new ObjectId(eventId) })
    .sort({ createdAt: -1 })
    .toArray();
  const unique = new Map<string, (typeof submissions)[number]>();
  for (const item of submissions) {
    const emailKey = normalizeEmail(item.emailNormalized || item.email || "");
    const slotKey =
      typeof item.calendarSlotIndex === "number" && Number.isFinite(item.calendarSlotIndex)
        ? item.calendarSlotIndex
        : 0;
    const key = `${slotKey}::${emailKey}`;
    if (!key || unique.has(key)) {
      continue;
    }
    unique.set(key, item);
  }

  return Array.from(unique.values()).map((item): EventSubmission => ({
    id: item._id?.toString() ?? "",
    name: item.name,
    email: item.email,
    companyName: item.companyName,
    phone: item.phone ?? "",
    calendarSlotIndex:
      typeof item.calendarSlotIndex === "number" && Number.isFinite(item.calendarSlotIndex)
        ? item.calendarSlotIndex
        : 0,
    calendarEventDate: item.calendarEventDate ?? "",
    calendarEventTimeStart: item.calendarEventTimeStart ?? "",
    calendarEventTimeEnd: item.calendarEventTimeEnd ?? "",
    calendarPlatform: item.calendarPlatform ?? "",
    calendarPlatformLink: item.calendarPlatformLink ?? "",
    createdAt: item.createdAt.toISOString(),
    inviteSentAt: item.inviteSentAt ? item.inviteSentAt.toISOString() : null,
    inviteAcceptedAt: item.inviteAcceptedAt ? item.inviteAcceptedAt.toISOString() : null,
    source:
      item.source === "csv" || item.source === "registration" || item.source === "list"
        ? item.source
        : null,
    sourceListId: item.sourceListId ?? null,
    sourceListName: item.sourceListName ?? null,
    botClick: Boolean(item.botClick),
    botClickedAt: item.botClickedAt ? item.botClickedAt.toISOString() : null,
    waitlistStatus:
      item.waitlistStatus === "pending" ||
      item.waitlistStatus === "confirmed" ||
      item.waitlistStatus === "rejected"
        ? item.waitlistStatus
        : null,
    waitlistConfirmedAt: item.waitlistConfirmedAt
      ? item.waitlistConfirmedAt.toISOString()
      : null,
    waitlistRejectedAt: item.waitlistRejectedAt
      ? item.waitlistRejectedAt.toISOString()
      : null,
    remindersEnabled: Boolean(item.remindersEnabled),
    reminderDayEnabled:
      item.reminderDayEnabled === undefined ? true : Boolean(item.reminderDayEnabled),
    reminderHourEnabled:
      item.reminderHourEnabled === undefined ? true : Boolean(item.reminderHourEnabled),
  }));
}

export async function getBookedSlotIndexesByEventId(eventId: string) {
  if (!ObjectId.isValid(eventId)) {
    return [];
  }
  const event = await getEventById(eventId);
  if (!event || isSharedSessionFormat(event.eventFormat)) {
    return [];
  }

  const { slots } = resolveEventSlots(event);
  const collection = await submissionsCollection();
  const items = await collection
    .find({ eventId: new ObjectId(eventId) })
    .project({
      calendarSlotIndex: 1,
      calendarEventDate: 1,
      calendarEventTimeStart: 1,
      calendarEventTimeEnd: 1,
    })
    .toArray();

  const bookings = bookingsFromSubmissionDocs(items, slots);
  return resolveBlockedSlotIndexes(slots, bookings, DEFAULT_ONE_TO_ONE_BUFFER_MINUTES);
}

export async function getSubmissionByIdForEvent(eventId: string, submissionId: string) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return null;
  }

  const collection = await submissionsCollection();
  return collection.findOne({
    _id: new ObjectId(submissionId),
    eventId: new ObjectId(eventId),
  });
}

export async function markSubmissionInviteSent(
  eventId: string,
  submissionId: string,
  calendarInviteUid?: string
) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return null;
  }

  const collection = await submissionsCollection();
  const sentAt = new Date();
  const result = await collection.findOneAndUpdate(
    {
      _id: new ObjectId(submissionId),
      eventId: new ObjectId(eventId),
    },
    {
      $set: {
        inviteSentAt: sentAt,
        ...(calendarInviteUid ? { calendarInviteUid } : {}),
      },
    },
    { returnDocument: "after" }
  );

  return result;
}

export async function findSubmissionIdByEventEmail(eventId: string, email: string) {
  if (!ObjectId.isValid(eventId)) return "";
  const collection = await submissionsCollection();
  const doc = await collection.findOne(
    { eventId: new ObjectId(eventId), emailNormalized: normalizeEmail(email) },
    { sort: { createdAt: -1 }, projection: { _id: 1 } },
  );
  return doc?._id?.toString() ?? "";
}

export async function importProjectListIntoEvent(input: {
  projectId: string;
  eventId: string;
  listId: string;
  slotIndex?: number;
}) {
  if (!ObjectId.isValid(input.projectId) || !ObjectId.isValid(input.listId)) {
    throw new Error("Choose a list.");
  }
  const db = await getDb();
  const projectId = new ObjectId(input.projectId);
  const list = await db.collection<ListDoc>("lists").findOne({
    _id: new ObjectId(input.listId),
    projectId,
  });
  if (!list) {
    throw new Error("List not found.");
  }
  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, listId: list._id })
    .toArray();
  const contactIds = memberships.map((membership) => membership.contactId);
  const contacts = contactIds.length
    ? await db
        .collection<ContactDoc>("contacts")
        .find({ projectId, _id: { $in: contactIds } })
        .toArray()
    : [];
  const rows = contacts
    .map((contact) => ({
      name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email,
      email: contact.email,
      companyName: contact.companyName ?? "",
    }))
    .filter((row) => row.email.trim());
  if (rows.length === 0) {
    throw new Error("This list has no contacts with an email.");
  }
  return createBulkSubmissionsForEvent({
    eventId: input.eventId,
    slotIndex: input.slotIndex,
    rows,
    source: "list",
    sourceListId: list._id.toString(),
    sourceListName: list.name,
  });
}

export async function acceptWebinarInviteFromCalendarRsvp(
  calendarInviteUid: string,
  attendeeEmail?: string
) {
  const uid = calendarInviteUid.trim();
  if (!uid) {
    return false;
  }

  const collection = await submissionsCollection();
  let submission = await collection.findOne({ calendarInviteUid: uid });

  if (!submission && attendeeEmail?.trim()) {
    const normalizedEmail = normalizeEmail(attendeeEmail);
    submission = await collection.findOne({
      inviteSentAt: { $exists: true },
      $or: [
        { emailNormalized: normalizedEmail },
        {
          email: {
            $regex: `^${escapeRegExp(attendeeEmail.trim())}$`,
            $options: "i",
          },
        },
      ],
    });
  }

  if (!submission || submission.inviteAcceptedAt) {
    return false;
  }

  const event = await getEventById(submission.eventId.toString());
  const acceptedAt = new Date();
  await collection.updateOne(
    { _id: submission._id },
    {
      $set: {
        inviteAcceptedAt: acceptedAt,
        ...(event && isWaitlistedWebinarFormat(event.eventFormat)
          ? {
              waitlistStatus: "confirmed",
              waitlistConfirmedAt: acceptedAt,
            }
          : {}),
      },
      ...(event && isWaitlistedWebinarFormat(event.eventFormat)
        ? { $unset: { waitlistRejectedAt: "" } }
        : {}),
    }
  );
  return true;
}

export async function acceptWebinarInviteByPublicId(publicId: string, email: string) {
  const event = await getEventByPublicId(publicId);
  if (!event) {
    throw new Error("Event not found.");
  }
  if (!isSharedSessionFormat(event.eventFormat)) {
    throw new Error("This event does not use webinar invites.");
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const collection = await submissionsCollection();
  const eventObjectId =
    event._id instanceof ObjectId
      ? event._id
      : ObjectId.isValid(event.id)
        ? new ObjectId(event.id)
        : null;
  if (!eventObjectId) {
    throw new Error("Event not found.");
  }

  const submission = await collection.findOne({
    eventId: eventObjectId,
    $or: [
      { emailNormalized: normalizedEmail },
      {
        email: {
          $regex: `^${escapeRegExp(String(email ?? "").trim())}$`,
          $options: "i",
        },
      },
    ],
  });

  if (!submission) {
    throw new Error("Invite not found.");
  }
  if (submission.inviteAcceptedAt) {
    return;
  }

  const acceptedAt = new Date();
  await collection.updateOne(
    { _id: submission._id },
    {
      $set: {
        inviteAcceptedAt: acceptedAt,
        ...(submission.inviteSentAt ? {} : { inviteSentAt: acceptedAt }),
        ...(isWaitlistedWebinarFormat(event.eventFormat)
          ? {
              waitlistStatus: "confirmed",
              waitlistConfirmedAt: acceptedAt,
            }
          : {}),
      },
      ...(isWaitlistedWebinarFormat(event.eventFormat)
        ? { $unset: { waitlistRejectedAt: "" } }
        : {}),
    }
  );

  try {
    scheduleAcceptedCalendarInvite(event, submission);
  } catch (error) {
    console.error("Accept invite: could not schedule calendar email", error);
  }
}

function scheduleAcceptedCalendarInvite(
  event: NonNullable<Awaited<ReturnType<typeof getEventByPublicId>>>,
  submission: {
    name: string;
    email: string;
    calendarEventDate?: string;
    calendarEventTimeStart?: string;
    calendarEventTimeEnd?: string;
    calendarPlatform?: string;
    calendarPlatformLink?: string;
    calendarInviteUid?: string;
    viewerTimeZone?: string | null;
  }
) {
  const send = async () => {
    try {
      await sendAcceptedCalendarInviteEmail(
        event,
        { name: submission.name, email: submission.email },
        {
          eventDate: submission.calendarEventDate ?? event.eventDate,
          eventTimeStart: submission.calendarEventTimeStart ?? event.eventTimeStart,
          eventTimeEnd: submission.calendarEventTimeEnd ?? event.eventTimeEnd,
          platform: submission.calendarPlatform ?? event.platform,
          platformLink: submission.calendarPlatformLink ?? event.platformLink ?? "",
        },
        {
          calendarInviteUid: submission.calendarInviteUid,
          viewerTimeZone: submission.viewerTimeZone ?? null,
        }
      );
    } catch (error) {
      console.error("Failed to send calendar invite after accept:", error);
    }
  };

  try {
    after(send);
  } catch (error) {
    console.error("Could not schedule calendar invite after accept:", error);
    void send();
  }
}

export async function acceptWebinarInviteBySubmissionId(publicId: string, submissionId: string) {
  const event = await getEventByPublicId(publicId);
  if (!event) {
    throw new Error("Event not found.");
  }
  if (!isSharedSessionFormat(event.eventFormat)) {
    throw new Error("This event does not use webinar invites.");
  }
  if (!ObjectId.isValid(submissionId)) {
    throw new Error("Invalid submission.");
  }

  const collection = await submissionsCollection();
  const eventObjectId =
    event._id instanceof ObjectId
      ? event._id
      : ObjectId.isValid(event.id)
        ? new ObjectId(event.id)
        : null;
  if (!eventObjectId) {
    throw new Error("Event not found.");
  }

  const submission = await collection.findOne({
    _id: new ObjectId(submissionId),
    eventId: eventObjectId,
  });

  if (!submission) {
    throw new Error("Invite not found.");
  }
  if (submission.inviteAcceptedAt) {
    return;
  }

  const acceptedAt = new Date();
  // A valid accept link means the guest received the invite — record sent if missing
  // (covers email-before-mark races and older rows).
  await collection.updateOne(
    { _id: submission._id },
    {
      $set: {
        inviteAcceptedAt: acceptedAt,
        ...(submission.inviteSentAt ? {} : { inviteSentAt: acceptedAt }),
        ...(isWaitlistedWebinarFormat(event.eventFormat)
          ? {
              waitlistStatus: "confirmed",
              waitlistConfirmedAt: acceptedAt,
            }
          : {}),
      },
      ...(isWaitlistedWebinarFormat(event.eventFormat)
        ? { $unset: { waitlistRejectedAt: "" } }
        : {}),
    }
  );

  try {
    scheduleAcceptedCalendarInvite(event, submission);
  } catch (error) {
    console.error("Accept invite: could not schedule calendar email", error);
  }
}

export async function markSubmissionAsGoing(eventId: string, submissionId: string) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return null;
  }

  const collection = await submissionsCollection();
  const acceptedAt = new Date();
  const result = await collection.findOneAndUpdate(
    {
      _id: new ObjectId(submissionId),
      eventId: new ObjectId(eventId),
    },
    { $set: { inviteAcceptedAt: acceptedAt } },
    { returnDocument: "after" }
  );

  return result;
}

export async function confirmWaitlistSubmission(eventId: string, submissionId: string) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return null;
  }
  const event = await getEventById(eventId);
  if (!event || !isWaitlistedWebinarFormat(event.eventFormat)) {
    throw new Error("This event does not use waitlist confirmation.");
  }

  const collection = await submissionsCollection();
  const confirmedAt = new Date();
  const result = await collection.findOneAndUpdate(
    {
      _id: new ObjectId(submissionId),
      eventId: new ObjectId(eventId),
    },
    {
      $set: {
        waitlistStatus: "confirmed",
        waitlistConfirmedAt: confirmedAt,
      },
      $unset: { waitlistRejectedAt: "" },
    },
    { returnDocument: "after" }
  );

  return result;
}

export async function rejectWaitlistSubmission(eventId: string, submissionId: string) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return null;
  }
  const event = await getEventById(eventId);
  if (!event || !isWaitlistedWebinarFormat(event.eventFormat)) {
    throw new Error("This event does not use waitlist rejection.");
  }

  const collection = await submissionsCollection();
  const rejectedAt = new Date();
  const result = await collection.findOneAndUpdate(
    {
      _id: new ObjectId(submissionId),
      eventId: new ObjectId(eventId),
    },
    {
      $set: {
        waitlistStatus: "rejected",
        waitlistRejectedAt: rejectedAt,
      },
      $unset: { inviteAcceptedAt: "", waitlistConfirmedAt: "" },
    },
    { returnDocument: "after" }
  );

  return result;
}

export async function deleteSubmissionByIdForEvent(eventId: string, submissionId: string) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return false;
  }

  const collection = await submissionsCollection();
  const result = await collection.deleteOne({
    _id: new ObjectId(submissionId),
    eventId: new ObjectId(eventId),
  });

  return result.deletedCount > 0;
}

export async function deleteSubmissionsByIdsForEvent(eventId: string, submissionIds: string[]) {
  if (!ObjectId.isValid(eventId)) {
    return 0;
  }

  const ids = [...new Set(submissionIds.map((id) => String(id ?? "").trim()))]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (ids.length === 0) {
    return 0;
  }

  const collection = await submissionsCollection();
  const result = await collection.deleteMany({
    eventId: new ObjectId(eventId),
    _id: { $in: ids },
  });

  return result.deletedCount;
}

export async function deleteSubmissionsByEventId(eventId: string) {
  if (!ObjectId.isValid(eventId)) {
    return 0;
  }

  const collection = await submissionsCollection();
  const result = await collection.deleteMany({ eventId: new ObjectId(eventId) });
  return result.deletedCount;
}

export async function setReminderPreferencesForEvent(
  eventId: string,
  options: { dayEnabled: boolean; hourEnabled: boolean; confirmedWaitlistOnly?: boolean }
) {
  if (!ObjectId.isValid(eventId)) {
    return 0;
  }

  const collection = await submissionsCollection();
  const remindersEnabled = options.dayEnabled || options.hourEnabled;
  const filter: Record<string, unknown> = { eventId: new ObjectId(eventId) };
  if (options.confirmedWaitlistOnly) {
    filter.$or = [
      { waitlistStatus: "confirmed" },
      { inviteAcceptedAt: { $exists: true, $ne: null } },
    ];
  }
  const result = await collection.updateMany(filter, {
    $set: {
      remindersEnabled,
      reminderDayEnabled: options.dayEnabled,
      reminderHourEnabled: options.hourEnabled,
    },
    $unset: { reminderDaySentAt: "", reminderHourSentAt: "" },
  });
  return result.modifiedCount;
}

export async function setReminderPreferencesForEventSlot(
  eventId: string,
  slotIndex: number,
  options: { dayEnabled: boolean; hourEnabled: boolean }
) {
  if (!ObjectId.isValid(eventId)) {
    return 0;
  }

  const normalizedSlot =
    Number.isFinite(slotIndex) && slotIndex > 0 ? Math.floor(slotIndex) : 0;
  const collection = await submissionsCollection();
  const remindersEnabled = options.dayEnabled || options.hourEnabled;
  const slotFilter =
    normalizedSlot === 0
      ? {
          $or: [
            { calendarSlotIndex: 0 },
            { calendarSlotIndex: { $exists: false } },
          ],
        }
      : { calendarSlotIndex: normalizedSlot };
  const result = await collection.updateMany(
    { eventId: new ObjectId(eventId), ...slotFilter },
    {
      $set: {
        remindersEnabled,
        reminderDayEnabled: options.dayEnabled,
        reminderHourEnabled: options.hourEnabled,
      },
      $unset: { reminderDaySentAt: "", reminderHourSentAt: "" },
    }
  );
  return result.modifiedCount;
}

export async function markReminderSent(submissionId: string, kind: "day" | "hour") {
  if (!ObjectId.isValid(submissionId)) {
    return;
  }
  const collection = await submissionsCollection();
  const key = kind === "day" ? "reminderDaySentAt" : "reminderHourSentAt";
  await collection.updateOne(
    { _id: new ObjectId(submissionId) },
    {
      $set: {
        [key]: new Date(),
      },
    }
  );
}

export async function getReminderCandidates(limit = 200) {
  const collection = await submissionsCollection();
  return collection
    .find({
      remindersEnabled: true,
      $and: [
        {
          $or: [
            { waitlistStatus: { $exists: false } },
            { waitlistStatus: { $eq: null } },
            { waitlistStatus: "confirmed" },
          ],
        },
        {
          $or: [
            { reminderDayEnabled: true, reminderDaySentAt: { $exists: false } },
            { reminderHourEnabled: true, reminderHourSentAt: { $exists: false } },
          ],
        },
      ],
    } as Record<string, unknown>)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
