import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc, ListDoc, ListMembershipDoc } from "@/lib/crm";
import { createList } from "@/lib/crm-import";
import {
  extractBulkSuppressionValues,
  normalizeSuppressionDomain,
  normalizeSuppressionEmail,
  type SuppressionKind,
} from "@/lib/unsubscribe-client";

export const UNSUBSCRIBE_LIST_NAME = "Unsubscribe";
export type { SuppressionKind };
export {
  extractBulkSuppressionValues,
  normalizeSuppressionDomain,
  normalizeSuppressionEmail,
} from "@/lib/unsubscribe-client";

export type SuppressionEntry = {
  id: string;
  email: string;
  fullName: string;
  addedAt: string;
};

export type SuppressionDomainEntry = {
  id: string;
  domain: string;
  addedAt: string;
};

export type SuppressionSets = {
  emails: Set<string>;
  domains: Set<string>;
};

export type SuppressionEntryDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  kind: SuppressionKind;
  value: string;
  source: "unsubscribe" | "upload" | "manual";
  createdBy: ObjectId | null;
  createdAt: Date;
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

export function isSuppressedAddress(email: string, suppression: SuppressionSets) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (suppression.emails.has(normalized)) {
    return true;
  }
  const at = normalized.lastIndexOf("@");
  if (at < 0) {
    return false;
  }
  const domain = normalized.slice(at + 1);
  return Boolean(domain && suppression.domains.has(domain));
}

export async function getSuppressionSets(projectId: ObjectId): Promise<SuppressionSets> {
  const db = await getDb();
  const [list, entries] = await Promise.all([
    db.collection<ListDoc>("lists").findOne({
      projectId,
      name: UNSUBSCRIBE_LIST_NAME,
    }),
    db
      .collection<SuppressionEntryDoc>("suppression_entries")
      .find({ projectId })
      .toArray(),
  ]);

  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "domain") {
      domains.add(entry.value);
    } else if (entry.value) {
      emails.add(entry.value);
    }
  }

  if (list) {
    const memberships = await db
      .collection<ListMembershipDoc>("list_memberships")
      .find({ projectId, listId: list._id })
      .toArray();
    if (memberships.length > 0) {
      const contacts = await db
        .collection<ContactDoc>("contacts")
        .find({
          _id: { $in: memberships.map((item) => item.contactId) },
          projectId,
        })
        .project({ email: 1 })
        .toArray();
      for (const contact of contacts) {
        const email = contact.email?.trim().toLowerCase();
        if (email) {
          emails.add(email);
        }
      }
    }
  }

  return { emails, domains };
}

export async function getSuppressedEmails(projectId: ObjectId) {
  const suppression = await getSuppressionSets(projectId);
  return suppression.emails;
}

async function upsertSuppressionEntry(
  projectId: ObjectId,
  kind: SuppressionKind,
  value: string,
  source: SuppressionEntryDoc["source"],
  userId: ObjectId | null,
) {
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<SuppressionEntryDoc>("suppression_entries").updateOne(
    { projectId, kind, value },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        projectId,
        kind,
        value,
        source,
        createdBy: userId,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return Boolean(result.upsertedCount);
}

export async function getUnsubscribeListEntries(
  projectId: ObjectId,
  options?: { page?: number; pageSize?: number },
) {
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 50));
  const page = Math.max(1, options?.page ?? 1);
  const list = await getOrCreateUnsubscribeList(projectId);
  const db = await getDb();

  const [emailTotal, memberships] = await Promise.all([
    db.collection<ListMembershipDoc>("list_memberships").countDocuments({
      projectId,
      listId: list._id,
    }),
    db
      .collection<ListMembershipDoc>("list_memberships")
      .find({ projectId, listId: list._id })
      .sort({ addedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

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

  const domains = await listSuppressionDomains(projectId);

  return {
    list: {
      id: list._id.toString(),
      name: list.name,
      displayId: list.displayId,
      contactCount: emailTotal,
      createdAt: list.createdAt.toISOString(),
    },
    entries,
    domains,
    emailTotal,
    domainTotal: domains.length,
    page,
    pageSize,
  };
}

export async function listSuppressionDomains(projectId: ObjectId) {
  const db = await getDb();
  const docs = await db
    .collection<SuppressionEntryDoc>("suppression_entries")
    .find({ projectId, kind: "domain" })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toString(),
    domain: doc.value,
    addedAt: doc.createdAt.toISOString(),
  })) satisfies SuppressionDomainEntry[];
}

