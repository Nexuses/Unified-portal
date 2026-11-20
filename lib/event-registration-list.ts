import { ObjectId } from "mongodb";
import { createList, importContactsToList } from "@/lib/crm-import";
import { removeContactsFromList } from "@/lib/crm-contacts-server";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc, ListDoc } from "@/lib/crm";
import { splitPersonName } from "@/lib/email-variables";
import {
  isWaitlistedWebinarFormat,
  isWebinarFormat,
  normalizeEventFormat,
} from "@/lib/event-format";
import { getEventById, updateEvent } from "@/lib/events";
import {
  getWaitlistedSubmissionStage,
  getWebinarSubmissionStage,
} from "@/lib/webinar-submission-stage";

export function eventRegistrationListName(eventName: string) {
  const trimmed = String(eventName ?? "").trim() || "Event";
  return `${trimmed} - Registration`;
}

function toObjectId(value: string | null | undefined) {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }
  return new ObjectId(value);
}

function normalizeListEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function submissionCountsAsGoing(
  eventFormat: unknown,
  submission: {
    source?: string | null;
    inviteSentAt?: Date | string | null;
    inviteAcceptedAt?: Date | string | null;
    waitlistStatus?: string | null;
  },
) {
  const inviteSentAt = submission.inviteSentAt
    ? String(
        submission.inviteSentAt instanceof Date
          ? submission.inviteSentAt.toISOString()
          : submission.inviteSentAt,
      )
    : null;
  const inviteAcceptedAt = submission.inviteAcceptedAt
    ? String(
        submission.inviteAcceptedAt instanceof Date
          ? submission.inviteAcceptedAt.toISOString()
          : submission.inviteAcceptedAt,
      )
    : null;
  if (isWaitlistedWebinarFormat(eventFormat)) {
    return (
      getWaitlistedSubmissionStage({
        source: submission.source,
        inviteSentAt,
        inviteAcceptedAt,
        waitlistStatus: submission.waitlistStatus,
      }) === "going"
    );
  }
  if (isWebinarFormat(eventFormat)) {
    return (
      getWebinarSubmissionStage({
        source: submission.source,
        inviteSentAt,
        inviteAcceptedAt,
      }) === "going"
    );
  }
  return Boolean(inviteAcceptedAt);
}

/**
 * Ensures the event has a CRM list named "{eventName} - Registration".
 * Creates the list and stores registrationListId on the event when missing.
 */
export async function ensureEventRegistrationList(input: {
  eventId: string;
  projectId: string;
  eventName: string;
  registrationListId?: string | null;
  userId?: string | null;
}): Promise<string | null> {
  const projectId = toObjectId(input.projectId);
  if (!projectId || !ObjectId.isValid(input.eventId)) {
    return null;
  }

  const db = await getDb();
  const existingId = toObjectId(input.registrationListId ?? undefined);
  if (existingId) {
    const existing = await db.collection<ListDoc>("lists").findOne({
      _id: existingId,
      projectId,
    });
    if (existing) {
      return existing._id.toString();
    }
  }

  const listName = eventRegistrationListName(input.eventName);
  const byName = await db.collection<ListDoc>("lists").findOne({
    projectId,
    name: listName,
  });

  const userId = toObjectId(input.userId ?? undefined);
  const list =
    byName ??
    (await createList(projectId, listName, userId));

  const listId = list._id.toString();
  await updateEvent(
    input.eventId,
    { registrationListId: listId },
    input.projectId,
  );
  return listId;
}

/** Upsert a public registrant into the event's Registration CRM list. */
export async function addRegistrationContactToEventList(input: {
  projectId: string;
  registrationListId?: string | null;
  name: string;
  email: string;
  companyName?: string;
  phone?: string;
}): Promise<void> {
  const projectId = toObjectId(input.projectId);
  const listId = toObjectId(input.registrationListId ?? undefined);
  if (!projectId || !listId) {
    return;
  }

  const { firstName, lastName } = splitPersonName(input.name);
  if (!firstName || !String(input.email ?? "").trim()) {
    return;
  }

  const companyName =
    String(input.companyName ?? "").trim() || "Unknown";
  const phone = String(input.phone ?? "").trim();

  await importContactsToList(
    {
      projectId,
      listId,
      userId: null,
    },
    [
      {
        firstName,
        lastName,
        email: String(input.email).trim(),
        companyName,
        attributes: phone ? { phoneNumber: phone } : {},
      },
    ],
  );
}

