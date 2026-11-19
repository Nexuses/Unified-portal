import { ObjectId } from "mongodb";
import { createList, importContactsToList } from "@/lib/crm-import";
import { getDb } from "@/lib/mongodb";
import type { ListDoc } from "@/lib/crm";
import { splitPersonName } from "@/lib/email-variables";
import { updateEvent } from "@/lib/events";

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
