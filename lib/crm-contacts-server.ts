import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  matchPersonByEmail,
  profileFromApolloPerson,
} from "@/lib/apollo";
import {
  buildContactHistory,
  mapContact,
  mapContactProfile,
  resolveContactPhotoUrl,
  type CompanyDoc,
  type ContactCampaignStats,
  type ContactDetail,
  type ContactDoc,
  type ContactHistoryEvent,
  type ContactListMembership,
  type ContactProfile,
  type ListDoc,
  type ListMembershipDoc,
} from "@/lib/crm";
import { getProjectBranding } from "@/lib/project-branding";
import {
  purgeCampaignEngagementForEmails,
  type CampaignBlastDoc,
  type CampaignSendDoc,
} from "@/lib/campaign-blasts-server";
import { purgeKanbanContactsForEmails } from "@/lib/analytics-kanban-server";
import {
  OPEN_PIXEL_BLOCKED_TAG,
  sendCountsAsOpen,
  sendOpenPixelBlocked,
} from "@/lib/open-pixel";
import { BOT_OPEN_TAG, sendIsBotOpen } from "@/lib/bot-open";
import { BOT_CLICK_TAG, clickEventIsBot } from "@/lib/bot-click";
import { countDistinctCompaniesForList } from "@/lib/crm-list-stats";

export async function getProjectContacts(projectId: ObjectId) {
  const db = await getDb();
  return db
    .collection<ContactDoc>("contacts")
    .find({ projectId })
    .sort({ lastName: 1, firstName: 1, email: 1 })
    .toArray();
}

