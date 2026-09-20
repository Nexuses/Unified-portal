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
  const companies = await getProjectCompaniesWithContacts(projectId, owner);
  const index = companies.findIndex((company) => company.id === companyId.toString());
  const company = index >= 0 ? companies[index] : null;

  return {
    company,
    index,
    total: companies.length,
    prevId: index > 0 ? companies[index - 1]?.id ?? null : null,
    nextId:
      index >= 0 && index < companies.length - 1
        ? companies[index + 1]?.id ?? null
        : null,
    allIds: companies.map((entry) => entry.id),
  };
}
