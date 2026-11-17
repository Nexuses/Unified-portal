import { ObjectId } from "mongodb";
import type { ContactDoc, ContactProfileTimelineItem, ListMembershipDoc } from "@/lib/crm";
import { normalizeCompanyKey } from "@/lib/crm";
import { countDistinctCompaniesForList } from "@/lib/crm-list-stats";
import { createList, ensureCompanies, refreshCompanyCounts } from "@/lib/crm-import";
import { invalidateProjectListSavedCache } from "@/lib/datatool-server";
import { getDb } from "@/lib/mongodb";
import type { LinkedinPerson } from "@/lib/linkedin-campaigns";

export type LinkedinCrmPerson = LinkedinPerson & { crmContactId?: string };

type ActivityPerson = {
  id?: string;
  name: string;
  messages: string[];
  stage?: string;
  alreadyConnected?: boolean;
  messagesSent?: number;
  connectionRequested?: boolean;
  likedRecentPost?: boolean;
  crmContactId?: string;
};

function identityKey(firstName: string, lastName: string, companyName: string) {
  const first = firstName.trim().replace(/\s+/g, " ").toLowerCase();
  const last = lastName.trim().replace(/\s+/g, " ").toLowerCase();
  const company = companyName.trim().replace(/\s+/g, " ").toLowerCase();
  if (!first || !last || !company) return "";
  return `${first}|${last}|${company}`;
}

function prefers(candidate: ContactDoc, current: ContactDoc) {
  const candidateMail = candidate.email.includes("@") ? 0 : 1;
  const currentMail = current.email.includes("@") ? 0 : 1;
  if (candidateMail !== currentMail) return candidateMail < currentMail;
  return candidate.createdAt.getTime() < current.createdAt.getTime();
}

/** Reuse a CRM contact when first name, last name, and company already match. */
export async function saveLinkedinCampaignList(input: {
  projectId: ObjectId;
  userId: ObjectId | null;
  listName: string;
  fileName?: string;
  people: LinkedinPerson[];
}) {
  const name = input.listName.trim().slice(0, 120);
  if (!name) throw new Error("Name the list.");
  if (name.toLowerCase() === "unsubscribe") throw new Error("That list name is reserved.");

  const db = await getDb();
  const duplicate = await db.collection("lists").findOne({
    projectId: input.projectId,
    name,
  });
  if (duplicate) throw new Error("A list with that name already exists.");

  const keys = [
    ...new Set(
      input.people
        .map((person) => identityKey(person.firstName, person.lastName, person.companyName))
        .filter(Boolean),
    ),
  ];
  const existing = new Map<string, ContactDoc>();
  if (keys.length) {
    const contacts = await db
      .collection<ContactDoc>("contacts")
      .aggregate<ContactDoc & { identity: string }>([
        { $match: { projectId: input.projectId } },
        {
          $addFields: {
            identity: {
              $concat: [
                { $toLower: { $trim: { input: { $ifNull: ["$firstName", ""] } } } },
                "|",
                { $toLower: { $trim: { input: { $ifNull: ["$lastName", ""] } } } },
                "|",
                { $toLower: { $trim: { input: { $ifNull: ["$companyName", ""] } } } },
              ],
            },
          },
        },
        { $match: { identity: { $in: keys } } },
      ])
      .toArray();
    for (const contact of contacts) {
      const key = contact.identity;
      const current = existing.get(key);
      if (!current || prefers(contact, current)) existing.set(key, contact);
    }
  }

  const { byKey: companyByKey } = await ensureCompanies(
    input.projectId,
    input.people.map((person) => person.companyName),
  );
  const list = await createList(input.projectId, name, input.userId, input.fileName);
  const now = new Date();
  const linked: LinkedinCrmPerson[] = [];
  const contactIds: ObjectId[] = [];
  const affectedCompanies = new Set<string>();
  const inserts: ContactDoc[] = [];

  for (const person of input.people) {
    const key = identityKey(person.firstName, person.lastName, person.companyName);
    const match = key ? existing.get(key) : undefined;
    if (match) {
      if (!match.blocklisted && match.subscribed !== false) {
        contactIds.push(match._id);
        linked.push({ ...person, crmContactId: match._id.toString() });
        if (person.linkedinUrl) {
          await db.collection<ContactDoc>("contacts").updateOne(
            { _id: match._id, projectId: input.projectId },
            {
              $set: {
                "profile.linkedinUrl": person.linkedinUrl,
                "attributes.personalLinkedIn": person.linkedinUrl,
                updatedAt: now,
              },
            },
          );
        }
      } else {
        linked.push(person);
      }
      continue;
    }

    const companyId = person.companyName
      ? companyByKey.get(normalizeCompanyKey(person.companyName)) ?? null
      : null;
    if (companyId) affectedCompanies.add(companyId.toString());
    const contactId = new ObjectId();
    const created: ContactDoc = {
      _id: contactId,
      projectId: input.projectId,
      firstName: person.firstName || person.name,
      lastName: person.lastName,
      email: "",
      companyId,
      companyName: person.companyName,
      attributes: person.linkedinUrl ? { personalLinkedIn: person.linkedinUrl } : {},
      profile: {
        ...(person.linkedinUrl ? { linkedinUrl: person.linkedinUrl } : {}),
        source: "LinkedIn",
      },
      subscribed: true,
      blocklisted: false,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    };
    inserts.push(created);
    if (key) existing.set(key, created);
    contactIds.push(contactId);
    linked.push({ ...person, crmContactId: contactId.toString() });
  }

  if (inserts.length) {
    await db.collection<ContactDoc>("contacts").insertMany(inserts, { ordered: false });
  }

  const uniqueContactIds = [...new Map(contactIds.map((id) => [id.toString(), id])).values()];
  const memberships: ListMembershipDoc[] = uniqueContactIds.map((contactId) => ({
    _id: new ObjectId(),
    projectId: input.projectId,
    listId: list._id,
    contactId,
    addedAt: now,
    addedBy: input.userId,
    source: "import",
  }));
  if (memberships.length) {
    await db.collection<ListMembershipDoc>("list_memberships").insertMany(memberships, {
      ordered: false,
    });
  }

  const companyCount = await countDistinctCompaniesForList(input.projectId, list._id);
  await db.collection("lists").updateOne(
    { _id: list._id },
    { $set: { contactCount: memberships.length, companyCount, updatedAt: now } },
  );
  await refreshCompanyCounts(
    input.projectId,
    [...affectedCompanies].map((id) => new ObjectId(id)),
  );
  invalidateProjectListSavedCache(input.projectId);

  return { listId: list._id.toString(), listName: list.name, people: linked };
}