export type ListProjectContactsOptions = {
  page?: number;
  pageSize?: number;
  q?: string;
  searchField?: "all" | "name" | "email";
  createdAfter?: Date | string | null;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let contactIndexesPromise: Promise<void> | null = null;

function ensureContactSortIndex() {
  if (!contactIndexesPromise) {
    contactIndexesPromise = (async () => {
      const db = await getDb();
      await db.collection("contacts").createIndex(
        { projectId: 1, lastName: 1, firstName: 1, email: 1 },
        { name: "contacts_project_name_sort", background: true },
      );
    })().catch((error) => {
      console.error("Failed to ensure contact indexes:", error);
    });
  }
  return contactIndexesPromise;
}

export async function listProjectContacts(
  projectId: ObjectId,
  options?: ListProjectContactsOptions,
) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(options?.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const q = String(options?.q ?? "").trim();
  const searchField = options?.searchField ?? "all";
  const createdAfterRaw = options?.createdAfter;
  const createdAfter =
    createdAfterRaw instanceof Date
      ? createdAfterRaw
      : createdAfterRaw
        ? new Date(createdAfterRaw)
        : null;

  const filter: Record<string, unknown> = { projectId };
  if (createdAfter && !Number.isNaN(createdAfter.getTime())) {
    filter.createdAt = { $gte: createdAfter };
  }

  if (q) {
    const regex = { $regex: escapeRegex(q), $options: "i" };
    if (searchField === "email") {
      filter.email = regex;
    } else if (searchField === "name") {
      filter.$or = [{ firstName: regex }, { lastName: regex }];
    } else {
      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { companyName: regex },
      ];
    }
  }

  void ensureContactSortIndex();
  const db = await getDb();
  const collection = db.collection<ContactDoc>("contacts");
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .sort({ lastName: 1, firstName: 1, email: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

  return {
    items: docs.map(mapContact),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function listMembershipContactIds(
  projectId: ObjectId,
  listId: ObjectId,
) {
  const db = await getDb();
  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, listId })
    .project({ contactId: 1 })
    .toArray();
  return memberships.map((item) => item.contactId);
}

function listContactsFilter(
  projectId: ObjectId,
  contactIds: ObjectId[],
  q: string,
) {
  const filter: Record<string, unknown> = {
    projectId,
    _id: { $in: contactIds },
  };

  if (q) {
    const regex = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { companyName: regex },
    ];
  }

  return filter;
}

/** All contact ids in a list (optional search). For select-all bulk actions. */
export async function listProjectListContactIds(
  projectId: ObjectId,
  listId: ObjectId,
  options?: { q?: string },
) {
  const q = String(options?.q ?? "").trim();
  const contactIds = await listMembershipContactIds(projectId, listId);
  if (contactIds.length === 0) {
    return { ids: [] as string[], total: 0 };
  }

  const db = await getDb();
  const filter = listContactsFilter(projectId, contactIds, q);
  const docs = await db
    .collection<ContactDoc>("contacts")
    .find(filter)
    .project({ _id: 1 })
    .toArray();

  return {
    ids: docs.map((doc) => String(doc._id)),
    total: docs.length,
  };
}

export async function listProjectListContacts(
  projectId: ObjectId,
  listId: ObjectId,
  options?: { page?: number; pageSize?: number; q?: string },
) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(options?.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const q = String(options?.q ?? "").trim();

  const contactIds = await listMembershipContactIds(projectId, listId);
  if (contactIds.length === 0) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 1,
    };
  }

  const filter = listContactsFilter(projectId, contactIds, q);
  const collection = (await getDb()).collection<ContactDoc>("contacts");
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .sort({ lastName: 1, firstName: 1, email: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

  return {
    items: docs.map(mapContact),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}


export async function getProjectContactDetail(
  projectId: ObjectId,
  contactId: ObjectId,
  owner: string,
): Promise<ContactDetail | null> {
  const db = await getDb();
  const doc = await db
    .collection<ContactDoc>("contacts")
    .findOne({ _id: contactId, projectId });

  if (!doc) {
    return null;
  }

  const navigation = await getContactNavigation(projectId, doc);

  const contact = mapContact(doc);

  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, contactId })
    .sort({ addedAt: -1 })
    .toArray();

  const listIds = memberships.map((entry) => entry.listId);
  const lists =
    listIds.length === 0
      ? []
      : await db
          .collection<ListDoc>("lists")
          .find({ _id: { $in: listIds } })
          .toArray();

  const listMap = new Map(lists.map((list) => [list._id.toString(), list]));

  const contactLists: ContactListMembership[] = memberships.flatMap((membership) => {
    const list = listMap.get(membership.listId.toString());
    if (!list) {
      return [];
    }

    const entry: ContactListMembership = {
      id: list._id.toString(),
      name: list.name,
      displayId: list.displayId,
      addedAt: membership.addedAt.toISOString(),
      createdAt: list.createdAt.toISOString(),
      source: membership.source,
    };

    if (list.importFileName) {
      entry.importFileName = list.importFileName;
    }

    return [entry];
  });

  let company: ContactDetail["company"] = null;
  if (doc.companyId) {
    const companyDoc = await db.collection<CompanyDoc>("companies").findOne({
      _id: doc.companyId,
      projectId,
    });

    if (companyDoc) {
      company = {
        id: companyDoc._id.toString(),
        name: companyDoc.name,
        contactCount: companyDoc.contactCount,
      };
    }
  }

  const { events: campaignEvents, stats: campaignStats } =
    await getContactCampaignActivity(projectId, contact.email);

  const history = buildContactHistory({
    contact,
    lists: contactLists,
    company,
    owner,
    campaignEvents,
  });

  return {
    ...contact,
    owner,
    company,
    lists: contactLists,
    history,
    campaignStats,
    profile: mapContactProfile(doc.profile),
    navigation,
  };
}

