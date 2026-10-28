import type { ObjectId } from "mongodb";

export type CrmCoreField =
  | "firstName"
  | "lastName"
  | "email"
  | "companyName";

export type CrmAttributeKey =
  | CrmCoreField
  | "position"
  | "industry"
  | "website"
  | "companySourceUrl"
  | "personalLinkedIn"
  | "contactSourceUrl"
  | "personLocation"
  | "phoneNumber"
  | (string & {});

/** @deprecated Prefer CrmAttributeKey / DEFAULT_LIST_ATTRIBUTES */
export type CrmImportField = CrmCoreField;

export type ListAttributeDef = {
  key: string;
  label: string;
  required: boolean;
  locked?: boolean;
};

export const DEFAULT_LIST_ATTRIBUTES: ListAttributeDef[] = [
  { key: "firstName", label: "First Name", required: true, locked: true },
  { key: "lastName", label: "Last Name", required: false },
  { key: "companyName", label: "Company Name", required: true, locked: true },
  { key: "position", label: "Position", required: false },
  { key: "email", label: "Email", required: true, locked: true },
  { key: "phoneNumber", label: "Phone Number", required: false },
  { key: "industry", label: "Industry", required: false },
  { key: "website", label: "Website", required: false },
  { key: "companySourceUrl", label: "Company Source URL", required: false },
  { key: "personalLinkedIn", label: "Personal LinkedIn", required: false },
  { key: "contactSourceUrl", label: "Contact Source URL", required: false },
  { key: "personLocation", label: "Person Location", required: false },
];

/** Core fields required on CSV import / create contact. Last Name is optional. */
export const REQUIRED_CONTACT_FIELDS = [
  "firstName",
  "email",
  "companyName",
] as const;

export const CRM_IMPORT_FIELDS: {
  key: CrmImportField;
  label: string;
  required: boolean;
}[] = DEFAULT_LIST_ATTRIBUTES.filter((field) =>
  ["firstName", "lastName", "email", "companyName"].includes(field.key),
).map((field) => ({
  key: field.key as CrmImportField,
  label: field.label,
  required: field.required,
}));

export const CONTACT_ATTRIBUTE_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_LIST_ATTRIBUTES.map((field) => [field.key, field.label]),
);

export type CrmContactInput = {
  firstName: string;
  lastName: string;
  email: string;
  companyName?: string;
  attributes?: Record<string, string>;
};

