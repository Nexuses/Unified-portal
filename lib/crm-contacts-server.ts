import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  buildContactHistory,
  mapContact,
  type CompanyDoc,
  type ContactCampaignStats,
  type ContactDetail,
  type ContactDoc,
  type ContactHistoryEvent,
  type ContactListMembership,
  type ListDoc,
  type ListMembershipDoc,
} from "@/lib/crm";
import type {
  CampaignBlastDoc,
  CampaignSendDoc,
} from "@/lib/campaign-blasts-server";

export async function getProjectContacts(projectId: ObjectId) {
  const db = await getDb();
  return db
    .collection<ContactDoc>("contacts")
    .find({ projectId })
    .sort({ lastName: 1, firstName: 1 })
    .toArray();
}

export async function getProjectContactDetail(
  projectId: ObjectId,
  contactId: ObjectId,
  owner: string,
): Promise<ContactDetail | null> {
  const db = await getDb();
  const contacts = await getProjectContacts(projectId);
  const index = contacts.findIndex((entry) => entry._id.equals(contactId));
  const doc = index >= 0 ? contacts[index] : null;

  if (!doc) {
    return null;
  }

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
    navigation: {
      index,
      total: contacts.length,
      prevId: index > 0 ? contacts[index - 1]?._id.toString() ?? null : null,
      nextId:
        index >= 0 && index < contacts.length - 1
          ? contacts[index + 1]?._id.toString() ?? null
          : null,
    },
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

  const campaignIds = [...new Set(sends.map((send) => send.campaignId))];
  const blasts = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .find({
      projectId,
      campaignId: { $in: campaignIds },
    })
    .toArray();
  const blastMap = new Map(blasts.map((blast) => [blast.campaignId, blast]));

  const events: ContactHistoryEvent[] = [];
  const stats: ContactCampaignStats = { ...emptyStats };

  for (const send of sends) {
    const blast = blastMap.get(send.campaignId);
    const campaignName = blast?.name || `Campaign #${send.campaignId}`;
    const actor = blast?.senderName || blast?.senderEmail || "Email campaign";
    const label = `[${send.campaignId}] ${campaignName}`;

    if (send.status === "sent" || send.status === "failed") {
      stats.sent += 1;
      events.push({
        id: `campaign-sent-${send._id.toString()}`,
        type: "campaign_sent",
        title: "Email campaign sent",
        description: `Campaign ${label} was sent to this contact.`,
        at: toIso(send.sentAt),
        actor,
        campaignId: send.campaignId,
        campaignName,
      });
    }

    if (send.status === "sent") {
      stats.delivered += 1;
      events.push({
        id: `campaign-delivered-${send._id.toString()}`,
        type: "campaign_delivered",
        title: "Email campaign delivered",
        description: `Campaign ${label} was delivered.`,
        at: toIso(send.sentAt),
        actor,
        campaignId: send.campaignId,
        campaignName,
      });
    }

    if (send.openedAt || send.openCount > 0) {
      stats.opens += 1;
      events.push({
        id: `campaign-opened-${send._id.toString()}`,
        type: "campaign_opened",
        title: "Email campaign opened",
        description: `Opened campaign ${label}.`,
        at: toIso(send.openedAt),
        actor,
        campaignId: send.campaignId,
        campaignName,
      });
    }

    const clickEvents =
      send.clickEvents && send.clickEvents.length > 0
        ? send.clickEvents
        : send.clickedAt
          ? [{ url: send.clickedUrl || "", at: send.clickedAt }]
          : [];

    if (clickEvents.length > 0 || send.clickCount > 0) {
      stats.clicks += 1;
    }

    for (const [index, click] of clickEvents.entries()) {
      const url = click.url?.trim();
      events.push({
        id: `campaign-clicked-${send._id.toString()}-${index}`,
        type: "campaign_clicked",
        title: "Email campaign link clicked",
        description: url
          ? `Clicked ${url} in campaign ${label}.`
          : `Clicked a link in campaign ${label}.`,
        at: toIso(click.at),
        actor,
        campaignId: send.campaignId,
        campaignName,
        clickedUrl: url,
      });
    }

    if (send.unsubscribedAt) {
      events.push({
        id: `campaign-unsubscribed-${send._id.toString()}`,
        type: "campaign_unsubscribed",
        title: "Unsubscribed from email campaigns",
        description: `Unsubscribed from campaign ${label}.`,
        at: toIso(send.unsubscribedAt),
        actor,
        campaignId: send.campaignId,
        campaignName,
      });
    }
  }

  return { events, stats };
}