export type ContactPatchInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  companyName?: string;
  attributes?: Record<string, string>;
  subscribed?: boolean;
  blocklisted?: boolean;
  profile?: ContactProfile;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function updateProjectContact(
  projectId: ObjectId,
  contactId: ObjectId,
  owner: string,
  patch: ContactPatchInput,
): Promise<ContactDetail | null> {
  const db = await getDb();
  const existing = await db
    .collection<ContactDoc>("contacts")
    .findOne({ _id: contactId, projectId });
  if (!existing) {
    return null;
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof patch.firstName === "string") {
    $set.firstName = patch.firstName.trim();
  }
  if (typeof patch.lastName === "string") {
    $set.lastName = patch.lastName.trim();
  }
  if (typeof patch.email === "string") {
    const email = normalizeEmail(patch.email);
    if (!email) {
      throw new Error("Email is required.");
    }
    if (email !== existing.email) {
      const clash = await db.collection<ContactDoc>("contacts").findOne({
        projectId,
        email,
        _id: { $ne: contactId },
      });
      if (clash) {
        throw new Error("Another contact already uses that email.");
      }
    }
    $set.email = email;
  }
  if (typeof patch.companyName === "string") {
    $set.companyName = patch.companyName.trim();
  }
  if (patch.attributes && typeof patch.attributes === "object") {
    $set.attributes = Object.fromEntries(
      Object.entries(patch.attributes).map(([key, value]) => [
        key,
        String(value ?? "").trim(),
      ]),
    );
  }
  if (typeof patch.subscribed === "boolean") {
    $set.subscribed = patch.subscribed;
  }
  if (typeof patch.blocklisted === "boolean") {
    $set.blocklisted = patch.blocklisted;
  }
  if (patch.profile && typeof patch.profile === "object") {
    $set.profile = patch.profile;
  }

  await db.collection<ContactDoc>("contacts").updateOne(
    { _id: contactId, projectId },
    { $set },
  );

  return getProjectContactDetail(projectId, contactId, owner);
}

export async function enrichContactWithApollo(
  projectId: ObjectId,
  contactId: ObjectId,
  owner: string,
): Promise<
  | { ok: true; contact: ContactDetail }
  | { ok: false; status: number; error: string }
> {
  const db = await getDb();
  const existing = await db
    .collection<ContactDoc>("contacts")
    .findOne({ _id: contactId, projectId });
  if (!existing) {
    return { ok: false, status: 404, error: "Contact not found" };
  }

  if (existing.profile?.apollo?.enrichedAt) {
    return {
      ok: false,
      status: 409,
      error: "Already enriched with Apollo for this contact.",
    };
  }

  const match = await matchPersonByEmail(existing.email);
  if (!match.person) {
    return {
      ok: false,
      status: 404,
      error: "Apollo did not find a match for this email.",
    };
  }

  const profile = profileFromApolloPerson(
    match.person,
    mapContactProfile(existing.profile),
  );
  profile.apollo = {
    ...profile.apollo,
    personId: match.person.id || profile.apollo?.personId,
    enrichedAt: new Date().toISOString(),
    raw: match.raw,
  };

  const $set: Record<string, unknown> = {
    profile,
    updatedAt: new Date(),
  };

  if (!existing.firstName?.trim() && match.person.first_name) {
    $set.firstName = String(match.person.first_name).trim();
  }
  if (!existing.lastName?.trim() && match.person.last_name) {
    $set.lastName = String(match.person.last_name).trim();
  }
  if (
    !existing.companyName?.trim() &&
    match.person.organization?.name
  ) {
    $set.companyName = String(match.person.organization.name).trim();
  }

  await db.collection<ContactDoc>("contacts").updateOne(
    { _id: contactId, projectId },
    { $set },
  );

  const contact = await getProjectContactDetail(projectId, contactId, owner);
  if (!contact) {
    return { ok: false, status: 404, error: "Contact not found" };
  }
  return { ok: true, contact };
}

export async function ensureContactShareToken(
  projectId: ObjectId,
  contactId: ObjectId,
) {
  const db = await getDb();
  const existing = await db.collection<ContactDoc>("contacts").findOne({
    _id: contactId,
    projectId,
  });
  if (!existing) {
    return null;
  }
  if (existing.shareToken) {
    return existing.shareToken;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareToken = randomBytes(18).toString("base64url");
    const taken = await db.collection<ContactDoc>("contacts").findOne(
      { shareToken },
      { projection: { _id: 1 } },
    );
    if (taken) {
      continue;
    }

    const result = await db.collection<ContactDoc>("contacts").updateOne(
      { _id: existing._id, shareToken: { $exists: false } },
      { $set: { shareToken, updatedAt: new Date() } },
    );
    if (result.modifiedCount > 0 || result.matchedCount === 0) {
      const fresh = await db.collection<ContactDoc>("contacts").findOne({
        _id: existing._id,
      });
      return fresh?.shareToken ?? shareToken;
    }
  }

  throw new Error("Could not create a share link");
}

