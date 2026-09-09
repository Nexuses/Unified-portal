import nodemailer from "nodemailer";
import { ObjectId } from "mongodb";
import {
  emailDomain,
  verifySenderAuth,
  type SenderAuthVerification,
} from "@/lib/mxtoolbox";
import { getDb } from "@/lib/mongodb";
import {
  mapSender,
  type SenderDoc,
  type SmtpProviderId,
} from "@/lib/smtp-senders";
import {
  DEFAULT_TRACKING_HOST,
  normalizeTrackingDomain,
  trackingDnsRecords,
  verifyTrackingDomain,
} from "@/lib/campaign-tracking";

export async function getProjectSenders(projectId: ObjectId) {
  const db = await getDb();
  const senders = await db
    .collection<SenderDoc>("smtp_senders")
    .find({ projectId })
    .sort({ createdAt: -1 })
    .toArray();

  return senders.map(mapSender);
}

export async function getProjectSender(
  projectId: ObjectId,
  senderId: ObjectId,
) {
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });

  return sender ? mapSender(sender) : null;
}

async function saveSenderVerification(
  projectId: ObjectId,
  senderId: ObjectId,
  verification: SenderAuthVerification,
) {
  const db = await getDb();
  const now = new Date();

  await db.collection<SenderDoc>("smtp_senders").updateOne(
    { _id: senderId, projectId },
    {
      $set: {
        verification,
        updatedAt: now,
      },
    },
  );

  return verification;
}

export async function verifyProjectSender(
  projectId: ObjectId,
  senderId: ObjectId,
) {
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });

  if (!sender) {
    return null;
  }

  const domain = emailDomain(sender.fromEmail);
  const verification = await verifySenderAuth(domain, sender.provider);
  await saveSenderVerification(projectId, senderId, verification);

  const updated = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });

  return updated ? mapSender(updated) : null;
}

export async function createProjectSender(
  projectId: ObjectId,
  userId: ObjectId | null,
  input: Omit<
    SenderDoc,
    "_id" | "projectId" | "createdBy" | "createdAt" | "updatedAt" | "verification"
  >,
) {
  const db = await getDb();
  const now = new Date();

  const doc: SenderDoc = {
    _id: new ObjectId(),
    projectId,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    ...input,
  };

  await db.collection<SenderDoc>("smtp_senders").insertOne(doc);

  const domain = emailDomain(doc.fromEmail);
  const verification = await verifySenderAuth(domain, doc.provider);
  await saveSenderVerification(projectId, doc._id, verification);

  const saved = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: doc._id,
  });

  return mapSender(saved ?? { ...doc, verification });
}

export async function updateProjectSender(
  projectId: ObjectId,
  senderId: ObjectId,
  input: Partial<
    Omit<
      SenderDoc,
      | "_id"
      | "projectId"
      | "createdBy"
      | "createdAt"
      | "updatedAt"
      | "verification"
      | "provider"
    >
  >,
) {
  const db = await getDb();
  const existing = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });

  if (!existing) {
    return null;
  }

  const now = new Date();
  const updates: Partial<SenderDoc> = {
    updatedAt: now,
  };

  if (input.fromEmail !== undefined) {
    updates.fromEmail = input.fromEmail;
  }
  if (input.smtpHost !== undefined) {
    updates.smtpHost = input.smtpHost;
  }
  if (input.smtpUser !== undefined) {
    updates.smtpUser = input.smtpUser;
  }
  if (input.smtpPort !== undefined) {
    updates.smtpPort = input.smtpPort;
  }
  if (input.smtpPassword) {
    updates.smtpPassword = input.smtpPassword;
  }
  if (input.apiKey) {
    updates.apiKey = input.apiKey;
  }
  if (input.cloudflareAccountId !== undefined) {
    updates.cloudflareAccountId = input.cloudflareAccountId;
  }
  if (input.cloudflareEmailApiToken) {
    updates.cloudflareEmailApiToken = input.cloudflareEmailApiToken;
  }

  await db.collection<SenderDoc>("smtp_senders").updateOne(
    { _id: senderId, projectId },
    { $set: updates },
  );

  const fromEmail = updates.fromEmail ?? existing.fromEmail;
  const domain = emailDomain(fromEmail);
  const verification = await verifySenderAuth(domain, existing.provider);
  await saveSenderVerification(projectId, senderId, verification);

  const updated = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });

  return updated ? mapSender(updated) : null;
}

