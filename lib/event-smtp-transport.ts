import nodemailer from "nodemailer";
import {
  normalizeEventSmtpConfig,
  type EventSmtpConfig,
} from "@/lib/event-smtp";

export type EventMailPayload = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
    cid?: string;
    encoding?: "utf8" | "base64";
  }>;
};

function getEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

export function createDefaultEnvTransporter() {
  const host = getEnv("SMTP_HOST");
  const port = Number(getEnv("SMTP_PORT"));
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS");
  const secure = String(process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export function createEventSmtpTransporter(config: EventSmtpConfig | undefined) {
  if (config?.provider === "cloudflare") {
    throw new Error("Cloudflare uses the Email Sending API, not SMTP.");
  }

  if (config?.host && config.user && config.pass) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  return createDefaultEnvTransporter();
}

function parseFromHeader(from: string): { address: string; name?: string } {
  const match = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(from.trim());
  if (match) {
    const name = match[1]?.trim();
    const address = match[2]?.trim();
    if (address) {
      return name ? { address, name } : { address };
    }
  }
  return { address: from.trim() };
}

function mimeTypeOnly(contentType: string) {
  return contentType.split(";")[0]?.trim() || "application/octet-stream";
}

async function sendViaCloudflare(config: EventSmtpConfig, mail: EventMailPayload) {
  const accountId = (config.accountId ?? "").trim();
  const token = config.pass.trim();
  if (!accountId || !token) {
    throw new Error("Cloudflare Account ID and Email API token are required.");
  }

  const from = parseFromHeader(mail.from);
  const body: Record<string, unknown> = {
    to: mail.to,
    from: from.name ? { address: from.address, name: from.name } : from.address,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  };

  if (mail.replyTo) {
    const reply = parseFromHeader(mail.replyTo);
    body.reply_to = reply.name ? { address: reply.address, name: reply.name } : reply.address;
  }

  if (mail.attachments?.length) {
    body.attachments = mail.attachments.map((item) => ({
      content:
        item.encoding === "base64"
          ? item.content
          : Buffer.from(item.content, "utf8").toString("base64"),
      filename: item.filename,
      type: mimeTypeOnly(item.contentType),
      disposition: item.cid ? "inline" : "attachment",
      ...(item.cid ? { content_id: item.cid } : {}),
    }));
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    errors?: Array<{ message?: string; code?: number }>;
    messages?: Array<{ message?: string }>;
  } | null;

  if (!response.ok || payload?.success === false) {
    const detail =
      payload?.errors?.[0]?.message ||
      payload?.messages?.[0]?.message ||
      `Cloudflare email send failed (${response.status}).`;
    throw new Error(detail);
  }
}

export async function sendEventMail(
  smtpConfig: EventSmtpConfig | undefined,
  mail: EventMailPayload
) {
  const config = normalizeEventSmtpConfig(smtpConfig);

  if (config?.provider === "cloudflare") {
    await sendViaCloudflare(config, mail);
    return;
  }

  const transporter = createEventSmtpTransporter(config);
  await transporter.sendMail({
    from: mail.from,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    to: mail.to,
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