function toPublicContactDetail(contact: ContactDetail): ContactDetail {
  const profile = mapContactProfile(contact.profile);
  // Resolve photo before stripping apollo.raw (public payload omits raw).
  const photoUrl = resolveContactPhotoUrl(profile);
  if (photoUrl) {
    profile.photoUrl = photoUrl;
  }
  if (profile.apollo) {
    profile.apollo = {
      personId: profile.apollo.personId,
      enrichedAt: profile.apollo.enrichedAt,
    };
  }
  return {
    ...contact,
    profile,
    navigation: {
      index: 0,
      total: 1,
      prevId: null,
      nextId: null,
    },
  };
}

export async function getPublicContactByShareToken(shareToken: string): Promise<{
  contact: ContactDetail;
  projectId: ObjectId;
} | null> {
  const token = shareToken.trim();
  if (!token) return null;

  const db = await getDb();
  const doc = await db.collection<ContactDoc>("contacts").findOne({
    shareToken: token,
  });
  if (!doc) return null;

  const branding = await getProjectBranding(doc.projectId);
  const owner = branding.name || "Report owner";
  const detail = await getProjectContactDetail(
    doc.projectId,
    doc._id,
    owner,
  );
  if (!detail) return null;

  const contact = toPublicContactDetail(detail);
  // Serve avatar through our proxy so LinkedIn/Apollo CDNs load on public pages.
  // Bust caches when the contact is updated so portal edits show on the public URL.
  if (contact.profile?.photoUrl) {
    const version = encodeURIComponent(contact.updatedAt || String(Date.now()));
    contact.profile = {
      ...contact.profile,
      photoUrl: `/api/public/leads/${encodeURIComponent(token)}/photo?v=${version}`,
    };
  }

  return {
    contact,
    projectId: doc.projectId,
  };
}