export async function startSenderTrackingDomain(
  projectId: ObjectId,
  senderId: ObjectId,
  trackingDomain: string,
) {
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });
  if (!sender) {
    return null;
  }

  const domain = normalizeTrackingDomain(trackingDomain);
  if (!domain) {
    throw new Error("Enter a valid tracking domain, for example track.company.com");
  }

  const now = new Date();
  if (domain === DEFAULT_TRACKING_HOST) {
    await db.collection<SenderDoc>("smtp_senders").updateOne(
      { _id: senderId, projectId },
      {
        $set: {
          trackingDomain: domain,
          trackingVerification: {
            domain,
            verified: true,
            checkedAt: now.toISOString(),
            detail: "Using the default Unified Hub tracking domain.",
          },
          updatedAt: now,
        },
        $unset: { pendingTrackingDomain: "" },
      },
    );
  } else {
    await db.collection<SenderDoc>("smtp_senders").updateOne(
      { _id: senderId, projectId },
      {
        $set: {
          pendingTrackingDomain: domain,
          trackingVerification: {
            domain,
            verified: false,
            checkedAt: now.toISOString(),
            detail: `Add a CNAME from ${domain} to ${DEFAULT_TRACKING_HOST}, then verify.`,
          },
          updatedAt: now,
        },
      },
    );
  }

  const saved = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });
  return saved
    ? {
        sender: mapSender(saved),
        records: trackingDnsRecords(domain),
      }
    : null;
}

export async function verifySenderTrackingDomain(
  projectId: ObjectId,
  senderId: ObjectId,
) {
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });
  if (!sender) {
    return null;
  }

  const domain = sender.pendingTrackingDomain || sender.trackingDomain || "";
  if (!domain) {
    throw new Error("Set a tracking domain first.");
  }

  const verification = await verifyTrackingDomain(domain);
  const now = new Date();

  await db.collection<SenderDoc>("smtp_senders").updateOne(
    { _id: senderId, projectId },
    verification.verified
      ? {
          $set: {
            trackingDomain: verification.domain,
            trackingVerification: verification,
            updatedAt: now,
          },
          $unset: { pendingTrackingDomain: "" },
        }
      : {
          $set: {
            pendingTrackingDomain: verification.domain || domain,
            trackingVerification: verification,
            updatedAt: now,
          },
          // Do not keep a broken custom host as the active trackingDomain.
          $unset: { trackingDomain: "" },
        },
  );

  const saved = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: senderId,
    projectId,
  });
  return saved
    ? {
        sender: mapSender(saved),
        records: trackingDnsRecords(domain),
      }
    : null;
}

export async function deleteProjectSender(projectId: ObjectId, senderId: ObjectId) {
  const db = await getDb();
  const result = await db.collection<SenderDoc>("smtp_senders").deleteOne({
    _id: senderId,
    projectId,
  });
  return result.deletedCount === 1;
}

export async function deleteProjectSenders(projectId: ObjectId) {
  const db = await getDb();
  await db.collection<SenderDoc>("smtp_senders").deleteMany({ projectId });
}

export function isSmtpProviderId(value: string): value is SmtpProviderId {
  return [
    "aws_ses",
    "gmail",
    "outlook",
    "sendgrid",
    "cloudflare",
    "resend",
  ].includes(value);
}

export type TestEmailInput = {
  senderId: string;
  to: string[];
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
};

export type ProjectMailInput = {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
  listUnsubscribeUrl?: string;
};

export async function sendProjectTestEmail(
  projectId: ObjectId,
  input: TestEmailInput,
) {
  const sender = await loadProjectSender(projectId, input.senderId);
  const to = input.to.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (to.length === 0) {
    throw new Error("Add at least one recipient");
  }

  await deliverWithSender(sender, {
    to,
    subject: input.subject,
    html: input.html,
    fromName: input.fromName,
    replyTo: input.replyTo,
  });

  return { sent: to.length };
}

