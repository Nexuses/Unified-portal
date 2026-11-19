import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  extractIcsBlocks,
  isAcceptedCalendarRsvp,
  parseCalendarRsvpReply,
} from "@/lib/calendar-rsvp";
import { getDb } from "@/lib/mongodb";
import { acceptWebinarInviteFromCalendarRsvp } from "@/lib/submissions";

type ProcessedRsvpMessage = {
  mailboxKey: string;
  imapUid: number;
  processedAt: Date;
};

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function isCalendarRsvpImapEnabled() {
  return env("CALENDAR_RSVP_IMAP_ENABLED").toLowerCase() === "true";
}

async function processedMessagesCollection() {
  const db = await getDb();
  return db.collection<ProcessedRsvpMessage>("calendar_rsvp_processed");
}

async function wasMessageProcessed(mailboxKey: string, imapUid: number) {
  const collection = await processedMessagesCollection();
  const existing = await collection.findOne({ mailboxKey, imapUid });
  return Boolean(existing);
}

async function markMessageProcessed(mailboxKey: string, imapUid: number) {
  const collection = await processedMessagesCollection();
  await collection.updateOne(
    { mailboxKey, imapUid },
    { $set: { mailboxKey, imapUid, processedAt: new Date() } },
    { upsert: true }
  );
}

async function processIcsText(icsText: string) {
  const blocks = extractIcsBlocks(icsText);
  const candidates = blocks.length > 0 ? blocks : [icsText];
  let accepted = 0;

  for (const block of candidates) {
    const parsed = parseCalendarRsvpReply(block);
    if (!parsed || !isAcceptedCalendarRsvp(parsed.partstat)) {
      continue;
    }
    const ok = await acceptWebinarInviteFromCalendarRsvp(parsed.uid, parsed.attendeeEmail);
    if (ok) {
      accepted += 1;
    }
  }

  return accepted;
}

export async function processCalendarRsvpIcsPayload(icsText: string) {
  return processIcsText(icsText);
}

export async function pollCalendarRsvpInbox() {
  if (!isCalendarRsvpImapEnabled()) {
    return { processed: 0, skipped: true, reason: "CALENDAR_RSVP_IMAP_ENABLED is not true." };
  }

  const host = env("IMAP_HOST") || env("SMTP_HOST");
  const user = env("IMAP_USER") || env("SMTP_USER");
  const pass = env("IMAP_PASS") || env("SMTP_PASS");
  const port = Number(env("IMAP_PORT") || "993");
  const secure = env("IMAP_SECURE").toLowerCase() !== "false";

  if (!host || !user || !pass) {
    return { processed: 0, skipped: true, reason: "Missing IMAP/SMTP inbox credentials." };
  }

  const mailboxKey = `${host}:${user}`;
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
  });

  let processed = 0;
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    for await (const message of client.fetch({ since }, { uid: true, source: true })) {
      if (!message.uid || !message.source) {
        continue;
      }
      if (await wasMessageProcessed(mailboxKey, message.uid)) {
        continue;
      }

      const parsed = await simpleParser(message.source);
      const icsChunks: string[] = [];

      for (const attachment of parsed.attachments ?? []) {
        const type = String(attachment.contentType ?? "");
        const name = String(attachment.filename ?? "");
        if (type.includes("text/calendar") || name.toLowerCase().endsWith(".ics")) {
          icsChunks.push(attachment.content.toString("utf8"));
        }
      }

      if (parsed.text?.includes("BEGIN:VCALENDAR")) {
        icsChunks.push(...extractIcsBlocks(parsed.text));
      }
      if (typeof parsed.html === "string" && parsed.html.includes("BEGIN:VCALENDAR")) {
        icsChunks.push(...extractIcsBlocks(parsed.html));
      }

      for (const chunk of icsChunks) {
        processed += await processIcsText(chunk);
      }

      await markMessageProcessed(mailboxKey, message.uid);
      await client.messageFlagsAdd({ uid: message.uid }, ["\\Seen"]);
    }
  } finally {
    await client.logout();
  }

  return { processed, skipped: false };
}
