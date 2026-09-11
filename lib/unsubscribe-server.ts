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

export type SuppressionDomainEntry = {
  id: string;
  domain: string;
  addedAt: string;
};

export type SuppressionKind = "email" | "domain";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function normalizeSuppressionEmail(value: string) {
  const email = value.trim().toLowerCase().replace(/^mailto:/i, "");
  return EMAIL_RE.test(email) ? email : "";
}

export function normalizeSuppressionDomain(value: string) {
  let raw = value.trim().toLowerCase();
  if (!raw) {
    return "";
  }
  raw = raw.replace(/^https?:\/\//, "");
  if (raw.startsWith("@")) {
    raw = raw.slice(1);
  }
  if (raw.includes("@")) {
    raw = raw.slice(raw.lastIndexOf("@") + 1);
  }
  raw = raw.split("/")[0]?.split("?")[0]?.split(":")[0] ?? "";
  raw = raw.replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN_RE.test(raw) ? raw : "";
}

export function extractBulkSuppressionValues(text: string, kind: SuppressionKind) {
  const tokens = text
    .replace(/^\uFEFF/, "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const values = new Set<string>();
  for (const token of tokens) {
    const next =
      kind === "email"
        ? normalizeSuppressionEmail(token)
        : normalizeSuppressionDomain(token);
    if (next) {
      values.add(next);
    }
  }
  return [...values];
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
    domains: await listSuppressionDomains(projectId),
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
  if (values.length === 0) {
    throw new Error(
      kind === "email"
        ? "No valid emails found. Add one email per line or a CSV of addresses."
        : "No valid domains found. Add one domain per line, for example competitor.com.",
    );
  }

  let added = 0;
  let skipped = 0;
  if (kind === "email") {
    for (const email of values) {
      const result = await addEmailToUnsubscribeList(projectId, email, userId);
      if (result.added) {
        added += 1;
      } else {
        skipped += 1;
      }
    }
  } else {
    for (const domain of values) {
      const inserted = await upsertSuppressionEntry(
        projectId,
        "domain",
        domain,
        "upload",
        userId,
      );
      if (inserted) {
        added += 1;
      } else {
        skipped += 1;
      }
    }
  }

  return { kind, added, skipped, total: values.length };
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