export async function sendProjectMail(
  projectId: ObjectId,
  senderId: string,
  input: ProjectMailInput,
) {
  const sender = await loadProjectSender(projectId, senderId);
  const to = input.to.trim().toLowerCase();
  if (!to) {
    throw new Error("Recipient is missing");
  }

  await deliverWithSender(sender, {
    to: [to],
    subject: input.subject,
    html: input.html,
    fromName: input.fromName,
    replyTo: input.replyTo,
    listUnsubscribeUrl: input.listUnsubscribeUrl,
  });
}

async function loadProjectSender(projectId: ObjectId, senderId: string) {
  if (!ObjectId.isValid(senderId)) {
    throw new Error("Invalid sender");
  }

  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId,
  });

  if (!sender) {
    throw new Error("Sender not found");
  }

  return sender;
}

async function deliverWithSender(
  sender: SenderDoc,
  input: {
    to: string[];
    subject: string;
    html: string;
    fromName?: string;
    replyTo?: string;
    listUnsubscribeUrl?: string;
  },
) {
  const fromEmail = sender.fromEmail;
  const from = input.fromName?.trim()
    ? `"${input.fromName.trim()}" <${fromEmail}>`
    : fromEmail;
  const subject = input.subject.trim() || "(no subject)";
  const html = input.html.trim();
  if (!html) {
    throw new Error("Email HTML is empty");
  }

  const replyTo = input.replyTo?.trim() || undefined;
  const listUnsubscribeUrl = input.listUnsubscribeUrl?.trim() || undefined;

  if (sender.provider === "sendgrid" && sender.apiKey) {
    await sendWithSendgrid(sender.apiKey, {
      fromEmail,
      fromName: input.fromName?.trim(),
      to: input.to,
      subject,
      html,
      replyTo,
      listUnsubscribeUrl,
    });
    return;
  }

  if (sender.provider === "resend" && sender.apiKey) {
    await sendWithResend(sender.apiKey, {
      from,
      to: input.to,
      subject,
      html,
      replyTo,
      listUnsubscribeUrl,
    });
    return;
  }

  if (sender.provider === "cloudflare") {
    throw new Error("Cloudflare Email is not set up for sending yet.");
  }

  const host =
    sender.smtpHost ||
    (sender.provider === "gmail"
      ? "smtp.gmail.com"
      : sender.provider === "outlook"
        ? "smtp-mail.outlook.com"
        : sender.provider === "sendgrid"
          ? "smtp.sendgrid.net"
          : undefined);
  const port = sender.smtpPort ?? 587;
  const user =
    sender.smtpUser ||
    (sender.provider === "sendgrid" ? "apikey" : sender.fromEmail);
  const pass = sender.smtpPassword || sender.apiKey;

  if (!host || !user || !pass) {
    throw new Error("This sender is missing SMTP host, username, or password.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: input.to,
    subject,
    html,
    replyTo,
    ...(listUnsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${listUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });
}

async function sendWithSendgrid(
  apiKey: string,
  mail: {
    fromEmail: string;
    fromName?: string;
    to: string[];
    subject: string;
    html: string;
    replyTo?: string;
    listUnsubscribeUrl?: string;
  },
) {
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: mail.to.map((email) => ({ email })) }],
      from: mail.fromName
        ? { email: mail.fromEmail, name: mail.fromName }
        : { email: mail.fromEmail },
      reply_to: mail.replyTo ? { email: mail.replyTo } : undefined,
      subject: mail.subject,
      content: [{ type: "text/html", value: mail.html }],
      headers: mail.listUnsubscribeUrl
        ? {
            "List-Unsubscribe": `<${mail.listUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "SendGrid rejected the test email.");
  }
}

async function sendWithResend(
  apiKey: string,
  mail: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    replyTo?: string;
    listUnsubscribeUrl?: string;
  },
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      reply_to: mail.replyTo,
      headers: mail.listUnsubscribeUrl
        ? [
            {
              name: "List-Unsubscribe",
              value: `<${mail.listUnsubscribeUrl}>`,
            },
            {
              name: "List-Unsubscribe-Post",
              value: "List-Unsubscribe=One-Click",
            },
          ]
        : undefined,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Resend rejected the test email.");
  }
}
