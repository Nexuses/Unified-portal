import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

let membershipIndexesPromise: Promise<void> | null = null;

/** List lookups filter by project, list, and contact. Without these indexes Atlas scans the collection. */
export function ensureListMembershipIndexes() {
  if (!membershipIndexesPromise) {
    membershipIndexesPromise = (async () => {
      const db = await getDb();
      const memberships = db.collection("list_memberships");
      await Promise.all([
        memberships.createIndex(
          { projectId: 1, listId: 1, contactId: 1 },
          { name: "list_memberships_project_list_contact", unique: true },
        ),
        memberships.createIndex(
          { projectId: 1, contactId: 1 },
          { name: "list_memberships_project_contact" },
        ),
      ]);
    })().catch((error) => {
      membershipIndexesPromise = null;
      console.error("Failed to ensure list membership indexes:", error);
    });
  }
  return membershipIndexesPromise;
}

async function companyIdByContact(contactIds: ObjectId[]) {
  const db = await getDb();
  const companyByContact = new Map<string, string>();
  for (let index = 0; index < contactIds.length; index += 4000) {
    const chunk = contactIds.slice(index, index + 4000);
    const contacts = await db
      .collection("contacts")
      .find(
        { _id: { $in: chunk }, companyId: { $type: "objectId" } },
        { projection: { companyId: 1 } },
      )
      .toArray();
    for (const contact of contacts) {
      if (contact.companyId) {
        companyByContact.set(String(contact._id), String(contact.companyId));
      }
    }
  }
  return companyByContact;
}

function countCompanies(
  memberships: Array<{ listId: ObjectId; contactId: ObjectId }>,
  companyByContact: Map<string, string>,
) {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const membership of memberships) {
    const companyId = companyByContact.get(String(membership.contactId));
    if (!companyId) {
      continue;
    }
    const listId = String(membership.listId);
    const key = `${listId}:${companyId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    counts.set(listId, (counts.get(listId) ?? 0) + 1);
  }
  return counts;
}

/** Distinct companies (accounts) per list for a project. */
export async function getDistinctCompanyCountsByList(
  projectId: ObjectId,
): Promise<Map<string, number>> {
  const db = await getDb();
  const memberships = await db
    .collection<{ listId: ObjectId; contactId: ObjectId }>("list_memberships")
    .find({ projectId }, { projection: { _id: 0, listId: 1, contactId: 1 } })
    .toArray();
  const contactIds = [
    ...new Map(
      memberships.map((membership) => [
        String(membership.contactId),
        membership.contactId,
      ]),
    ).values(),
  ];
  return countCompanies(memberships, await companyIdByContact(contactIds));
}

export async function countDistinctCompaniesForList(
  projectId: ObjectId,
  listId: ObjectId,
): Promise<number> {
  const db = await getDb();
  const memberships = await db
    .collection<{ listId: ObjectId; contactId: ObjectId }>("list_memberships")
    .find(
      { projectId, listId },
      { projection: { _id: 0, listId: 1, contactId: 1 } },
    )
    .toArray();
  const contactIds = [
    ...new Map(
      memberships.map((membership) => [
        String(membership.contactId),
        membership.contactId,
      ]),
    ).values(),
  ];
  return (
    countCompanies(memberships, await companyIdByContact(contactIds)).get(
      listId.toString(),
    ) ?? 0
  );
}
