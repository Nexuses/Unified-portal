import { ObjectId } from "mongodb";
import nodemailer from "nodemailer";
import { getDb } from "@/lib/mongodb";
import type { SenderDoc } from "@/lib/smtp-senders";
import type { EventMailPayload } from "@/lib/event-smtp-transport";

function displayNameFromHeader(from: string, fallback: string) {
  const match = /^"?([^"<]*)"?\s*</.exec(from.trim());
  const name = match?.[1]?.trim();
  return name || fallback;
}

function quotedFrom(name: string, email: string) {
  const safeName = name.replace(/"/g, "").trim() || email;
  return `"${safeName}" <${email}>`;
}

async function loadConnectedSender(projectId: string, senderId: string) {
  if (!ObjectId.isValid(projectId) || !ObjectId.isValid(senderId)) {
    throw new Error("Choose a connected sender before sending.");
  }
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId: new ObjectId(projectId),
  });
  if (!sender) {
    throw new Error("That sender is not on this project.");
  }
  if (sender.connection?.status !== "connected") {
    throw new Error("That sender is disconnected. Pick a connected mailbox.");
  }
  return sender;
}

async function sendViaResend(sender: SenderDoc, mail: EventMailPayload, from: string) {
  if (!sender.apiKey) {
    throw new Error("This Resend sender is missing an API key.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sender.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      reply_to: mail.replyTo,
      attachments: mail.attachments?.map((item) => ({
        filename: item.filename,
        content:
          item.encoding === "base64"
            ? item.content
            : Buffer.from(item.content, "utf8").toString("base64"),
        ...(item.cid ? { content_id: item.cid } : {}),
      })),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Resend rejected the event email.");
  }
}

export async function connectedSenderEmail(projectId: string, senderId: string) {
  if (!senderId || !ObjectId.isValid(senderId) || !ObjectId.isValid(projectId)) {
    return "";
  }
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne({
    _id: new ObjectId(senderId),
    projectId: new ObjectId(projectId),
    "connection.status": "connected",
  });
  return sender?.fromEmail?.trim() || "";
}

export async function sendPortalEventMail(
  event: { projectId?: string; senderId?: string; inviteSenderId?: string },
  kind: "notify" | "calendar",
  mail: EventMailPayload,
) {
  const projectId = event.projectId?.trim() ?? "";
  const senderId =
    (kind === "calendar" ? event.inviteSenderId : event.senderId)?.trim() ||
    event.senderId?.trim() ||
    "";
  const sender = await loadConnectedSender(projectId, senderId);
  const from = quotedFrom(
    displayNameFromHeader(mail.from, sender.fromEmail),
    sender.fromEmail,
  );

  if (sender.provider === "resend") {
    await sendViaResend(sender, mail, from);
    return;
  }
  if (sender.provider === "cloudflare") {
    throw new Error("Cloudflare sending is not set up. Choose another sender.");
  }

  const host =
    sender.smtpHost ||
    (sender.provider === "gmail"
      ? "smtp.gmail.com"
      : sender.provider === "outlook"
        ? "smtp-mail.outlook.com"
        : sender.provider === "sendgrid"
          ? "smtp.sendgrid.net"
          : "");
  const port = sender.smtpPort ?? 587;
  const user =
    sender.smtpUser || (sender.provider === "sendgrid" ? "apikey" : sender.fromEmail);
  const pass = sender.smtpPassword || sender.apiKey || "";
  if (!host || !user || !pass) {
    throw new Error("This sender is missing mail credentials.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from,
    to: mail.to,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(mail.attachments?.length
      ? {
          attachments: mail.attachments.map((item) => ({
            filename: item.filename,
            content:
              item.encoding === "base64" ? Buffer.from(item.content, "base64") : item.content,
            contentType: item.contentType,
            ...(item.cid
              ? { cid: item.cid, contentDisposition: "inline" as const }
              : {}),
          })),
        }
      : {}),
  });
}
