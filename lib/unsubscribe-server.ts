import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc, ListDoc, ListMembershipDoc } from "@/lib/crm";
import { createList } from "@/lib/crm-import";

export const UNSUBSCRIBE_LIST_NAME = "Unsubscribe";

export type SuppressionEntry = {
  id: string;
  email: string;
  fullName: string;
  addedAt: string;
};

export type UnsubscribeSend = {
  _id: ObjectId;
  projectId: ObjectId;
  blastId: ObjectId;
  campaignId: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  token: string;
};

export async function getOrCreateUnsubscribeList(
  projectId: ObjectId,
  userId: ObjectId | null = null,
) {
  const db = await getDb();
  const existing = await db.collection<ListDoc>("lists").findOne({
    projectId,
    name: UNSUBSCRIBE_LIST_NAME,
  });
  if (existing) {
    return existing;
  }
  return createList(projectId, UNSUBSCRIBE_LIST_NAME, userId);
}

export async function getSuppressedEmails(projectId: ObjectId) {
  const db = await getDb();
  const list = await db.collection<ListDoc>("lists").findOne({
    projectId,
    name: UNSUBSCRIBE_LIST_NAME,
  });
  if (!list) {
    return new Set<string>();
  }

  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, listId: list._id })
    .toArray();
  if (memberships.length === 0) {
    return new Set<string>();
  }

  const contacts = await db
    .collection<ContactDoc>("contacts")
    .find({
      _id: { $in: memberships.map((item) => item.contactId) },
      projectId,
    })
    .toArray();

  return new Set(
    contacts.map((contact) => contact.email.trim().toLowerCase()).filter(Boolean),
  );
}

export async function getUnsubscribeListEntries(projectId: ObjectId) {
  const list = await getOrCreateUnsubscribeList(projectId);
  const db = await getDb();
  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, listId: list._id })
    .sort({ addedAt: -1 })
    .toArray();

  const contacts = memberships.length
    ? await db
        .collection<ContactDoc>("contacts")
        .find({
          _id: { $in: memberships.map((item) => item.contactId) },
          projectId,
        })
        .toArray()
    : [];
  const contactMap = new Map(contacts.map((contact) => [contact._id.toString(), contact]));

  const entries: SuppressionEntry[] = memberships.flatMap((membership) => {
    const contact = contactMap.get(membership.contactId.toString());
    if (!contact) {
      return [];
    }
    return [
      {
        id: contact._id.toString(),
        email: contact.email,
        fullName: `${contact.firstName} ${contact.lastName}`.trim(),
        addedAt: membership.addedAt.toISOString(),
      },
    ];
  });

  return {
    list: {
      id: list._id.toString(),
      name: list.name,
      displayId: list.displayId,
      contactCount: entries.length,
      createdAt: list.createdAt.toISOString(),
    },
    entries,
  };
}

export async function unsubscribeSend(send: UnsubscribeSend) {
  const db = await getDb();
  const email = send.email.trim().toLowerCase();
  const list = await getOrCreateUnsubscribeList(send.projectId);
  const now = new Date();

  let contact = await db.collection<ContactDoc>("contacts").findOne({
    projectId: send.projectId,
    email,
  });

  if (!contact) {
    const result = await db.collection<ContactDoc>("contacts").insertOne({
      _id: new ObjectId(),
      projectId: send.projectId,
      firstName: send.firstName || "Unsubscribed",
      lastName: send.lastName || "",
      email,
      companyId: null,
      companyName: "",
      subscribed: false,
      blocklisted: true,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
    contact = await db.collection<ContactDoc>("contacts").findOne({ _id: result.insertedId });
  } else {
    await db.collection<ContactDoc>("contacts").updateOne(
      { _id: contact._id },
      {
        $set: {
          subscribed: false,
          blocklisted: true,
          updatedAt: now,
        },
      },
    );
  }

  if (!contact) {
    throw new Error("Could not save unsubscribe contact.");
  }

  const membership = await db.collection<ListMembershipDoc>("list_memberships").findOne({
    projectId: send.projectId,
    listId: list._id,
    contactId: contact._id,
  });

  if (!membership) {
    await db.collection<ListMembershipDoc>("list_memberships").insertOne({
      _id: new ObjectId(),
      projectId: send.projectId,
      listId: list._id,
      contactId: contact._id,
      addedAt: now,
      addedBy: null,
      source: "manual",
    });
    await db.collection<ListDoc>("lists").updateOne(
      { _id: list._id },
      { $inc: { contactCount: 1 }, $set: { updatedAt: now } },
    );
  }

  const sendDoc = await db.collection("campaign_sends").findOne({ _id: send._id });
  const alreadyTracked = Boolean(sendDoc?.unsubscribedAt);
  if (!alreadyTracked) {
    await db.collection("campaign_sends").updateOne(
      { _id: send._id },
      { $set: { unsubscribedAt: now } },
    );
    await db.collection("campaign_blasts").updateOne(
      { _id: send.blastId },
      { $inc: { unsubscribed: 1 }, $set: { updatedAt: now } },
    );
  }

  return { email, alreadyUnsubscribed: Boolean(membership) || alreadyTracked };
}
