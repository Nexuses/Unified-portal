import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import {
  assertProjectRecipientQuota,
  dispatchBlastNow,
  type BlastTimelineEvent,
  type CampaignBlastDoc,
  type CampaignSendDoc,
} from "@/lib/campaign-blasts-server";
import { importContactsToList, createList } from "@/lib/crm-import";
import type { ContactDoc } from "@/lib/crm";
import {
  createProjectDripCampaign,
  updateProjectDripCampaign,
} from "@/lib/drip-campaigns-server";
import {
  createEmptySequence,
  formatCampaignClock,
  type CampaignSequence,
} from "@/lib/drip-campaigns";
import { getDb } from "@/lib/mongodb";
import { formatSenderDisplayName } from "@/lib/mxtoolbox";
import {
  normalizePersonalisePlan,
  pitchToHtml,
  stepDelayDays,
  type PersonaliseContact,
  type PersonalisePlan,
} from "@/lib/personalise-types";
import { getSuppressionSets, isSuppressedAddress } from "@/lib/unsubscribe-server";

const LOCKED_SEQUENCE_AT = new Date("2099-01-01T00:00:00.000Z");

export type PersonaliseRolloutInput = {
  listName?: string;
  fileName?: string;
  contacts?: PersonaliseContact[];
  senderId?: string;
  windowStart?: string;
  windowEnd?: string;
  emailGapMinutes?: number;
  mode?: "now" | "later";
  scheduledFor?: string;
};

function clockOrThrow(value: string, label: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(`${label} must be a time like 09:00.`);
  }
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (hour > 23 || minute > 59) {
    throw new Error(`${label} is not a valid time.`);
  }
  return value;
}

function sequencesFromContacts(contacts: PersonaliseContact[]) {
  const max = Math.max(...contacts.map((contact) => contact.steps.length));
  const donor =
    contacts.find((contact) => contact.steps.length === max) ?? contacts[0];
  const delays = stepDelayDays(donor.steps);
  const sequences: CampaignSequence[] = [];
  for (let index = 0; index < max; index += 1) {
    const step = donor.steps[index];
    const base = createEmptySequence(index);
    sequences.push({
      ...base,
      delayDays: delays[index] ?? 0,
      subject: index === 0 ? step?.subject || "Hello" : step?.subject || "",
      hasDesign: true,
      designHtml: step ? pitchToHtml(step.body) : "<p></p>",
    });
  }
  return sequences;
}