export async function getPublicContactPhotoByToken(shareToken: string): Promise<{
  buffer: ArrayBuffer;
  contentType: string;
} | null> {
  const token = shareToken.trim();
  if (!token) return null;

  const db = await getDb();
  const doc = await db.collection<ContactDoc>("contacts").findOne(
    { shareToken: token },
    { projection: { profile: 1 } },
  );
  if (!doc) return null;

  const photoUrl = resolveContactPhotoUrl(mapContactProfile(doc.profile));
  if (!photoUrl || !/^https?:\/\//i.test(photoUrl)) return null;

  const response = await fetch(photoUrl, {
    headers: {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "NexusesLeadReport/1.0",
      Referer: "",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) return null;

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) return null;

  return { buffer, contentType };
}

const CONTACT_SORT_FIELDS = ["lastName", "firstName", "email"] as const;

// Mongo sorts missing/null before strings, so a null value has nothing "less" than it.
function compareField(field: string, value: unknown, direction: "lt" | "gt") {
  if (typeof value !== "string") {
    return direction === "lt" ? { _id: { $exists: false } } : { [field]: { $type: "string" } };
  }
  return direction === "lt"
    ? { $or: [{ [field]: { $lt: value } }, { [field]: null }] }
    : { [field]: { $gt: value } };
}

function equalField(field: string, value: unknown) {
  return { [field]: typeof value === "string" ? value : null };
}

function sortPositionFilter(doc: ContactDoc, direction: "lt" | "gt") {
  const record = doc as unknown as Record<string, unknown>;
  return {
    $or: CONTACT_SORT_FIELDS.map((field, position) => ({
      $and: [
        ...CONTACT_SORT_FIELDS.slice(0, position).map((prior) =>
          equalField(prior, record[prior]),
        ),
        compareField(field, record[field], direction),
      ],
    })),
  };
}

async function getContactNavigation(projectId: ObjectId, doc: ContactDoc) {
  await ensureContactSortIndex();
  const contacts = (await getDb()).collection<ContactDoc>("contacts");
  const before = { projectId, ...sortPositionFilter(doc, "lt") };
  const after = { projectId, ...sortPositionFilter(doc, "gt") };
  const projection = { _id: 1 } as const;

  const [index, total, prev, next] = await Promise.all([
    contacts.countDocuments(before),
    contacts.countDocuments({ projectId }),
    contacts
      .find(before, { projection })
      .sort({ lastName: -1, firstName: -1, email: -1 })
      .limit(1)
      .next(),
    contacts
      .find(after, { projection })
      .sort({ lastName: 1, firstName: 1, email: 1 })
      .limit(1)
      .next(),
  ]);

  return {
    index,
    total,
    prevId: prev?._id.toString() ?? null,
    nextId: next?._id.toString() ?? null,
  };
}

function toIso(value: Date | string | undefined) {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function getContactCampaignActivity(projectId: ObjectId, email: string) {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const emptyStats: ContactCampaignStats = {
    sent: 0,
    delivered: 0,
    opens: 0,
    clicks: 0,
    replies: 0,
  };

  if (!normalized) {
    return { events: [] as ContactHistoryEvent[], stats: emptyStats };
  }

  const sends = await db
    .collection<CampaignSendDoc>("campaign_sends")
    .find({
      projectId,
      email: normalized,
    })
    .toArray();

  if (sends.length === 0) {
    return { events: [] as ContactHistoryEvent[], stats: emptyStats };
  }

  const blastIds = [
    ...new Set(sends.map((send) => send.blastId.toString()).filter(Boolean)),
  ];
  const blasts = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({
      _id: { $in: blastIds.map((id) => new ObjectId(id)) },
    })
    .toArray();
  const blastMap = new Map(blasts.map((blast) => [blast._id.toString(), blast]));

  const events: ContactHistoryEvent[] = [];
  const stats: ContactCampaignStats = { ...emptyStats };

  for (const send of sends) {
    const blast = blastMap.get(send.blastId.toString());
    const campaignName = blast?.name || `Campaign #${send.campaignId}`;
    const actor = blast?.senderName || blast?.senderEmail || "Email campaign";
    const label = `[${send.campaignId}] ${campaignName}`;
    const campaignKind = blast?.kind === "oneone" ? "oneone" : "drip";
    const emailSubject =
      send.subjectLine?.trim() || blast?.subject?.trim() || "";
    const emailPreview = blast?.previewText?.trim() || "";
    const sendId = send._id.toString();
    const emailMeta = {
      sendId,
      ...(emailSubject ? { emailSubject } : {}),
      ...(emailPreview ? { emailPreview } : {}),
    };

    if (send.status === "sent" || send.status === "failed") {
      stats.sent += 1;
      events.push({
        id: `campaign-sent-${sendId}`,
        type: "campaign_sent",
        title: "Email campaign sent",
        description: `Campaign ${label} was sent to this contact.`,
        at: toIso(send.sentAt),
        actor,
        campaignId: send.campaignId,
        campaignKind,
        campaignName,
        ...emailMeta,
      });
    }

    // Count delivery for stats only — do not emit a separate history row.
    // Delivered currently uses the same timestamp as sent, which duplicated
    // every send and pushed real opens/clicks out of the Recent history card.
    if (send.status === "sent") {
      stats.delivered += 1;
    }

    if (sendCountsAsOpen(send)) {
      stats.opens += 1;
      const firstOpenEvent = send.openEvents?.[0];
      const pixelBlocked = sendOpenPixelBlocked(send);
      const botOpen = sendIsBotOpen(send);
      const openTags = [
        ...(botOpen ? [BOT_OPEN_TAG] : []),
        ...(pixelBlocked ? [OPEN_PIXEL_BLOCKED_TAG] : []),
      ];
      const openIp =
        firstOpenEvent?.ip || send.openedIp || send.clickedIp;
      const openDevice =
        firstOpenEvent?.device || send.openedDevice || send.clickedDevice;
      const openUa =
        firstOpenEvent?.userAgent || send.openedUserAgent || send.clickedUserAgent;
      const openTitle = botOpen
        ? pixelBlocked
          ? "Email campaign opened (bot · not tracked)"
          : "Email campaign opened (bot)"
        : pixelBlocked
          ? "Email campaign opened (not tracked)"
          : "Email campaign opened";
      events.push({
        id: `campaign-opened-${sendId}`,
        type: "campaign_opened",
        title: openTitle,
        description:
          openTags.length > 0
            ? `Opened campaign ${label} (${openTags.join(" · ")}).`
            : `Opened campaign ${label}.`,
        at: toIso(send.openedAt || firstOpenEvent?.at || send.clickedAt),
        actor,
        campaignId: send.campaignId,
        campaignKind,
        campaignName,
        ...emailMeta,
        ...(openTags.length > 0 ? { openTag: openTags.join(" · ") } : {}),
        ...(openIp ? { ip: openIp } : {}),
        ...(openDevice ? { device: openDevice } : {}),
        ...(openUa ? { userAgent: openUa } : {}),
      });
    }

    const clickEvents =
      send.clickEvents && send.clickEvents.length > 0
        ? send.clickEvents.filter((click) => !click.ignored)
        : send.clickedAt
          ? [
              {
                url: send.clickedUrl || "",
                at: send.clickedAt,
                ip: send.clickedIp,
                device: send.clickedDevice,
                userAgent: send.clickedUserAgent,
              },
            ]
          : [];

    if (clickEvents.length > 0 || send.clickCount > 0) {
      stats.clicks += 1;
    }

    for (const [index, click] of clickEvents.entries()) {
      const url = click.url?.trim();
      const botClick = clickEventIsBot(send, click);
      events.push({
        id: `campaign-clicked-${sendId}-${index}`,
        type: "campaign_clicked",
        title: botClick
          ? "Email campaign link clicked (bot)"
          : "Email campaign link clicked",
        description: url
          ? botClick
            ? `Clicked ${url} in campaign ${label} (${BOT_CLICK_TAG}).`
            : `Clicked ${url} in campaign ${label}.`
          : botClick
            ? `Clicked a link in campaign ${label} (${BOT_CLICK_TAG}).`
            : `Clicked a link in campaign ${label}.`,
        at: toIso(click.at),
        actor,
        campaignId: send.campaignId,
        campaignKind,
        campaignName,
        ...emailMeta,
        clickedUrl: url,
        ...(botClick ? { clickTag: BOT_CLICK_TAG } : {}),
        ...(click.ip ? { ip: click.ip } : {}),
        ...(click.device ? { device: click.device } : {}),
        ...(click.userAgent ? { userAgent: click.userAgent } : {}),
      });
    }

    if (send.repliedAt) {
      stats.replies += 1;
    }

    if (send.unsubscribedAt) {
      events.push({
        id: `campaign-unsubscribed-${sendId}`,
        type: "campaign_unsubscribed",
        title: "Unsubscribed from email campaigns",
        description: `Unsubscribed from campaign ${label}.`,
        at: toIso(send.unsubscribedAt),
        actor,
        campaignId: send.campaignId,
        campaignKind,
        campaignName,
        ...emailMeta,
      });
    }
  }

  return { events, stats };
}

/** Remove contacts from one list without deleting the CRM contact records. */
export async function removeContactsFromList(
  projectId: ObjectId,
  listId: ObjectId,
  ids: string[],
) {
  const contactIds = [...new Set(ids)]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (contactIds.length === 0) {
    return { removed: 0 };
  }

  const db = await getDb();
  const list = await db.collection<ListDoc>("lists").findOne({
    _id: listId,
    projectId,
  });
  if (!list) {
    throw new Error("List not found");
  }

  const result = await db.collection<ListMembershipDoc>("list_memberships").deleteMany({
    projectId,
    listId,
    contactId: { $in: contactIds },
  });

  const [remaining, companyCount] = await Promise.all([
    db.collection<ListMembershipDoc>("list_memberships").countDocuments({
      projectId,
      listId,
    }),
    countDistinctCompaniesForList(projectId, listId),
  ]);
  await db.collection<ListDoc>("lists").updateOne(
    { _id: listId, projectId },
    {
      $set: {
        contactCount: remaining,
        companyCount,
        updatedAt: new Date(),
      },
    },
  );

  return { removed: result.deletedCount ?? 0 };
}

export async function deleteContacts(projectId: ObjectId, ids: string[]) {
  const contactIds = [...new Set(ids)]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (contactIds.length === 0) {
    return { deleted: 0 };
  }

  const db = await getDb();
  const contacts = await db
    .collection<ContactDoc>("contacts")
    .find({ projectId, _id: { $in: contactIds } })
    .project({ _id: 1, companyId: 1, email: 1 })
    .toArray();
  if (contacts.length === 0) {
    return { deleted: 0 };
  }

  const allowedIds = contacts.map((contact) => contact._id);
  const emails = contacts
    .map((contact) => contact.email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
  const companyIds = [
    ...new Map(
      contacts
        .filter((contact) => contact.companyId)
        .map((contact) => [contact.companyId!.toString(), contact.companyId!]),
    ).values(),
  ];

  const memberships = await db
    .collection<ListMembershipDoc>("list_memberships")
    .find({ projectId, contactId: { $in: allowedIds } })
    .project({ listId: 1 })
    .toArray();
  const listIds = [
    ...new Map(
      memberships.map((membership) => [
        membership.listId.toString(),
        membership.listId,
      ]),
    ).values(),
  ];

  await db.collection<ListMembershipDoc>("list_memberships").deleteMany({
    projectId,
    contactId: { $in: allowedIds },
  });

  // Drop engagement rows so campaign reports / activity no longer list them.
  await purgeCampaignEngagementForEmails(projectId, emails);
  await purgeKanbanContactsForEmails(projectId, emails);

  const result = await db.collection<ContactDoc>("contacts").deleteMany({
    projectId,
    _id: { $in: allowedIds },
  });

  if (listIds.length > 0) {
    const listCounts = await db
      .collection<ListMembershipDoc>("list_memberships")
      .aggregate<{ _id: ObjectId; count: number }>([
        { $match: { projectId, listId: { $in: listIds } } },
        { $group: { _id: "$listId", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(
      listCounts.map((entry) => [entry._id.toString(), entry.count]),
    );
    await Promise.all(
      listIds.map(async (listId) => {
        const companyCount = await countDistinctCompaniesForList(
          projectId,
          listId,
        );
        return db.collection<ListDoc>("lists").updateOne(
          { _id: listId, projectId },
          {
            $set: {
              contactCount: countMap.get(listId.toString()) ?? 0,
              companyCount,
              updatedAt: new Date(),
            },
          },
        );
      }),
    );
  }

  if (companyIds.length > 0) {
    const companyCounts = await db
      .collection<ContactDoc>("contacts")
      .aggregate<{ _id: ObjectId; count: number }>([
        { $match: { projectId, companyId: { $in: companyIds } } },
        { $group: { _id: "$companyId", count: { $sum: 1 } } },
      ])
      .toArray();
    const companyCountMap = new Map(
      companyCounts.map((entry) => [entry._id.toString(), entry.count]),
    );
    await Promise.all(
      companyIds.map((companyId) =>
        db.collection<CompanyDoc>("companies").updateOne(
          { _id: companyId, projectId },
          {
            $set: {
              contactCount: companyCountMap.get(companyId.toString()) ?? 0,
              updatedAt: new Date(),
            },
          },
        ),
      ),
    );
  }

  return { deleted: result.deletedCount ?? 0 };
}
