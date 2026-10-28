import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  CompanyDoc,
  ContactDoc,
  CrmContactInput,
  ImportSummary,
  ListDoc,
  ListMembershipDoc,
} from "@/lib/crm";
import {
  defaultSplitListNames,
  normalizeCompanyKey,
  planListSplitCounts,
} from "@/lib/crm";
import { countDistinctCompaniesForList } from "@/lib/crm-list-stats";

type ImportContext = {
  projectId: ObjectId;
  listId: ObjectId;
  userId: ObjectId | null;
};

export type { ImportSummary };

const EMAIL_LOOKUP_CHUNK = 800;
const WRITE_CHUNK = 500;

async function getNextListDisplayId(projectId: ObjectId) {
  const db = await getDb();
  const latest = await db
    .collection<ListDoc>("lists")
    .find({ projectId })
    .sort({ displayId: -1 })
    .limit(1)
    .toArray();

  return (latest[0]?.displayId ?? 0) + 1;
}

export async function createList(
  projectId: ObjectId,
  name: string,
  userId: ObjectId | null,
  importFileName?: string,
) {
  const db = await getDb();
  const now = new Date();
  const displayId = await getNextListDisplayId(projectId);
  const trimmedFileName = importFileName?.trim();

  const doc: Omit<ListDoc, "_id"> = {
    projectId,
    name: name.trim(),
    displayId,
    contactCount: 0,
    companyCount: 0,
    ...(trimmedFileName ? { importFileName: trimmedFileName } : {}),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("lists").insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function renameList(
  projectId: ObjectId,
  listId: ObjectId,
  name: string,
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("List name is required");
  }
  if (trimmed.toLowerCase() === "unsubscribe") {
    throw new Error("That list name is reserved");
  }

  const db = await getDb();
  const existing = await db.collection<ListDoc>("lists").findOne({
    _id: listId,
    projectId,
  });
  if (!existing) {
    throw new Error("List not found");
  }
  if (existing.name === "Unsubscribe") {
    throw new Error("The Unsubscribe list cannot be renamed");
  }

  const duplicate = await db.collection<ListDoc>("lists").findOne({
    projectId,
    _id: { $ne: listId },
    name: trimmed,
  });
  if (duplicate) {
    throw new Error("A list with that name already exists");
  }

  const now = new Date();
  await db.collection<ListDoc>("lists").updateOne(
    { _id: listId, projectId },
    { $set: { name: trimmed, updatedAt: now } },
  );

  return {
    ...existing,
    name: trimmed,
    updatedAt: now,
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function ensureCompanies(
  projectId: ObjectId,
  companyNames: string[],
): Promise<{ byKey: Map<string, ObjectId>; created: number }> {
  const db = await getDb();
  const unique = new Map<string, string>();
  for (const name of companyNames) {
    const trimmed = name.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeCompanyKey(trimmed);
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }

  const byKey = new Map<string, ObjectId>();
  if (unique.size === 0) {
    return { byKey, created: 0 };
  }

  const keys = [...unique.keys()];
  for (const keyChunk of chunkArray(keys, EMAIL_LOOKUP_CHUNK)) {
    const existing = await db
      .collection<CompanyDoc>("companies")
      .find({ projectId, nameKey: { $in: keyChunk } })
      .project({ _id: 1, nameKey: 1 })
      .toArray();
    for (const company of existing) {
      byKey.set(company.nameKey, company._id);
    }
  }

  const missing = keys.filter((key) => !byKey.has(key));
  let created = 0;
  const now = new Date();
  for (const missingChunk of chunkArray(missing, WRITE_CHUNK)) {
    if (missingChunk.length === 0) {
      continue;
    }
    const docs: Array<Omit<CompanyDoc, "_id">> = missingChunk.map((key) => ({
      projectId,
      name: unique.get(key) ?? key,
      nameKey: key,
      contactCount: 0,
      createdAt: now,
      updatedAt: now,
    }));
    try {
      const result = await db.collection("companies").insertMany(docs, {
        ordered: false,
      });
      for (const [index, id] of Object.entries(result.insertedIds)) {
        byKey.set(missingChunk[Number(index)], id);
        created += 1;
      }
    } catch (error) {
      // Parallel uploads can race on unique nameKey — reload missing keys.
      const raced = await db
        .collection<CompanyDoc>("companies")
        .find({ projectId, nameKey: { $in: missingChunk } })
        .project({ _id: 1, nameKey: 1 })
        .toArray();
      for (const company of raced) {
        if (!byKey.has(company.nameKey)) {
          byKey.set(company.nameKey, company._id);
          created += 1;
        }
      }
      if (!(error && typeof error === "object" && "code" in error)) {
        throw error;
      }
    }
  }

  return { byKey, created };
}

async function refreshCompanyCounts(projectId: ObjectId, companyIds: ObjectId[]) {
  if (companyIds.length === 0) {
    return;
  }

  const db = await getDb();
  for (const idChunk of chunkArray(companyIds, EMAIL_LOOKUP_CHUNK)) {
    const counts = await db
      .collection<ContactDoc>("contacts")
      .aggregate<{ _id: ObjectId; count: number }>([
        {
          $match: {
            projectId,
            companyId: { $in: idChunk },
          },
        },
        { $group: { _id: "$companyId", count: { $sum: 1 } } },
      ])
      .toArray();

    const countMap = new Map(
      counts.map((entry) => [entry._id.toString(), entry.count]),
    );

    await Promise.all(
      idChunk.map((companyId) =>
        db.collection("companies").updateOne(
          { _id: companyId },
          {
            $set: {
              contactCount: countMap.get(companyId.toString()) ?? 0,
              updatedAt: new Date(),
            },
          },
        ),
      ),
    );
  }
}

type NormalizedRow = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  attributes: Record<string, string>;
};

function normalizeRows(rows: CrmContactInput[]) {
  const normalized: NormalizedRow[] = [];
  const seenEmails = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const firstName = row.firstName.trim();
    const lastName = row.lastName.trim();
    const email = row.email.trim().toLowerCase();
    const companyName = row.companyName?.trim() ?? "";
    const attributes = Object.fromEntries(
      Object.entries(row.attributes ?? {})
        .map(([key, value]) => [key.trim(), String(value ?? "").trim()])
        .filter(([key, value]) => key && value),
    );

    if (!email || !firstName || !companyName) {
      skipped += 1;
      continue;
    }
    if (seenEmails.has(email)) {
      skipped += 1;
      continue;
    }
    seenEmails.add(email);
    normalized.push({ firstName, lastName, email, companyName, attributes });
  }

  return { normalized, skipped };
}

/**
 * Bulk import for large CRM uploads (thousands of rows).
 * Uses batched lookups + bulkWrite instead of per-row round trips.
 */
export async function importContactsToList(
  context: ImportContext,
  rows: CrmContactInput[],
): Promise<ImportSummary> {
  const db = await getDb();
  const { normalized, skipped: skippedInvalid } = normalizeRows(rows);
  let skipped = skippedInvalid;
  let contactsCreated = 0;
  let contactsUpdated = 0;
  let imported = 0;

  if (normalized.length === 0) {
    return {
      imported: 0,
      skipped,
      companiesCreated: 0,
      contactsCreated: 0,
      contactsUpdated: 0,
    };
  }

  const { byKey: companyByKey, created: companiesCreated } = await ensureCompanies(
    context.projectId,
    normalized.map((row) => row.companyName),
  );

  const emails = normalized.map((row) => row.email);
  const existingByEmail = new Map<string, ContactDoc>();
  for (const emailChunk of chunkArray(emails, EMAIL_LOOKUP_CHUNK)) {
    const existing = await db
      .collection<ContactDoc>("contacts")
      .find({ projectId: context.projectId, email: { $in: emailChunk } })
      .toArray();
    for (const contact of existing) {
      existingByEmail.set(contact.email.toLowerCase(), contact);
    }
  }

  const now = new Date();
  const affectedCompanyIds = new Set<string>();
  const membershipContactIds: ObjectId[] = [];
  const inserts: ContactDoc[] = [];
  const updates: Array<{
    contactId: ObjectId;
    firstName: string;
    lastName: string;
    companyId: ObjectId | null;
    companyName: string;
    attributes: Record<string, string>;
  }> = [];

  for (const row of normalized) {
    const companyKey = normalizeCompanyKey(row.companyName);
    const companyId = companyByKey.get(companyKey) ?? null;
    if (companyId) {
      affectedCompanyIds.add(companyId.toString());
    }

    const existing = existingByEmail.get(row.email);
    if (existing) {
      if (existing.blocklisted || existing.subscribed === false) {
        skipped += 1;
        continue;
      }
      if (existing.companyId) {
        affectedCompanyIds.add(existing.companyId.toString());
      }
      contactsUpdated += 1;
      updates.push({
        contactId: existing._id,
        firstName: row.firstName,
        lastName: row.lastName,
        companyId,
        companyName: row.companyName,
        attributes: row.attributes,
      });
      membershipContactIds.push(existing._id);
      continue;
    }

    const contactId = new ObjectId();
    inserts.push({
      _id: contactId,
      projectId: context.projectId,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      companyId,
      companyName: row.companyName,
      attributes: row.attributes,
      subscribed: true,
      blocklisted: false,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });
    contactsCreated += 1;
    membershipContactIds.push(contactId);
  }

  for (const insertChunk of chunkArray(inserts, WRITE_CHUNK)) {
    if (insertChunk.length === 0) {
      continue;
    }
    await db.collection<ContactDoc>("contacts").insertMany(insertChunk, {
      ordered: false,
    });
  }

  for (const updateChunk of chunkArray(updates, WRITE_CHUNK)) {
    if (updateChunk.length === 0) {
      continue;
    }
    await db.collection<ContactDoc>("contacts").bulkWrite(
      updateChunk.map((item) => ({
        updateOne: {
          filter: { _id: item.contactId },
          update: {
            $set: {
              firstName: item.firstName,
              lastName: item.lastName,
              companyId: item.companyId,
              companyName: item.companyName,
              attributes: item.attributes,
              updatedAt: now,
            },
          },
        },
      })),
      { ordered: false },
    );
  }

  const alreadyMember = new Set<string>();
  for (const idChunk of chunkArray(membershipContactIds, EMAIL_LOOKUP_CHUNK)) {
    if (idChunk.length === 0) {
      continue;
    }
    const memberships = await db
      .collection<ListMembershipDoc>("list_memberships")
      .find({
        projectId: context.projectId,
        listId: context.listId,
        contactId: { $in: idChunk },
      })
      .project({ contactId: 1 })
      .toArray();
    for (const membership of memberships) {
      alreadyMember.add(membership.contactId.toString());
    }
  }

  const membershipDocs: ListMembershipDoc[] = [];
  for (const contactId of membershipContactIds) {
    if (alreadyMember.has(contactId.toString())) {
      skipped += 1;
      continue;
    }
    membershipDocs.push({
      _id: new ObjectId(),
      projectId: context.projectId,
      listId: context.listId,
      contactId,
      addedAt: now,
      addedBy: context.userId,
      source: "import",
    });
    imported += 1;
  }

  for (const membershipChunk of chunkArray(membershipDocs, WRITE_CHUNK)) {
    if (membershipChunk.length === 0) {
      continue;
    }
    try {
      await db.collection<ListMembershipDoc>("list_memberships").insertMany(
        membershipChunk,
        { ordered: false },
      );
    } catch (error) {
      // Duplicate membership races are safe to ignore.
      if (!(error && typeof error === "object" && "code" in error)) {
        throw error;
      }
    }
  }

  const [membershipCount, companyCount] = await Promise.all([
    db.collection("list_memberships").countDocuments({
      projectId: context.projectId,
      listId: context.listId,
    }),
    countDistinctCompaniesForList(context.projectId, context.listId),
  ]);

  await db.collection("lists").updateOne(
    { _id: context.listId },
    {
      $set: {
        contactCount: membershipCount,
        companyCount,
        updatedAt: new Date(),
      },
    },
  );

  await refreshCompanyCounts(
    context.projectId,
    [...affectedCompanyIds].map((id) => new ObjectId(id)),
  );

  return {
    imported,
    skipped,
    companiesCreated,
    contactsCreated,
    contactsUpdated,
  };
}

export { planListSplitCounts, defaultSplitListNames };

/**
 * Partition a list's contacts into N new lists (move memberships), then delete the source list.
 */
export async function splitList(
  projectId: ObjectId,
  listId: ObjectId,
  partNames: string[],
  userId: ObjectId | null,
) {
  const names = partNames.map((name) => name.trim()).filter(Boolean);
  if (names.length < 2) {
    throw new Error("Split into at least 2 parts");
  }
  if (names.length > 50) {
    throw new Error("Split into at most 50 parts");
  }
  const lowered = names.map((name) => name.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    throw new Error("Each part needs a unique list name");
  }
  if (lowered.some((name) => name === "unsubscribe")) {
    throw new Error("That list name is reserved");
  }

  const db = await getDb();
  const source = await db.collection<ListDoc>("lists").findOne({
    _id: listId,
    projectId,
  });
  if (!source) {
    throw new Error("List not found");
  }
  if (source.name === "Unsubscribe") {
    throw new Error("The Unsubscribe list cannot be split");
  }

  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, listId })
    .sort({ addedAt: 1, _id: 1 })
    .project({ _id: 1 })
    .toArray();

  if (memberships.length === 0) {
    throw new Error("This list has no contacts to split");
  }
  if (names.length > memberships.length) {
    throw new Error(
      `Cannot split ${memberships.length} contact${memberships.length === 1 ? "" : "s"} into ${names.length} parts`,
    );
  }

  const existingNames = await db
    .collection<ListDoc>("lists")
    .find({
      projectId,
      _id: { $ne: listId },
      name: { $in: names },
    })
    .project({ name: 1 })
    .toArray();
  if (existingNames.length > 0) {
    throw new Error(
      `A list named "${existingNames[0].name}" already exists`,
    );
  }

  const counts = planListSplitCounts(memberships.length, names.length);
  let nextDisplayId = await getNextListDisplayId(projectId);
  const now = new Date();
  const created: ListDoc[] = [];
  let offset = 0;

  for (let index = 0; index < names.length; index += 1) {
    const count = counts[index] ?? 0;
    const chunk = memberships.slice(offset, offset + count);
    offset += count;

    const doc: Omit<ListDoc, "_id"> = {
      projectId,
      name: names[index],
      displayId: nextDisplayId,
      contactCount: chunk.length,
      companyCount: 0,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    nextDisplayId += 1;
    const insert = await db.collection("lists").insertOne(doc);
    const listDoc: ListDoc = { ...doc, _id: insert.insertedId };
    created.push(listDoc);

    if (chunk.length === 0) {
      continue;
    }
    const membershipIds = chunk.map((row) => row._id);
    for (const idChunk of chunkArray(membershipIds, WRITE_CHUNK)) {
      await db.collection<ListMembershipDoc>("list_memberships").updateMany(
        { _id: { $in: idChunk }, projectId, listId },
        { $set: { listId: listDoc._id } },
      );
    }
  }

  await db.collection<ListMembershipDoc>("list_memberships").deleteMany({
    projectId,
    listId,
  });
  await db.collection<ListDoc>("lists").deleteOne({ _id: listId, projectId });

  return {
    sourceListId: listId.toString(),
    lists: created,
    counts,
  };
}

