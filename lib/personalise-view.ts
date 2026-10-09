import { ObjectId } from "mongodb";
import type { CampaignBlastDoc, CampaignSendDoc } from "@/lib/campaign-blasts-server";
import type { ContactDoc } from "@/lib/crm";
import { getDb } from "@/lib/mongodb";
import type {
  PersonaliseCampaignSnapshot,
  PersonaliseSentContact,
} from "@/lib/personalise-types";

export async function getPersonaliseCampaignSnapshot(
  projectId: ObjectId,
  campaignId: string,
): Promise<PersonaliseCampaignSnapshot | null> {
  const db = await getDb();
  const blast = await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .findOne({ projectId, campaignId, kind: "oneone" }, { sort: { createdAt: -1 } });
  if (!blast) {
    return null;
  }

  const [sends, sender] = await Promise.all([
    db
      .collection<CampaignSendDoc>("campaign_sends")
      .find({ blastId: blast._id })
      .sort({ _id: 1 })
      .toArray(),
    ObjectId.isValid(blast.senderId)
      ? db
          .collection("smtp_senders")
          .findOne({ _id: new ObjectId(blast.senderId), projectId }, { projection: { provider: 1 } })
      : null,
  ]);

  const emails = [...new Set(sends.map((send) => send.email.toLowerCase()))];
  const contactDocs = emails.length
    ? await db
        .collection<ContactDoc>("contacts")
        .find({ projectId, email: { $in: emails } })
        .project({ email: 1, attributes: 1 })
        .toArray()
    : [];
  const attributesByEmail = new Map(
    contactDocs.map((doc) => [
      String(doc.email).toLowerCase(),
      (doc.attributes ?? {}) as Record<string, string>,
    ]),
  );

  const byEmail = new Map<string, CampaignSendDoc[]>();
  for (const send of sends) {
    const key = send.email.toLowerCase();
    const rows = byEmail.get(key) ?? [];
    rows.push(send);
    byEmail.set(key, rows);
  }

  const sequences = blast.sequences ?? [];
  const contacts: PersonaliseSentContact[] = [];
  for (const [email, rows] of byEmail) {
    rows.sort((left, right) => (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0));
    const first = rows[0];
    const attributes = attributesByEmail.get(email) ?? {};
    let day = 0;
    const steps = rows.map((send, index) => {
      const index0 = send.sequenceIndex ?? index;
      const delayDays =
        index === 0 ? 0 : Math.max(0, send.stepDelayDays ?? sequences[index0]?.delayDays ?? 0);
      day += delayDays;
      return {
        day,
        delayDays,
        subject:
          send.subjectLine ?? (index0 === 0 ? sequences[0]?.subject ?? blast.subject : "") ?? "",
        html: send.htmlBody || sequences[index0]?.designHtml || "",
        status: send.status,
        error: send.error,
        sentAt: send.sentAt?.toISOString(),
        availableAt:
          send.availableAt && send.availableAt.getUTCFullYear() < 2090
            ? send.availableAt.toISOString()
            : undefined,
      };
    });
    contacts.push({
      firstName: first.firstName ?? "",
      lastName: first.lastName ?? "",
      email: first.email,
      companyName: first.companyName ?? "",
      position: attributes.position ?? "",
      personalLinkedIn: attributes.personalLinkedIn ?? "",
      repliedAt: rows.find((send) => send.repliedAt)?.repliedAt?.toISOString(),
      unsubscribedAt: rows.find((send) => send.unsubscribedAt)?.unsubscribedAt?.toISOString(),
      steps,
    });
  }

  return {
    campaignId,
    name: blast.name,
    status: blast.status,
    listName: blast.listName ?? "",
    senderEmail: blast.senderEmail,
    senderProvider: String((sender as { provider?: string } | null)?.provider ?? ""),
    windowStart: blast.windowStart ?? "",
    windowEnd: blast.windowEnd ?? "",
    emailGapMinutes: blast.emailGapMinutes ?? 0,
    scheduledFor: blast.scheduledFor?.toISOString(),
    contacts,
  };
}