async function addEmailToUnsubscribeList(
  projectId: ObjectId,
  email: string,
  userId: ObjectId | null,
  names?: { firstName?: string; lastName?: string },
) {
  const db = await getDb();
  const list = await getOrCreateUnsubscribeList(projectId, userId);
  const now = new Date();

  let contact = await db.collection<ContactDoc>("contacts").findOne({
    projectId,
    email,
  });

  if (!contact) {
    const result = await db.collection<ContactDoc>("contacts").insertOne({
      _id: new ObjectId(),
      projectId,
      firstName: names?.firstName?.trim() || "Blocked",
      lastName: names?.lastName?.trim() || "",
      email,
      companyId: null,
      companyName: "",
      subscribed: false,
      blocklisted: true,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    contact = await db.collection<ContactDoc>("contacts").findOne({
      _id: result.insertedId,
    });
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
    throw new Error("Could not save suppressed contact.");
  }

  const membership = await db.collection<ListMembershipDoc>("list_memberships").findOne({
    projectId,
    listId: list._id,
    contactId: contact._id,
  });

  if (!membership) {
    await db.collection<ListMembershipDoc>("list_memberships").insertOne({
      _id: new ObjectId(),
      projectId,
      listId: list._id,
      contactId: contact._id,
      addedAt: now,
      addedBy: userId,
      source: "import",
    });
    await db.collection<ListDoc>("lists").updateOne(
      { _id: list._id },
      { $inc: { contactCount: 1 }, $set: { updatedAt: now } },
    );
  }

  const inserted = await upsertSuppressionEntry(
    projectId,
    "email",
    email,
    "upload",
    userId,
  );
  return { added: inserted || !membership };
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

  await upsertSuppressionEntry(send.projectId, "email", email, "unsubscribe", null);

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

export async function bulkImportSuppression(
  projectId: ObjectId,
  userId: ObjectId | null,
  kind: SuppressionKind,
  text: string,
) {
  const values = extractBulkSuppressionValues(text, kind);
  return bulkImportSuppressionValues(projectId, userId, kind, values);
}

export async function bulkImportSuppressionValues(
  projectId: ObjectId,
  userId: ObjectId | null,
  kind: SuppressionKind,
  rawValues: string[],
) {
  const values = [
    ...new Set(
      rawValues
        .map((value) =>
          kind === "email"
            ? normalizeSuppressionEmail(value)
            : normalizeSuppressionDomain(value),
        )
        .filter(Boolean),
    ),
  ];
  if (values.length === 0) {
    throw new Error(
      kind === "email"
        ? "No valid emails found. Add one email per line or a CSV of addresses."
        : "No valid domains found. Add one domain per line, for example competitor.com.",
    );
  }

  if (kind === "domain") {
    return bulkImportSuppressionDomains(projectId, userId, values);
  }
  return bulkImportSuppressionEmails(projectId, userId, values);
}

const SUPPRESSION_WRITE_BATCH = 500;

async function bulkImportSuppressionDomains(
  projectId: ObjectId,
  userId: ObjectId | null,
  domains: string[],
) {
  const db = await getDb();
  const now = new Date();
  let added = 0;
  let skipped = 0;

  for (let offset = 0; offset < domains.length; offset += SUPPRESSION_WRITE_BATCH) {
    const batch = domains.slice(offset, offset + SUPPRESSION_WRITE_BATCH);
    const existing = await db
      .collection<SuppressionEntryDoc>("suppression_entries")
      .find({ projectId, kind: "domain", value: { $in: batch } })
      .project({ value: 1 })
      .toArray();
    const already = new Set(existing.map((doc) => doc.value));
    skipped += already.size;

    const ops = batch
      .filter((domain) => !already.has(domain))
      .map((domain) => ({
        updateOne: {
          filter: { projectId, kind: "domain" as const, value: domain },
          update: {
            $setOnInsert: {
              _id: new ObjectId(),
              projectId,
              kind: "domain" as const,
              value: domain,
              source: "upload" as const,
              createdBy: userId,
              createdAt: now,
            },
          },
          upsert: true,
        },
      }));

    if (ops.length > 0) {
      const result = await db
        .collection<SuppressionEntryDoc>("suppression_entries")
        .bulkWrite(ops, { ordered: false });
      added += result.upsertedCount;
    }
  }

  return { kind: "domain" as const, added, skipped, total: domains.length };
}

async function bulkImportSuppressionEmails(
  projectId: ObjectId,
  userId: ObjectId | null,
  emails: string[],
) {
  const db = await getDb();
  const list = await getOrCreateUnsubscribeList(projectId, userId);
  const now = new Date();
  let added = 0;
  let skipped = 0;

  for (let offset = 0; offset < emails.length; offset += SUPPRESSION_WRITE_BATCH) {
    const batch = emails.slice(offset, offset + SUPPRESSION_WRITE_BATCH);

    const [existingContacts, existingSuppression] = await Promise.all([
      db
        .collection<ContactDoc>("contacts")
        .find({ projectId, email: { $in: batch } })
        .project({ _id: 1, email: 1 })
        .toArray(),
      db
        .collection<SuppressionEntryDoc>("suppression_entries")
        .find({ projectId, kind: "email", value: { $in: batch } })
        .project({ value: 1 })
        .toArray(),
    ]);

    const contactByEmail = new Map(
      existingContacts.map((contact) => [
        contact.email.trim().toLowerCase(),
        contact,
      ]),
    );
    const alreadySuppressed = new Set(existingSuppression.map((doc) => doc.value));

    if (existingContacts.length > 0) {
      await db.collection<ContactDoc>("contacts").updateMany(
        { projectId, _id: { $in: existingContacts.map((contact) => contact._id) } },
        {
          $set: {
            subscribed: false,
            blocklisted: true,
            updatedAt: now,
          },
        },
      );
    }

    const missingEmails = batch.filter((email) => !contactByEmail.has(email));
    if (missingEmails.length > 0) {
      const docs = missingEmails.map((email) => ({
        _id: new ObjectId(),
        projectId,
        firstName: "Blocked",
        lastName: "",
        email,
        companyId: null,
        companyName: "",
        subscribed: false,
        blocklisted: true,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }));
      try {
        await db.collection<ContactDoc>("contacts").insertMany(docs, { ordered: false });
      } catch (error) {
        // Parallel uploads / races can hit duplicate emails; continue with a refetch.
        if (
          !(error instanceof Error) ||
          !/duplicate|E11000/i.test(error.message)
        ) {
          throw error;
        }
      }
      for (const doc of docs) {
        if (!contactByEmail.has(doc.email)) {
          contactByEmail.set(doc.email, doc);
        }
      }
    }

    const contacts = await db
      .collection<ContactDoc>("contacts")
      .find({ projectId, email: { $in: batch } })
      .project({ _id: 1, email: 1 })
      .toArray();
    const contactIds = contacts.map((contact) => contact._id);

    const existingMemberships =
      contactIds.length === 0
        ? []
        : await db
            .collection<ListMembershipDoc>("list_memberships")
            .find({
              projectId,
              listId: list._id,
              contactId: { $in: contactIds },
            })
            .project({ contactId: 1 })
            .toArray();
    const memberIds = new Set(
      existingMemberships.map((membership) => membership.contactId.toString()),
    );

    const newMemberships = contacts
      .filter((contact) => !memberIds.has(contact._id.toString()))
      .map((contact) => ({
        _id: new ObjectId(),
        projectId,
        listId: list._id,
        contactId: contact._id,
        addedAt: now,
        addedBy: userId,
        source: "import" as const,
      }));

    if (newMemberships.length > 0) {
      await db.collection<ListMembershipDoc>("list_memberships").insertMany(newMemberships, {
        ordered: false,
      });
    }

    const suppressionOps = batch.map((email) => ({
      updateOne: {
        filter: { projectId, kind: "email" as const, value: email },
        update: {
          $setOnInsert: {
            _id: new ObjectId(),
            projectId,
            kind: "email" as const,
            value: email,
            source: "upload" as const,
            createdBy: userId,
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));
    if (suppressionOps.length > 0) {
      await db
        .collection<SuppressionEntryDoc>("suppression_entries")
        .bulkWrite(suppressionOps, { ordered: false });
    }

    for (const email of batch) {
      const contact = contacts.find(
        (item) => item.email.trim().toLowerCase() === email,
      );
      const hadMembership = contact
        ? memberIds.has(contact._id.toString())
        : false;
      if (alreadySuppressed.has(email) && hadMembership) {
        skipped += 1;
      } else {
        added += 1;
      }
    }
  }

  const emailTotal = await db.collection<ListMembershipDoc>("list_memberships").countDocuments({
    projectId,
    listId: list._id,
  });
  await db.collection<ListDoc>("lists").updateOne(
    { _id: list._id },
    {
      $set: {
        contactCount: emailTotal,
        updatedAt: now,
      },
    },
  );

  return { kind: "email" as const, added, skipped, total: emails.length };
}

export async function removeSuppressionItem(
  projectId: ObjectId,
  kind: SuppressionKind,
  id: string,
) {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid suppression item.");
  }

  const db = await getDb();
  const now = new Date();

  if (kind === "domain") {
    const result = await db.collection<SuppressionEntryDoc>("suppression_entries").deleteOne({
      _id: new ObjectId(id),
      projectId,
      kind: "domain",
    });
    if (result.deletedCount === 0) {
      throw new Error("Domain not found on the suppression list.");
    }
    return { ok: true, kind };
  }

  const contact = await db.collection<ContactDoc>("contacts").findOne({
    _id: new ObjectId(id),
    projectId,
  });
  if (!contact) {
    throw new Error("Email not found on the unsubscribe list.");
  }

  const list = await db.collection<ListDoc>("lists").findOne({
    projectId,
    name: UNSUBSCRIBE_LIST_NAME,
  });
  if (list) {
    const membership = await db.collection<ListMembershipDoc>("list_memberships").findOne({
      projectId,
      listId: list._id,
      contactId: contact._id,
    });
    if (membership) {
      await db.collection<ListMembershipDoc>("list_memberships").deleteOne({
        _id: membership._id,
      });
      await db.collection<ListDoc>("lists").updateOne(
        { _id: list._id },
        {
          $set: {
            contactCount: Math.max(0, (list.contactCount ?? 1) - 1),
            updatedAt: now,
          },
        },
      );
    }
  }

  const email = contact.email.trim().toLowerCase();
  await db.collection<SuppressionEntryDoc>("suppression_entries").deleteMany({
    projectId,
    kind: "email",
    value: email,
  });
  await db.collection<ContactDoc>("contacts").updateOne(
    { _id: contact._id },
    {
      $set: {
        subscribed: true,
        blocklisted: false,
        updatedAt: now,
      },
    },
  );

  return { ok: true, kind };
}
