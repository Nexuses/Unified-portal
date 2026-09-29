import { createVerify } from "crypto";

export type SnsEnvelope = {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  Token?: string;
};

const certCache = new Map<string, string>();

function isAwsSnsUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function stringToSign(message: SnsEnvelope) {
  const type = String(message.Type ?? "");
  const keys =
    type === "Notification"
      ? [
          "Message",
          "MessageId",
          ...(message.Subject ? ["Subject"] : []),
          "Timestamp",
          "TopicArn",
          "Type",
        ]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  return keys
    .map((key) => `${key}\n${String(message[key as keyof SnsEnvelope] ?? "")}\n`)
    .join("");
}

async function signingCertificate(url: string) {
  const cached = certCache.get(url);
  if (cached) {
    return cached;
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not download the SNS signing certificate.");
  }
  const pem = await response.text();
  if (!pem.includes("BEGIN CERTIFICATE")) {
    throw new Error("SNS signing certificate was not a PEM certificate.");
  }
  certCache.set(url, pem);
  return pem;
}

export async function verifySnsMessage(message: SnsEnvelope) {
  const certUrl = String(message.SigningCertURL ?? "");
  const signature = String(message.Signature ?? "");
  const version = String(message.SignatureVersion ?? "1");
  if (!signature || !isAwsSnsUrl(certUrl) || !certUrl.endsWith(".pem")) {
    return false;
  }
  const algorithm = version === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const verifier = createVerify(algorithm);
  verifier.update(stringToSign(message), "utf8");
  const pem = await signingCertificate(certUrl);
  return verifier.verify(pem, signature, "base64");
}

export async function confirmSnsSubscription(subscribeUrl: string) {
  if (!isAwsSnsUrl(subscribeUrl)) {
    throw new Error("SNS confirmation URL is not an Amazon SNS endpoint.");
  }
  const response = await fetch(subscribeUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("SNS subscription confirmation failed.");
  }
}

type SesHeader = { name?: string; value?: string };

export type SesBounceMatch = {
  messageIds: string[];
  emails: string[];
  error: string;
};

function headerValue(headers: SesHeader[] | undefined, name: string) {
  const header = headers?.find(
    (item) => String(item.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return String(header?.value ?? "").trim();
}

/** Pull bounce recipients and the portal Message-ID out of an SES event. */
export function parseSesBounce(event: unknown): SesBounceMatch | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const record = event as {
    eventType?: string;
    notificationType?: string;
    bounce?: {
      bounceType?: string;
      bouncedRecipients?: Array<{
        emailAddress?: string;
        diagnosticCode?: string;
        status?: string;
      }>;
    };
    mail?: {
      messageId?: string;
      destination?: string[];
      headers?: SesHeader[];
      commonHeaders?: { messageId?: string; to?: string[] };
    };
  };
  const kind = String(record.eventType || record.notificationType || "");
  if (kind.toLowerCase() !== "bounce" || !record.bounce) {
    return null;
  }

  const recipients = record.bounce.bouncedRecipients ?? [];
  const emails = [
    ...recipients.map((item) => String(item.emailAddress ?? "")),
    ...(record.mail?.destination ?? []),
    ...(record.mail?.commonHeaders?.to ?? []),
  ];
  const messageIds = [
    headerValue(record.mail?.headers, "Message-ID"),
    String(record.mail?.commonHeaders?.messageId ?? ""),
    String(record.mail?.messageId ?? ""),
  ];
  const diagnostic =
    recipients
      .map((item) => String(item.diagnosticCode || item.status || "").trim())
      .find(Boolean) || "";
  const bounceType = String(record.bounce.bounceType ?? "").trim();
  const error = [bounceType ? `${bounceType} bounce` : "Bounce", diagnostic]
    .filter(Boolean)
    .join(": ");

  return { messageIds, emails, error };
}
