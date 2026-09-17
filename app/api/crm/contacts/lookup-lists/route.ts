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

type LookupList = {
  id: string;
  name: string;
  displayId: number;
};

/**
 * POST body: { emails: string[] }
 * Returns list memberships for contacts that already exist in the project.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = await request.json().catch(() => null);
    const rawEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const normalized = rawEmails
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter((value) => value.length > 0);
    const emails = Array.from(new Set(normalized)).slice(0, 5000);

    if (emails.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const projectId = new ObjectId(session.projectId);
    const db = await getDb();

    const contacts = await db
      .collection<ContactDoc>("contacts")
      .find({ projectId, email: { $in: emails } })
      .project({ _id: 1, email: 1 })
      .toArray();

    if (contacts.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const contactIds = contacts.map((contact) => contact._id);
    const emailByContactId = new Map(
      contacts.map((contact) => [contact._id.toString(), contact.email.toLowerCase()]),
    );

    const memberships = await db
      .collection<ListMembershipDoc>("list_memberships")
      .find({ projectId, contactId: { $in: contactIds } })
      .toArray();

    const listIds = [...new Set(memberships.map((entry) => entry.listId.toString()))].map(
      (id) => new ObjectId(id),
    );

    const lists =
      listIds.length === 0
        ? []
        : await db
            .collection<ListDoc>("lists")
            .find({ _id: { $in: listIds }, projectId })
            .toArray();

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

    const matches = emails
      .map((email) => {
        const listsForEmail = listsByEmail.get(email) ?? [];
        if (listsForEmail.length === 0 && !contacts.some((c) => c.email.toLowerCase() === email)) {
          return null;
        }
        const exists = contacts.some((c) => c.email.toLowerCase() === email);
        if (!exists) {
          return null;
        }
        return {
          email,
          lists: listsForEmail,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Failed to look up contact lists:", error);
    return NextResponse.json(
      { error: "Failed to look up contacts" },
      { status: 500 },
    );
  }
}
