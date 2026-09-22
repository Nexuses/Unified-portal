import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  type ContactDoc,
  type ListDoc,
  type ListMembershipDoc,
} from "@/lib/crm";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 300;

type LookupList = {
  id: string;
  name: string;
  displayId: number;
};

const LOOKUP_CHUNK = 800;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * POST body: { emails: string[] }
 * Returns list memberships for contacts that already exist in the project.
 * No hard cap on email count — lookups are batched server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = await request.json().catch(() => null);
    const rawEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const emails = Array.from(
      new Set(
        rawEmails
          .map((value) => String(value ?? "").trim().toLowerCase())
          .filter((value) => value.length > 0),
      ),
    );

    if (emails.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const projectId = new ObjectId(session.projectId);
    const db = await getDb();

    const contacts: Array<Pick<ContactDoc, "_id" | "email">> = [];
    for (const emailChunk of chunkArray(emails, LOOKUP_CHUNK)) {
      const batch = await db
        .collection<ContactDoc>("contacts")
        .find({ projectId, email: { $in: emailChunk } })
        .project({ _id: 1, email: 1 })
        .toArray();
      for (const contact of batch) {
        contacts.push({ _id: contact._id, email: contact.email });
      }
    }

    if (contacts.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const contactIds = contacts.map((contact) => contact._id);
    const emailByContactId = new Map(
      contacts.map((contact) => [
        contact._id.toString(),
        contact.email.toLowerCase(),
      ]),
    );

    const memberships: ListMembershipDoc[] = [];
    for (const idChunk of chunkArray(contactIds, LOOKUP_CHUNK)) {
      const batch = await db
        .collection<ListMembershipDoc>("list_memberships")
        .find({ projectId, contactId: { $in: idChunk } })
        .toArray();
      memberships.push(...batch);
    }

    const listIds = [
      ...new Set(memberships.map((entry) => entry.listId.toString())),
    ].map((id) => new ObjectId(id));

    const lists =
      listIds.length === 0
        ? []
        : (
            await Promise.all(
              chunkArray(listIds, LOOKUP_CHUNK).map((idChunk) =>
                db
                  .collection<ListDoc>("lists")
                  .find({ _id: { $in: idChunk }, projectId })
                  .toArray(),
              ),
            )
          ).flat();

    const listMap = new Map(
      lists.map((list) => [
        list._id.toString(),
        {
          id: list._id.toString(),
          name: list.name,
          displayId: list.displayId,
        } satisfies LookupList,
      ]),
    );

    const listsByEmail = new Map<string, LookupList[]>();
    for (const membership of memberships) {
      const email = emailByContactId.get(membership.contactId.toString());
      const list = listMap.get(membership.listId.toString());
      if (!email || !list) {
        continue;
      }
      const current = listsByEmail.get(email) ?? [];
      if (!current.some((entry) => entry.id === list.id)) {
        current.push(list);
      }
      listsByEmail.set(email, current);
    }

    const contactEmailSet = new Set(
      contacts.map((contact) => contact.email.toLowerCase()),
    );

    const matches = emails
      .filter((email) => contactEmailSet.has(email))
      .map((email) => ({
        email,
        lists: listsByEmail.get(email) ?? [],
      }));

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Failed to look up contact lists:", error);
    return NextResponse.json(
      { error: "Failed to look up contacts" },
      { status: 500 },
    );
  }
}