export async function rolloutPersonaliseCampaign(input: {
  projectId: ObjectId;
  userId: ObjectId | null;
  body: PersonaliseRolloutInput;
}) {
  const rawEmails = (input.body.contacts ?? [])
    .map((contact) => contact.email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
  if (new Set(rawEmails).size !== rawEmails.length) {
    throw new Error("Two contacts share the same email.");
  }

  const plan: PersonalisePlan = normalizePersonalisePlan(
    {
      listName: input.body.listName,
      contacts: input.body.contacts,
    },
    input.body.fileName ?? "",
  );
  const missing = plan.contacts.filter((contact) => !contact.email);
  if (missing.length > 0) {
    const names = missing
      .slice(0, 5)
      .map((contact) => [contact.firstName, contact.lastName].filter(Boolean).join(" "))
      .join(", ");
    throw new Error(
      `Add an email for ${names}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""} before rollout.`,
    );
  }

  const senderId = String(input.body.senderId ?? "").trim();
  if (!ObjectId.isValid(senderId)) {
    throw new Error("Select a sender.");
  }
  const windowStart = clockOrThrow(String(input.body.windowStart ?? "09:00"), "Start time");
  const windowEnd = clockOrThrow(String(input.body.windowEnd ?? "18:00"), "End time");
  const emailGapMinutes = Math.max(
    0,
    Math.min(1440, Math.floor(Number(input.body.emailGapMinutes) || 0)),
  );
  const later = input.body.mode === "later";
  const scheduledFor = later && input.body.scheduledFor ? new Date(input.body.scheduledFor) : undefined;
  if (later && (!scheduledFor || Number.isNaN(scheduledFor.getTime()))) {
    throw new Error("Pick a valid schedule date and time.");
  }
  if (later && scheduledFor && scheduledFor.getTime() <= Date.now()) {
    throw new Error("Schedule time must be in the future.");
  }

  const db = await getDb();
  const sender = await db.collection("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId: input.projectId,
  });
  const provider = (sender as { provider?: string; fromEmail?: string } | null)?.provider;
  const fromEmail = (sender as { fromEmail?: string } | null)?.fromEmail?.trim() ?? "";
  if (!sender || !fromEmail) {
    throw new Error("Select a sender.");
  }
  if (provider !== "gmail" && provider !== "outlook") {
    throw new Error("Personalise campaigns use a Gmail or Outlook sender.");
  }

  await assertProjectRecipientQuota(input.projectId, plan.contacts.length);
  const suppressed = await getSuppressionSets(input.projectId);
  const skipped: string[] = [];
  const eligible = plan.contacts.filter((contact) => {
    if (isSuppressedAddress(contact.email, suppressed)) {
      skipped.push(contact.email);
      return false;
    }
    return true;
  });
  if (eligible.length === 0) {
    throw new Error("Every contact in this file is suppressed.");
  }

  const existing = await db
    .collection<ContactDoc>("contacts")
    .find({
      projectId: input.projectId,
      email: { $in: eligible.map((contact) => contact.email) },
    })
    .project({ email: 1, attributes: 1 })
    .toArray();
  const previousAttributes = new Map(
    existing.map((contact) => [contact.email.toLowerCase(), contact.attributes ?? {}]),
  );

  const list = await createList(
    input.projectId,
    plan.listName,
    input.userId,
    plan.fileName || undefined,
  );
  await importContactsToList(
    { projectId: input.projectId, listId: list._id, userId: input.userId },
    eligible.map((contact) => {
      const attributes: Record<string, string> = {
        ...(previousAttributes.get(contact.email) ?? {}),
      };
      if (contact.position) {
        attributes.position = contact.position;
      }
      if (contact.personalLinkedIn) {
        attributes.personalLinkedIn = contact.personalLinkedIn;
      }
      return {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        companyName: contact.companyName || "Unknown",
        attributes,
      };
    }),
  );

  const memberships = await db
    .collection("list_memberships")
    .find({ projectId: input.projectId, listId: list._id })
    .project({ contactId: 1 })
    .toArray();
  const memberIds = memberships.map((row) => row.contactId as ObjectId);
  const stored = memberIds.length
    ? await db
        .collection<ContactDoc>("contacts")
        .find({ _id: { $in: memberIds }, projectId: input.projectId })
        .project({ email: 1 })
        .toArray()
    : [];
  const enrolled = new Set(stored.map((contact) => contact.email.toLowerCase()));
  const ready = eligible.filter((contact) => enrolled.has(contact.email));
  for (const contact of eligible) {
    if (!enrolled.has(contact.email)) {
      skipped.push(contact.email);
    }
  }
  if (ready.length === 0) {
    throw new Error("No contacts could be added to the list.");
  }

  const sequences = sequencesFromContacts(ready);
  const campaign = await createProjectDripCampaign(
    input.projectId,
    input.userId,
    plan.listName,
    "oneone",
    { autoNumber: true },
  );

  const senderName =
    formatSenderDisplayName(fromEmail).match(/^(.+?)\s*</)?.[1]?.trim() || fromEmail;
  const now = new Date();
  const timeline: BlastTimelineEvent[] = [];
  if (scheduledFor) {
    timeline.push({
      id: randomBytes(6).toString("hex"),
      type: "scheduled",
      title: "Scheduled",
      description: `The campaign [${campaign.id}] ${campaign.name} has been scheduled for ${formatCampaignClock(scheduledFor, "Asia/Kolkata")}.`,
      at: now.toISOString(),
    });
  }
  timeline.push({
    id: randomBytes(6).toString("hex"),
    type: "draft",
    title: "Draft",
    description: `The campaign [${campaign.id}] ${campaign.name} has been launched from an uploaded file.`,
    at: now.toISOString(),
  });

  const blast: CampaignBlastDoc = {
    _id: new ObjectId(),
    projectId: input.projectId,
    campaignId: campaign.id,
    name: campaign.name,
    subject: sequences[0]?.subject || "Hello",
    html: sequences[0]?.designHtml || "<p></p>",
    senderId,
    senderName,
    senderEmail: fromEmail,
    listId: list._id.toString(),
    listName: list.name,
    listDisplayId: list.displayId,
    timezone: "Asia/Kolkata",
    status: scheduledFor ? "scheduled" : "sending",
    scheduledFor,
    recipients: ready.length,
    delivered: 0,
    opens: 0,
    clicks: 0,
    unsubscribed: 0,
    conversions: 0,
    bounces: 0,
    replies: 0,
    timeline,
    createdAt: now,
    updatedAt: now,
    kind: "oneone",
    sequences,
    windowStart,
    windowEnd,
    emailGapMinutes,
  };

  const sends: CampaignSendDoc[] = ready.flatMap((contact) => {
    const delays = stepDelayDays(contact.steps);
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    return contact.steps.map((step, sequenceIndex) => ({
      _id: new ObjectId(),
      projectId: input.projectId,
      blastId: blast._id,
      campaignId: campaign.id,
      email: contact.email,
      fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.companyName || "Unknown",
      token: randomBytes(18).toString("hex"),
      status: "pending" as const,
      openCount: 0,
      clickCount: 0,
      sequenceId: sequences[sequenceIndex]?.id,
      sequenceIndex,
      availableAt: sequenceIndex === 0 ? scheduledFor ?? now : LOCKED_SEQUENCE_AT,
      subjectLine: step.subject,
      htmlBody: pitchToHtml(step.body),
      stepDelayDays: delays[sequenceIndex] ?? 0,
    }));
  });

  await db.collection<CampaignBlastDoc>("campaign_blasts").insertOne(blast);
  for (let offset = 0; offset < sends.length; offset += 400) {
    await db.collection<CampaignSendDoc>("campaign_sends").insertMany(
      sends.slice(offset, offset + 400),
    );
  }

  await updateProjectDripCampaign(
    input.projectId,
    campaign.id,
    {
      status: scheduledFor ? "scheduled" : "sending",
      tags: ["personalise"],
      senderId,
      senderName,
      senderEmail: fromEmail,
      listId: list._id.toString(),
      listName: list.name,
      listDisplayId: list.displayId,
      recipients: ready.length,
      sequences,
      windowStart,
      windowEnd,
      emailGapMinutes,
      subject: sequences[0]?.subject,
      hasDesign: true,
      designHtml: sequences[0]?.designHtml,
      timezone: "Asia/Kolkata",
      timezoneEnabled: true,
    },
    "oneone",
  );

  if (!scheduledFor) {
    await dispatchBlastNow(blast._id);
  }

  return {
    listId: list._id.toString(),
    listName: list.name,
    campaignId: campaign.id,
    campaignName: campaign.name,
    contacts: ready.length,
    emails: sends.length,
    skipped,
  };
}