export type ImportSummary = {
  imported: number;
  skipped: number;
  companiesCreated: number;
  contactsCreated: number;
  contactsUpdated: number;
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  companyId: string | null;
  companyName: string;
  attributes: Record<string, string>;
  subscribed: boolean;
  blocklisted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Company = {
  id: string;
  name: string;
  contactCount: number;
  createdAt: string;
};

export type CompanyContact = {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
};

export type CompanyWithContacts = Company & {
  domain: string;
  owner: string;
  contacts: CompanyContact[];
};

export type CompanyHistoryEvent = {
  id: string;
  type: "created" | "contact_associated";
  title: string;
  description: string;
  at: string;
  actor: string;
};

export type CompanyDetail = CompanyWithContacts & {
  history: CompanyHistoryEvent[];
  navigation: {
    index: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
  };
};

export type CrmList = {
  id: string;
  name: string;
  displayId: number;
  contactCount: number;
  /** Distinct CRM companies (accounts) among list members. */
  companyCount: number;
  createdAt: string;
  importFileName?: string;
};

export type ContactListMembership = {
  id: string;
  name: string;
  displayId: number;
  addedAt: string;
  createdAt: string;
  source: "import" | "manual";
  importFileName?: string;
};

export type ContactCompanySummary = {
  id: string;
  name: string;
  contactCount: number;
};

export type ContactCampaignStats = {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  replies: number;
};

export type ContactHistoryEvent = {
  id: string;
  type:
    | "import"
    | "list_added"
    | "company_associated"
    | "campaign_sent"
    | "campaign_delivered"
    | "campaign_opened"
    | "campaign_clicked"
    | "campaign_unsubscribed";
  title: string;
  description: string;
  at: string;
  actor: string;
  listId?: string;
  listDisplayId?: number;
  listName?: string;
  companyId?: string;
  companyName?: string;
  importFileName?: string;
  campaignId?: string;
  campaignKind?: "drip" | "oneone";
  campaignName?: string;
  /** campaign_sends._id — used to open the sent email preview modal. */
  sendId?: string;
  /** Email subject for this send (personalised line or blast subject). */
  emailSubject?: string;
  /** Optional preview / preheader text from the blast. */
  emailPreview?: string;
  clickedUrl?: string;
  /** Absolute sent/opened/clicked time already on `at`; extras for engagement. */
  ip?: string;
  device?: "mobile" | "tablet" | "desktop" | "unknown";
  userAgent?: string;
  /** e.g. "Bot open" / "Open not tracked" when open was inferred from a click. */
  openTag?: string;
  /** e.g. "Bot click" for scanner/bot-like clicks. */
  clickTag?: string;
};

export const CONTACT_PIPELINE_STAGES = [
  "Warm",
  "Hot",
  "Meeting Scheduled",
  "Meeting Rescheduled",
  "Meeting Done",
  "Contact Later",
  "Client Manage",
  "Client Unavailable",
  "Client Rejected",
  "Lost",
] as const;

export type ContactPipelineStage = (typeof CONTACT_PIPELINE_STAGES)[number];

export type ContactProfileNote = {
  id: string;
  at: string;
  body: string;
};

export type ContactProfileTimelineItem = {
  id: string;
  at: string;
  body: string;
  /** Manual activity channel: call | whatsapp | message | note */
  kind?: string;
};

export type ContactProfile = {
  title?: string;
  phone?: string;
  linkedinUrl?: string;
  /** Profile photo URL (typically from Apollo / LinkedIn). */
  photoUrl?: string;
  location?: string;
  about?: string;
  leadStage?: string;
  source?: string;
  score?: number;
  qualification?: {
    decisionMaker?: boolean;
    viewedDeck?: boolean;
    haveBudget?: boolean;
    need?: boolean;
    overallScore?: number;
  };
  company?: {
    industry?: string;
    employees?: string;
    location?: string;
    website?: string;
    linkedinUrl?: string;
    description?: string;
  };
  meeting?: {
    at?: string;
    timezone?: string;
    channel?: string;
    title?: string;
    joinUrl?: string;
  };
  brief?: {
    problem?: string;
    objective?: string;
    stakes?: string;
  };
  news?: string;
  notes?: ContactProfileNote[];
  timeline?: ContactProfileTimelineItem[];
  apollo?: {
    personId?: string;
    enrichedAt?: string;
    raw?: Record<string, unknown>;
  };
};

export type ContactDetail = Contact & {
  owner: string;
  updatedAt: string;
  company: ContactCompanySummary | null;
  lists: ContactListMembership[];
  history: ContactHistoryEvent[];
  campaignStats: ContactCampaignStats;
  profile: ContactProfile;
  navigation: {
    index: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
  };
};

export type ContactDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  companyId: ObjectId | null;
  companyName: string;
  attributes?: Record<string, string>;
  profile?: ContactProfile;
  /** Public Lead Report share token (base64url). */
  shareToken?: string;
  subscribed: boolean;
  blocklisted: boolean;
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapContactProfile(profile?: ContactProfile | null): ContactProfile {
  return profile ? { ...profile } : {};
}

/** Prefer saved photoUrl; fall back to Apollo raw person.photo_url. */
export function resolveContactPhotoUrl(
  profile?: ContactProfile | null,
): string {
  const direct = String(profile?.photoUrl || "").trim();
  if (direct) return direct;
  const rawPerson = profile?.apollo?.raw?.person;
  if (rawPerson && typeof rawPerson === "object") {
    const photo = (rawPerson as Record<string, unknown>).photo_url;
    if (typeof photo === "string" && photo.trim()) return photo.trim();
  }
  return "";
}

export type CompanyDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  nameKey: string;
  contactCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ListDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  displayId: number;
  contactCount: number;
  /** Distinct CRM companies (accounts) among list members. */
  companyCount?: number;
  importFileName?: string;
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ListMembershipDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  listId: ObjectId;
  contactId: ObjectId;
  addedAt: Date;
  addedBy: ObjectId | null;
  source: "import" | "manual";
};

