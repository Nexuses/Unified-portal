import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  mapContact,
  type Contact,
  type ContactDoc,
  type ContactProfile,
  type ListDoc,
  type ListMembershipDoc,
} from "@/lib/crm";
import { LEAD_REPORT_ATTR } from "@/lib/lead-report-map";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/lead-status";
import {
  getSuppressionSets,
  isSuppressedAddress,
} from "@/lib/unsubscribe-server";

export type LeadReportListRef = {
  id: string;
  name: string;
};

export type LeadReportListItem = Contact & {
  leadStage?: string;
  leadStageLabel?: string;
  leadProject?: string;
  leadOwner?: string;
  /** When the lead report was made (legacy or first flagged). */
  leadReportAt?: string;
  /** True when the email is unsubscribed / on the suppression list. */
  unsubscribed: boolean;
  /** CRM lists this contact belongs to (if any). */
  lists: LeadReportListRef[];
  /** @deprecated use lists */
  listNames: string[];
  hasLeadReport: boolean;
};

export type ListLeadReportsOptions = {
  page?: number;
  pageSize?: number;
  q?: string;
  stage?: string;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLeadReportContact(doc: ContactDoc) {
  if (doc.attributes?.[LEAD_REPORT_ATTR.flag] === "1") return true;
  if (doc.attributes?.[LEAD_REPORT_ATTR.legacyId]) return true;
  if (doc.profile?.leadStage) return true;
  return false;
}

function toListItem(
  doc: ContactDoc,
  lists: LeadReportListRef[] = [],
  unsubscribed = false,
): LeadReportListItem {
  const contact = mapContact(doc);
  const stage = (doc.profile?.leadStage || "").trim();
  const leadReportAt =
    doc.attributes?.[LEAD_REPORT_ATTR.createdAt]?.trim() ||
    contact.createdAt ||
    contact.updatedAt;
  return {
    ...contact,
    leadStage: stage || undefined,
    leadStageLabel: stage
      ? LEAD_STATUS_LABELS[stage as LeadStatus] || stage
      : undefined,
    leadProject: doc.attributes?.[LEAD_REPORT_ATTR.project] || undefined,
    leadOwner: doc.attributes?.[LEAD_REPORT_ATTR.owner] || undefined,
    leadReportAt,
    unsubscribed: unsubscribed || contact.subscribed === false,
    lists,
    listNames: lists.map((list) => list.name),
    hasLeadReport: true,
  };
}

async function listsByContactIds(projectId: ObjectId, contactIds: ObjectId[]) {
  const listsByContact = new Map<string, LeadReportListRef[]>();
  if (contactIds.length === 0) {
    return listsByContact;
  }

  const db = await getDb();
  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, contactId: { $in: contactIds } })
    .toArray();

  if (memberships.length === 0) {
    return listsByContact;
  }

  const listIds = [...new Set(memberships.map((row) => row.listId.toString()))].map(
    (id) => new ObjectId(id),
  );
  const lists = await db
    .collection<ListDoc>("lists")
    .find({ _id: { $in: listIds }, projectId }, { projection: { name: 1 } })
    .toArray();
  const listById = new Map(
    lists.map((list) => [
      list._id.toString(),
      { id: list._id.toString(), name: list.name } satisfies LeadReportListRef,
    ]),
  );

  for (const membership of memberships) {
    const list = listById.get(membership.listId.toString());
    if (!list) continue;
    const key = membership.contactId.toString();
    const current = listsByContact.get(key) || [];
    if (!current.some((entry) => entry.id === list.id)) {
      current.push(list);
    }
    listsByContact.set(key, current);
  }

  for (const [key, entries] of listsByContact) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
    listsByContact.set(key, entries);
  }

  return listsByContact;
}