export function linkedinTimelineChanges(input: {
  campaignId: string;
  campaignName: string;
  personId: string;
  previous: ActivityPerson;
  next: ActivityPerson;
  at: Date;
}): ContactProfileTimelineItem[] {
  if (!input.next.crmContactId) return [];
  const stamp = input.at.toISOString();
  const base = `li-${input.campaignId}-${input.personId}`;
  const campaign = input.campaignName;
  const events: ContactProfileTimelineItem[] = [];
  const sentBefore = input.previous.messagesSent || 0;
  const sentAfter = input.next.messagesSent || 0;

  if (
    !input.previous.connectionRequested &&
    input.next.connectionRequested &&
    input.next.stage === "request_sent" &&
    sentBefore === 0
  ) {
    events.push({
      id: `${base}-request`,
      at: stamp,
      kind: "linkedin",
      body: `Connection request sent in ${campaign}.`,
    });
  }

  const nextStage = input.next.stage || "";
  const previousStage = input.previous.stage || "";
  const becameConnected =
    !input.previous.alreadyConnected &&
    previousStage !== "connected" &&
    !previousStage.startsWith("message_") &&
    (input.next.alreadyConnected || nextStage === "connected" || nextStage.startsWith("message_"));
  if (becameConnected) {
    events.push({
      id: `${base}-accepted`,
      at: stamp,
      kind: "linkedin",
      body: input.previous.connectionRequested
        ? `Accepted the connection request in ${campaign}.`
        : `Connected on LinkedIn in ${campaign}.`,
    });
  }

  for (let number = sentBefore + 1; number <= sentAfter; number += 1) {
    const text = (input.next.messages[number - 1] || "").trim();
    events.push({
      id: `${base}-message-${number}`,
      at: stamp,
      kind: "linkedin",
      body: text
        ? `Message ${number} sent in ${campaign}.\n\n${text}`
        : `Message ${number} sent in ${campaign}.`,
    });
  }

  if (!input.previous.likedRecentPost && input.next.likedRecentPost) {
    events.push({
      id: `${base}-like`,
      at: stamp,
      kind: "linkedin",
      body: `Liked their recent post in ${campaign}.`,
    });
  }

  if (input.previous.stage !== "reply" && input.next.stage === "reply") {
    events.push({
      id: `${base}-reply`,
      at: stamp,
      kind: "linkedin",
      body: `Replied on LinkedIn in ${campaign}.`,
    });
  }

  return events;
}

export async function appendLinkedinTimeline(
  projectId: ObjectId,
  contactId: string,
  events: ContactProfileTimelineItem[],
) {
  if (!events.length || !ObjectId.isValid(contactId)) return;
  const db = await getDb();
  const contact = await db.collection<ContactDoc>("contacts").findOne(
    { _id: new ObjectId(contactId), projectId },
    { projection: { "profile.timeline.id": 1 } },
  );
  if (!contact) return;
  const seen = new Set((contact.profile?.timeline || []).map((item) => item.id));
  const fresh = events.filter((event) => !seen.has(event.id));
  if (!fresh.length) return;
  await db.collection("contacts").updateOne({ _id: contact._id, projectId }, [
    {
      $set: {
        profile: { $ifNull: ["$profile", {}] },
        updatedAt: new Date(),
      },
    },
    {
      $set: {
        "profile.timeline": {
          $concatArrays: [
            fresh,
            {
              $cond: [{ $isArray: "$profile.timeline" }, "$profile.timeline", []],
            },
          ],
        },
      },
    },
  ]);
}

export async function recordLinkedinCampaignStart(input: {
  projectId: ObjectId;
  campaignId: string;
  campaignName: string;
  people: Array<{ id?: string; crmContactId?: string }>;
  at: Date;
}) {
  const stamp = input.at.toISOString();
  for (const person of input.people) {
    if (!person.crmContactId || !person.id) continue;
    await appendLinkedinTimeline(input.projectId, person.crmContactId, [
      {
        id: `li-${input.campaignId}-${person.id}-added`,
        at: stamp,
        kind: "linkedin",
        body: `Added to the LinkedIn campaign ${input.campaignName}.`,
      },
    ]);
  }
}
