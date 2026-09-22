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
import { normalizeCompanyKey } from "@/lib/crm";

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
    ...(trimmedFileName ? { importFileName: trimmedFileName } : {}),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("lists").insertOne(doc);
  return { ...doc, _id: result.insertedId };
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

  const membershipCount = await db
    .collection("list_memberships")
    .countDocuments({
      projectId: context.projectId,
      listId: context.listId,
    });

  await db.collection("lists").updateOne(
    { _id: context.listId },
    {
      $set: {
        contactCount: membershipCount,
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

export async function deleteLists(projectId: ObjectId, ids: string[]) {
  const listIds = [...new Set(ids)]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (listIds.length === 0) {
    return { deleted: 0 };
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
    return { deleted: 0 };
  }

  await db.collection<ListMembershipDoc>("list_memberships").deleteMany({
    projectId,
    listId: { $in: allowedIds },
  });
  const result = await db.collection<ListDoc>("lists").deleteMany({
    projectId,
    _id: { $in: allowedIds },
  });
  return { deleted: result.deletedCount ?? 0 };
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