export async function listProjectLeadReports(
  projectId: ObjectId,
  options?: ListLeadReportsOptions,
) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(options?.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const q = String(options?.q ?? "").trim();
  const stage = String(options?.stage ?? "").trim();

  const filter: Record<string, unknown> = {
    projectId,
    $or: [
      { [`attributes.${LEAD_REPORT_ATTR.flag}`]: "1" },
      { [`attributes.${LEAD_REPORT_ATTR.legacyId}`]: { $exists: true, $ne: "" } },
      { "profile.leadStage": { $exists: true, $nin: [null, ""] } },
    ],
  };

  if (stage) {
    filter["profile.leadStage"] = stage;
  }

  if (q) {
    const regex = { $regex: escapeRegex(q), $options: "i" };
    filter.$and = [
      {
        $or: [
          { email: regex },
          { firstName: regex },
          { lastName: regex },
          { companyName: regex },
          { [`attributes.${LEAD_REPORT_ATTR.project}`]: regex },
          { [`attributes.${LEAD_REPORT_ATTR.owner}`]: regex },
        ],
      },
    ];
  }

  const collection = (await getDb()).collection<ContactDoc>("contacts");
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

  const leadDocs = docs.filter(isLeadReportContact);
  const [listsByContact, suppression] = await Promise.all([
    listsByContactIds(
      projectId,
      leadDocs.map((doc) => doc._id),
    ),
    getSuppressionSets(projectId),
  ]);

  return {
    items: leadDocs.map((doc) =>
      toListItem(
        doc,
        listsByContact.get(doc._id.toString()) || [],
        isSuppressedAddress(doc.email, suppression),
      ),
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function ensureContactLeadReport(
  projectId: ObjectId,
  contactId: ObjectId,
  extras?: {
    leadStage?: string;
    leadProject?: string;
    leadOwner?: string;
  },
) {
  const db = await getDb();
  const existing = await db.collection<ContactDoc>("contacts").findOne({
    _id: contactId,
    projectId,
  });
  if (!existing) {
    return null;
  }

  const attributes = { ...(existing.attributes || {}) };
  attributes[LEAD_REPORT_ATTR.flag] = "1";
  if (!attributes[LEAD_REPORT_ATTR.createdAt]) {
    attributes[LEAD_REPORT_ATTR.createdAt] =
      existing.createdAt?.toISOString?.() || new Date().toISOString();
  }
  if (extras?.leadProject) {
    attributes[LEAD_REPORT_ATTR.project] = extras.leadProject;
  }
  if (extras?.leadOwner) {
    attributes[LEAD_REPORT_ATTR.owner] = extras.leadOwner;
  }

  const profile: ContactProfile = { ...(existing.profile || {}) };
  if (extras?.leadStage && !profile.leadStage) {
    profile.leadStage = extras.leadStage;
  }
  if (!profile.leadStage) {
    profile.leadStage = "warm";
  }

  const now = new Date();
  await db.collection<ContactDoc>("contacts").updateOne(
    { _id: contactId, projectId },
    {
      $set: {
        attributes,
        profile,
        updatedAt: now,
      },
    },
  );

  const updated = await db.collection<ContactDoc>("contacts").findOne({
    _id: contactId,
    projectId,
  });
  return updated ? toListItem(updated) : null;
}

export async function createLeadReportContact(
  projectId: ObjectId,
  input: {
    email: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    userId?: ObjectId | null;
    leadProject?: string;
    leadOwner?: string;
  },
) {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  const db = await getDb();
  const existing = await db.collection<ContactDoc>("contacts").findOne({
    projectId,
    email,
  });
  if (existing) {
    return ensureContactLeadReport(projectId, existing._id, {
      leadProject: input.leadProject,
      leadOwner: input.leadOwner,
    });
  }

  const now = new Date();
  const doc: ContactDoc = {
    _id: new ObjectId(),
    projectId,
    firstName: (input.firstName || "").trim() || email.split("@")[0] || "Lead",
    lastName: (input.lastName || "").trim(),
    email,
    companyId: null,
    companyName: (input.companyName || "").trim(),
    attributes: {
      [LEAD_REPORT_ATTR.flag]: "1",
      [LEAD_REPORT_ATTR.createdAt]: now.toISOString(),
      ...(input.leadProject
        ? { [LEAD_REPORT_ATTR.project]: input.leadProject }
        : {}),
      ...(input.leadOwner ? { [LEAD_REPORT_ATTR.owner]: input.leadOwner } : {}),
    },
    profile: {
      leadStage: "warm",
      source: "portal-lead-report",
    },
    subscribed: true,
    blocklisted: false,
    createdBy: input.userId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<ContactDoc>("contacts").insertOne(doc);
  return toListItem(doc);
}