export function mapContact(doc: ContactDoc): Contact {
  return {
    id: doc._id.toString(),
    firstName: doc.firstName,
    lastName: doc.lastName,
    fullName: `${doc.firstName} ${doc.lastName}`.trim() || doc.email,
    email: doc.email,
    companyId: doc.companyId?.toString() ?? null,
    companyName: doc.companyName,
    attributes: doc.attributes ?? {},
    subscribed: doc.subscribed,
    blocklisted: doc.blocklisted,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function slugifyAttributeKey(label: string) {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `custom_${Date.now().toString(36)}`;
}

export function mapCompany(doc: CompanyDoc): Company {
  return {
    id: doc._id.toString(),
    name: doc.name,
    contactCount: doc.contactCount,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function mapList(doc: ListDoc): CrmList {
  return {
    id: doc._id.toString(),
    name: doc.name,
    displayId: doc.displayId,
    contactCount: doc.contactCount,
    companyCount: doc.companyCount ?? 0,
    createdAt: doc.createdAt.toISOString(),
    importFileName: doc.importFileName,
  };
}

export function normalizeCompanyKey(name: string) {
  return name.trim().toLowerCase();
}

/** Evenly distribute `total` items across `parts` (earlier parts get the remainder). */
export function planListSplitCounts(total: number, parts: number): number[] {
  const safeParts = Math.max(1, Math.floor(parts));
  const safeTotal = Math.max(0, Math.floor(total));
  const base = Math.floor(safeTotal / safeParts);
  const rem = safeTotal % safeParts;
  return Array.from(
    { length: safeParts },
    (_, index) => base + (index < rem ? 1 : 0),
  );
}

export function defaultSplitListNames(sourceName: string, parts: number): string[] {
  const base = sourceName.trim() || "List";
  return Array.from({ length: Math.max(1, Math.floor(parts)) }, (_, index) =>
    `${base} (${index + 1})`,
  );
}

export function formatListDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const datePart = date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  const timePart = date.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}

export function getCompanyLetter(name: string) {
  const letter = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "#";
}

export function groupCompaniesByLetter<T extends { name: string }>(
  companies: T[],
) {
  const groups = new Map<string, T[]>();

  for (const company of companies) {
    const letter = getCompanyLetter(company.name);
    const bucket = groups.get(letter) ?? [];
    bucket.push(company);
    groups.set(letter, bucket);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([letter, items]) => ({
      letter,
      companies: items.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    }));
}

export function deriveCompanyDomain(emails: string[]) {
  const counts = new Map<string, number>();

  for (const email of emails) {
    const at = email.indexOf("@");
    if (at === -1) {
      continue;
    }

    const domain = email.slice(at + 1).trim().toLowerCase();
    if (!domain) {
      continue;
    }

    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  let bestDomain = "";
  let bestCount = 0;

  for (const [domain, count] of counts) {
    if (count > bestCount) {
      bestDomain = domain;
      bestCount = count;
    }
  }

  return bestDomain;
}

export function formatCompanyDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-GB");
}

export function formatRelativeTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `about ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `about ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `about ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function buildCompanyHistory(
  company: Pick<CompanyWithContacts, "createdAt" | "name">,
  contacts: CompanyContact[],
  owner: string,
): CompanyHistoryEvent[] {
  const events: CompanyHistoryEvent[] = [
    {
      id: "created",
      type: "created",
      title: "Company created",
      description: `${owner} created a new company`,
      at: company.createdAt,
      actor: owner,
    },
  ];

  for (const contact of contacts) {
    events.push({
      id: `contact-${contact.id}`,
      type: "contact_associated",
      title: "Contact associated",
      description: `This company has been associated with the contact: ${contact.fullName}`,
      at: contact.createdAt,
      actor: owner,
    });
  }

  return events.sort(
    (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
  );
}

export function groupHistoryByDay<T extends { at: string }>(events: T[]) {
  const groups = new Map<string, T[]>();

  for (const event of events) {
    const day = new Date(event.at).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const label = day === today ? "Today" : day;
    const bucket = groups.get(label) ?? [];
    bucket.push(event);
    groups.set(label, bucket);
  }

  return [...groups.entries()].map(([label, items]) => ({
    label,
    events: items,
  }));
}

export function buildContactHistory({
  contact,
  lists,
  company,
  owner,
  campaignEvents = [],
}: {
  contact: Pick<Contact, "createdAt" | "updatedAt" | "companyName">;
  lists: ContactListMembership[];
  company: ContactCompanySummary | null;
  owner: string;
  campaignEvents?: ContactHistoryEvent[];
}): ContactHistoryEvent[] {
  const events: ContactHistoryEvent[] = [...campaignEvents];

  if (company) {
    events.push({
      id: `company-${company.id}`,
      type: "company_associated",
      title: "Company associated",
      description: `This contact has been associated to the company: ${company.name}`,
      // Use createdAt — updatedAt moves this to the top on every profile edit.
      at: contact.createdAt,
      actor: owner,
      companyId: company.id,
      companyName: company.name,
    });
  } else if (contact.companyName) {
    events.push({
      id: "company-name",
      type: "company_associated",
      title: "Company associated",
      description: `This contact has been associated to the company: ${contact.companyName}`,
      at: contact.createdAt,
      actor: owner,
      companyName: contact.companyName,
    });
  }

  const importLists = lists.filter(
    (list) => list.source === "import" && list.importFileName,
  );
  const seenImportFiles = new Set<string>();

  for (const list of importLists) {
    const fileName = list.importFileName ?? "";
    if (!fileName || seenImportFiles.has(fileName)) {
      continue;
    }
    seenImportFiles.add(fileName);
    events.push({
      id: `import-${list.id}`,
      type: "import",
      title: "Added via a contacts import",
      description: `Added via a contacts import by ${owner}: via the file ${fileName}`,
      at: contact.createdAt,
      actor: owner,
      importFileName: fileName,
      listId: list.id,
      listName: list.name,
    });
  }

  for (const list of lists) {
    events.push({
      id: `list-${list.id}`,
      type: "list_added",
      title: "Contact added to the list(s)",
      description: `(#${list.displayId}) ${list.name}`,
      at: list.addedAt,
      actor: owner,
      listId: list.id,
      listDisplayId: list.displayId,
      listName: list.name,
    });
  }

  if (events.length === 0) {
    events.push({
      id: "created",
      type: "import",
      title: "Contact created",
      description: `${owner} added this contact to the CRM`,
      at: contact.createdAt,
      actor: owner,
    });
  }

  return events.sort((left, right) => {
    const timeDiff =
      new Date(right.at).getTime() - new Date(left.at).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    // Same timestamp: keep import/list above company association.
    return historySortRank(right.type) - historySortRank(left.type);
  });
}

/** Higher rank appears first when event times are equal (newest-first feed). */
function historySortRank(type: ContactHistoryEvent["type"]) {
  switch (type) {
    case "campaign_clicked":
    case "campaign_opened":
    case "campaign_sent":
    case "campaign_delivered":
    case "campaign_unsubscribed":
      return 50;
    case "list_added":
      return 40;
    case "import":
      return 30;
    case "company_associated":
      return 10;
    default:
      return 20;
  }
}
