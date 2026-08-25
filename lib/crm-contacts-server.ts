import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  buildContactHistory,
  mapContact,
  type CompanyDoc,
  type ContactDetail,
  type ContactDoc,
  type ContactListMembership,
  type ListDoc,
  type ListMembershipDoc,
} from "@/lib/crm";

export async function getProjectContacts(projectId: ObjectId) {
  const db = await getDb();
  return db
    .collection<ContactDoc>("contacts")
    .find({ projectId })
    .sort({ lastName: 1, firstName: 1 })
    .toArray();
}

export async function getProjectContactDetail(
  projectId: ObjectId,
  contactId: ObjectId,
  owner: string,
): Promise<ContactDetail | null> {
  const db = await getDb();
  const contacts = await getProjectContacts(projectId);
  const index = contacts.findIndex((entry) => entry._id.equals(contactId));
  const doc = index >= 0 ? contacts[index] : null;

  if (!doc) {
    return null;
  }

  const contact = mapContact(doc);

  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, contactId })
    .sort({ addedAt: -1 })
    .toArray();

  const listIds = memberships.map((entry) => entry.listId);
  const lists =
    listIds.length === 0
      ? []
      : await db
          .collection<ListDoc>("lists")
          .find({ _id: { $in: listIds } })
          .toArray();

  const listMap = new Map(lists.map((list) => [list._id.toString(), list]));

  const contactLists: ContactListMembership[] = memberships.flatMap((membership) => {
    const list = listMap.get(membership.listId.toString());
    if (!list) {
      return [];
    }

    const entry: ContactListMembership = {
      id: list._id.toString(),
      name: list.name,
      displayId: list.displayId,
      addedAt: membership.addedAt.toISOString(),
      createdAt: list.createdAt.toISOString(),
      source: membership.source,
    };

    if (list.importFileName) {
      entry.importFileName = list.importFileName;
    }

    return [entry];
  });

  let company: ContactDetail["company"] = null;
  if (doc.companyId) {
    const companyDoc = await db.collection<CompanyDoc>("companies").findOne({
      _id: doc.companyId,
      projectId,
    });

    if (companyDoc) {
      company = {
        id: companyDoc._id.toString(),
        name: companyDoc.name,
        contactCount: companyDoc.contactCount,
      };
    }
  }

  const history = buildContactHistory({
    contact,
    lists: contactLists,
    company,
    owner,
  });

  return {
    ...contact,
    owner,
    company,
    lists: contactLists,
    history,
    campaignStats: {
      sent: 0,
      delivered: 0,
      opens: 0,
      clicks: 0,
    },
    navigation: {
      index,
      total: contacts.length,
      prevId: index > 0 ? contacts[index - 1]?._id.toString() ?? null : null,
      nextId:
        index >= 0 && index < contacts.length - 1
          ? contacts[index + 1]?._id.toString() ?? null
          : null,
    },
  };
}