export async function deleteLists(
  projectId: ObjectId,
  ids: string[],
  options?: { deleteContacts?: boolean },
) {
  const listIds = [...new Set(ids)]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (listIds.length === 0) {
    return { deleted: 0, contactsDeleted: 0 };
  }

  const db = await getDb();
  const lists = await db
    .collection<ListDoc>("lists")
    .find({
      projectId,
      _id: { $in: listIds },
      name: { $ne: "Unsubscribe" },
    })
    .project({ _id: 1 })
    .toArray();
  const allowedIds = lists.map((list) => list._id);
  if (allowedIds.length === 0) {
    return { deleted: 0, contactsDeleted: 0 };
  }

  let contactsDeleted = 0;
  if (options?.deleteContacts) {
    const memberships = await db
      .collection<ListMembershipDoc>("list_memberships")
      .find({ projectId, listId: { $in: allowedIds } })
      .project({ contactId: 1 })
      .toArray();
    const contactIds = [
      ...new Set(
        memberships
          .map((row) => row.contactId?.toString?.() ?? String(row.contactId ?? ""))
          .filter((id) => ObjectId.isValid(id)),
      ),
    ];
    if (contactIds.length > 0) {
      const { deleteContacts } = await import("@/lib/crm-contacts-server");
      const removed = await deleteContacts(projectId, contactIds);
      contactsDeleted = removed.deleted;
    }
  }

  await db.collection<ListMembershipDoc>("list_memberships").deleteMany({
    projectId,
    listId: { $in: allowedIds },
  });
  const result = await db.collection<ListDoc>("lists").deleteMany({
    projectId,
    _id: { $in: allowedIds },
  });
  return {
    deleted: result.deletedCount ?? 0,
    contactsDeleted,
  };
}

export async function deleteProjectCrmData(projectId: ObjectId) {
  const db = await getDb();
  await Promise.all([
    db.collection("list_memberships").deleteMany({ projectId }),
    db.collection("lists").deleteMany({ projectId }),
    db.collection("contacts").deleteMany({ projectId }),
    db.collection("companies").deleteMany({ projectId }),
  ]);
}
