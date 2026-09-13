import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  CompanyDoc,
  ContactDoc,
  CrmContactInput,
  ListDoc,
  ListMembershipDoc,
} from "@/lib/crm";
import { normalizeCompanyKey } from "@/lib/crm";

type ImportContext = {
  projectId: ObjectId;
  listId: ObjectId;
  userId: ObjectId | null;
};

export type ImportSummary = {
  imported: number;
  skipped: number;
  companiesCreated: number;
  contactsCreated: number;
  contactsUpdated: number;
};

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

async function upsertCompany(
  projectId: ObjectId,
  companyName: string,
  cache: Map<string, ObjectId>,
) {
  const trimmed = companyName.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeCompanyKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const db = await getDb();
  const existing = await db.collection<CompanyDoc>("companies").findOne({
    projectId,
    nameKey: key,
  });

  if (existing) {
    cache.set(key, existing._id);
    return existing._id;
  }

  const now = new Date();
  const result = await db.collection("companies").insertOne({
    projectId,
    name: trimmed,
    nameKey: key,
    contactCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  cache.set(key, result.insertedId);
  return result.insertedId;
}

async function refreshCompanyCounts(projectId: ObjectId, companyIds: ObjectId[]) {
  if (companyIds.length === 0) {
    return;
  }

  const db = await getDb();
  const counts = await db
    .collection<ContactDoc>("contacts")
    .aggregate<{ _id: ObjectId; count: number }>([
      {
        $match: {
          projectId,
          companyId: { $in: companyIds },
        },
      },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ])
    .toArray();

  const countMap = new Map(
    counts.map((entry) => [entry._id.toString(), entry.count]),
  );

  await Promise.all(
    companyIds.map((companyId) =>
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

export async function importContactsToList(
  context: ImportContext,
  rows: CrmContactInput[],
): Promise<ImportSummary> {
  const db = await getDb();
  const companyCache = new Map<string, ObjectId>();
  const affectedCompanyIds = new Set<string>();

  let imported = 0;
  let skipped = 0;
  let companiesCreated = 0;
  let contactsCreated = 0;
  let contactsUpdated = 0;

  const existingCompanyCount = await db
    .collection("companies")
    .countDocuments({ projectId: context.projectId });

  for (const row of rows) {
    const firstName = row.firstName.trim();
    const lastName = row.lastName.trim();
    const email = row.email.trim().toLowerCase();
    const companyName = row.companyName?.trim() ?? "";

    if (!email || !firstName || !lastName) {
      skipped += 1;
      continue;
    }

    const beforeCompanies = companyCache.size;
    const companyId = companyName
      ? await upsertCompany(context.projectId, companyName, companyCache)
      : null;

    if (companyCache.size > beforeCompanies) {
      companiesCreated += 1;
    }

    if (companyId) {
      affectedCompanyIds.add(companyId.toString());
    }

    const now = new Date();
    const existingContact = await db.collection<ContactDoc>("contacts").findOne({
      projectId: context.projectId,
      email,
    });

    let contactId: ObjectId;

    if (existingContact) {
      contactId = existingContact._id;
      contactsUpdated += 1;

      if (existingContact.blocklisted || existingContact.subscribed === false) {
        skipped += 1;
        continue;
      }

      if (existingContact.companyId) {
        affectedCompanyIds.add(existingContact.companyId.toString());
      }

      await db.collection("contacts").updateOne(
        { _id: contactId },
        {
          $set: {
            firstName,
            lastName,
            companyId,
            companyName,
            updatedAt: now,
          },
        },
      );
    } else {
      const result = await db.collection("contacts").insertOne({
        projectId: context.projectId,
        firstName,
        lastName,
        email,
        companyId,
        companyName,
        subscribed: true,
        blocklisted: false,
        createdBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });
      contactId = result.insertedId;
      contactsCreated += 1;
    }

    const membership = await db
      .collection<ListMembershipDoc>("list_memberships")
      .findOne({
        projectId: context.projectId,
        listId: context.listId,
        contactId,
      });

    if (!membership) {
      await db.collection("list_memberships").insertOne({
        projectId: context.projectId,
        listId: context.listId,
        contactId,
        addedAt: now,
        addedBy: context.userId,
        source: "import",
      });
      imported += 1;
    } else {
      skipped += 1;
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

  if (companiesCreated === 0 && companyCache.size > existingCompanyCount) {
    companiesCreated = companyCache.size - existingCompanyCount;
  }

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
