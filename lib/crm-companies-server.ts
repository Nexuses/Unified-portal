import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  deriveCompanyDomain,
  mapCompany,
  mapContact,
  type CompanyContact,
  type CompanyDoc,
  type CompanyWithContacts,
  type ContactDoc,
} from "@/lib/crm";

export async function getProjectCompaniesWithContacts(
  projectId: ObjectId,
  owner: string,
): Promise<CompanyWithContacts[]> {
  const db = await getDb();

  const [companies, contacts] = await Promise.all([
    db
      .collection<CompanyDoc>("companies")
      .find({ projectId })
      .sort({ name: 1 })
      .toArray(),
    db
      .collection<ContactDoc>("contacts")
      .find({ projectId, companyId: { $ne: null } })
      .sort({ lastName: 1, firstName: 1 })
      .toArray(),
  ]);

  const contactsByCompany = new Map<string, CompanyContact[]>();

  for (const contact of contacts) {
    if (!contact.companyId) {
      continue;
    }

    const companyId = contact.companyId.toString();
    const mapped = mapContact(contact);
    const bucket = contactsByCompany.get(companyId) ?? [];
    bucket.push({
      id: mapped.id,
      fullName: mapped.fullName,
      email: mapped.email,
      createdAt: mapped.createdAt,
    });
    contactsByCompany.set(companyId, bucket);
  }

  return companies.map((company) => {
    const companyContacts = contactsByCompany.get(company._id.toString()) ?? [];
    const emails = companyContacts.map((contact) => contact.email);

    return {
      ...mapCompany(company),
      domain: deriveCompanyDomain(emails),
      owner,
      contacts: companyContacts,
    };
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listProjectCompanies(
  projectId: ObjectId,
  owner: string,
  options?: { page?: number; pageSize?: number; q?: string },
) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(options?.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const q = String(options?.q ?? "").trim();

  const db = await getDb();
  const filter: Record<string, unknown> = { projectId };
  if (q) {
    filter.name = { $regex: escapeRegex(q), $options: "i" };
  }

  const collection = db.collection<CompanyDoc>("companies");
  const [total, companies] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

  const companyIds = companies.map((company) => company._id);
  const contacts =
    companyIds.length === 0
      ? []
      : await db
          .collection<ContactDoc>("contacts")
          .find({ projectId, companyId: { $in: companyIds } })
          .sort({ lastName: 1, firstName: 1 })
          .toArray();

  const contactsByCompany = new Map<string, CompanyContact[]>();
  for (const contact of contacts) {
    if (!contact.companyId) {
      continue;
    }
    const companyId = contact.companyId.toString();
    const mapped = mapContact(contact);
    const bucket = contactsByCompany.get(companyId) ?? [];
    bucket.push({
      id: mapped.id,
      fullName: mapped.fullName,
      email: mapped.email,
      createdAt: mapped.createdAt,
    });
    contactsByCompany.set(companyId, bucket);
  }

  const items = companies.map((company) => {
    const companyContacts = contactsByCompany.get(company._id.toString()) ?? [];
    const emails = companyContacts.map((contact) => contact.email);
    return {
      ...mapCompany(company),
      domain: deriveCompanyDomain(emails) || "",
      owner,
      contacts: companyContacts,
      contactCount: companyContacts.length,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getProjectCompanyWithContacts(
  projectId: ObjectId,
  companyId: ObjectId,
  owner: string,
) {
  const db = await getDb();
  const collection = db.collection<CompanyDoc>("companies");
  const doc = await collection.findOne({ _id: companyId, projectId });
  if (!doc) {
    return { company: null, index: -1, total: 0, prevId: null, nextId: null };
  }

  const before = {
    projectId,
    $or: [{ name: { $lt: doc.name } }, { name: doc.name, _id: { $lt: doc._id } }],
  };
  const after = {
    projectId,
    $or: [{ name: { $gt: doc.name } }, { name: doc.name, _id: { $gt: doc._id } }],
  };
  const projection = { _id: 1 } as const;

  const [contacts, index, total, prev, next] = await Promise.all([
    db
      .collection<ContactDoc>("contacts")
      .find({ projectId, companyId })
      .sort({ lastName: 1, firstName: 1 })
      .toArray(),
    collection.countDocuments(before),
    collection.countDocuments({ projectId }),
    collection.find(before, { projection }).sort({ name: -1, _id: -1 }).limit(1).next(),
    collection.find(after, { projection }).sort({ name: 1, _id: 1 }).limit(1).next(),
  ]);

  const companyContacts: CompanyContact[] = contacts.map((contact) => {
    const mapped = mapContact(contact);
    return {
      id: mapped.id,
      fullName: mapped.fullName,
      email: mapped.email,
      createdAt: mapped.createdAt,
    };
  });

  const company: CompanyWithContacts = {
    ...mapCompany(doc),
    domain: deriveCompanyDomain(companyContacts.map((contact) => contact.email)),
    owner,
    contacts: companyContacts,
  };

  return {
    company,
    index,
    total,
    prevId: prev?._id.toString() ?? null,
    nextId: next?._id.toString() ?? null,
  };
}
