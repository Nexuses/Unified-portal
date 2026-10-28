import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ContactDoc } from "@/lib/crm";
import type {
  CampaignBlastDoc,
  CampaignSendDoc,
} from "@/lib/campaign-blasts-server";
import {
  applyContactVariables,
  contactMergeFieldsFromContact,
} from "@/lib/email-variables";

export type ContactCampaignSendEmail = {
  sendId: string;
  subject: string;
  previewText: string;
  html: string;
  campaignId: string;
  campaignName: string;
  fromName: string;
  fromEmail: string;
  sentAt: string;
};

/** Load the email content that went out for one campaign send to this contact. */
export async function getContactCampaignSendEmail(
  projectId: ObjectId,
  contactId: ObjectId,
  sendId: ObjectId,
): Promise<ContactCampaignSendEmail | null> {
  const db = await getDb();
  const contact = await db.collection<ContactDoc>("contacts").findOne({
    _id: contactId,
    projectId,
  });
  if (!contact) {
    return null;
  }
  const email = String(contact.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return null;
  }

  const send = await db.collection<CampaignSendDoc>("campaign_sends").findOne({
    _id: sendId,
    projectId,
    email,
  });
  if (!send) {
    return null;
  }

  const blast = await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({
    _id: send.blastId,
    projectId,
  });
  if (!blast) {
    return null;
  }

  const sequence =
    blast.sequences?.find((item) => item.id === send.sequenceId) ??
    (typeof send.sequenceIndex === "number"
      ? blast.sequences?.[send.sequenceIndex]
      : undefined);

  const rawSubject =
    send.subjectLine?.trim() ||
    sequence?.subject?.trim() ||
    blast.subject?.trim() ||
    "";
  const rawHtml =
    send.htmlBody?.trim() ||
    sequence?.designHtml?.trim() ||
    blast.html?.trim() ||
    "";
  const previewText =
    sequence?.previewText?.trim() || blast.previewText?.trim() || "";

  const mergeContact = contactMergeFieldsFromContact(contact);

  return {
    sendId: send._id.toString(),
    subject: applyContactVariables(rawSubject, mergeContact, false),
    previewText: applyContactVariables(previewText, mergeContact, false),
    html: applyContactVariables(rawHtml, mergeContact, true),
    campaignId: send.campaignId,
    campaignName: blast.name || `Campaign #${send.campaignId}`,
    fromName: blast.senderName?.trim() || "",
    fromEmail: blast.senderEmail?.trim() || "",
    sentAt:
      send.sentAt instanceof Date
        ? send.sentAt.toISOString()
        : send.sentAt
          ? new Date(send.sentAt).toISOString()
          : "",
  };
}