/**
 * Keep "{event} - Registration" aligned with Going people only,
 * excluding invite honeypot (bot click) contacts.
 */
export async function syncEventRegistrationListWithGoing(input: {
  eventId: string;
  projectId?: string | null;
  userId?: string | null;
}): Promise<string | null> {
  if (!ObjectId.isValid(input.eventId)) {
    return null;
  }

  const event = await getEventById(input.eventId);
  if (!event) {
    return null;
  }

  const projectId =
    String(input.projectId ?? event.projectId ?? "").trim() || "";
  const listId = await ensureEventRegistrationList({
    eventId: input.eventId,
    projectId,
    eventName: event.eventName,
    registrationListId: event.registrationListId,
    userId: input.userId,
  });
  if (!listId) {
    return null;
  }

  const projectObjectId = toObjectId(projectId);
  const listObjectId = toObjectId(listId);
  const eventObjectId = new ObjectId(input.eventId);
  if (!projectObjectId || !listObjectId) {
    return listId;
  }

  const db = await getDb();
  const submissions = await db
    .collection<{
      name?: string;
      email?: string;
      emailNormalized?: string;
      companyName?: string;
      phone?: string;
      source?: string;
      inviteSentAt?: Date;
      inviteAcceptedAt?: Date;
      waitlistStatus?: string;
      botClick?: boolean;
    }>("event_submissions")
    .find({ eventId: eventObjectId })
    .project({
      name: 1,
      email: 1,
      emailNormalized: 1,
      companyName: 1,
      phone: 1,
      source: 1,
      inviteSentAt: 1,
      inviteAcceptedAt: 1,
      waitlistStatus: 1,
      botClick: 1,
    })
    .toArray();

  const eventFormat = normalizeEventFormat(event.eventFormat);
  const keepRows: Array<{
    firstName: string;
    lastName: string;
    email: string;
    companyName: string;
    attributes: Record<string, string>;
  }> = [];
  const keepEmails = new Set<string>();

  for (const submission of submissions) {
    if (submission.botClick) {
      continue;
    }
    if (!submissionCountsAsGoing(eventFormat, submission)) {
      continue;
    }
    const email = normalizeListEmail(
      submission.emailNormalized || submission.email || "",
    );
    if (!email || !email.includes("@")) {
      continue;
    }
    const { firstName, lastName } = splitPersonName(String(submission.name ?? ""));
    if (!firstName) {
      continue;
    }
    keepEmails.add(email);
    const phone = String(submission.phone ?? "").trim();
    keepRows.push({
      firstName,
      lastName,
      email,
      companyName: String(submission.companyName ?? "").trim() || "Unknown",
      attributes: phone ? { phoneNumber: phone } : {},
    });
  }

  if (keepRows.length > 0) {
    await importContactsToList(
      {
        projectId: projectObjectId,
        listId: listObjectId,
        userId: toObjectId(input.userId ?? undefined),
      },
      keepRows,
    );
  }

  const memberships = await db
    .collection("list_memberships")
    .find({ projectId: projectObjectId, listId: listObjectId })
    .project({ contactId: 1 })
    .toArray();
  const memberIds = memberships
    .map((row) => row.contactId)
    .filter((id): id is ObjectId => id instanceof ObjectId);
  if (memberIds.length === 0) {
    return listId;
  }

  const contacts = await db
    .collection<ContactDoc>("contacts")
    .find({ _id: { $in: memberIds }, projectId: projectObjectId })
    .project({ email: 1 })
    .toArray();
  const removeIds = contacts
    .filter((contact) => !keepEmails.has(normalizeListEmail(contact.email)))
    .map((contact) => contact._id.toString());
  if (removeIds.length > 0) {
    await removeContactsFromList(projectObjectId, listObjectId, removeIds);
  }

  return listId;
}
