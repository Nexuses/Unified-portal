import { ObjectId } from "mongodb";
import type { CampaignBlastDoc, CampaignSendDoc } from "@/lib/campaign-blasts-server";
import { chatWithDeepSeek } from "@/lib/deepseek";
import type { InboxMessageDoc } from "@/lib/master-inbox-server";
import { getDb } from "@/lib/mongodb";

const MAX_PART_CHARS = 4000;

const SYSTEM_PROMPT = `You write email replies for a B2B sales team.
You get the campaign emails we sent to one contact, then the conversation that followed.
Write the next reply from us to the contact's latest message.

Rules:
- Answer what the contact actually said. If they asked a question, answer it using only facts from our emails. If you do not know something, say we will confirm it rather than inventing details.
- If they agreed to a call, confirm it and ask for or propose a time. If they declined or asked to stop, reply politely and close.
- Match the tone and sign-off of our earlier emails. Use the same sender name.
- Keep it short: 3 to 6 sentences unless the contact asked for detail.
- Plain text only. Layout: greeting line ("Hi Name,"), blank line, 2 to 4 short paragraphs each separated by a blank line, blank line, sign-off line (e.g. "Best regards,") and the sender name on the next line.
- Use "- " for bullet points only when listing, one per line.
- No subject line, no placeholders like [Name], no notes to me. Output only the email body.`;

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Drop quoted history ("On … wrote:", "> …") so the model sees only the new text. */
function stripQuoted(text: string) {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line)) {
      break;
    }
    if (/^\s*>/.test(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

function clip(text: string) {
  return text.length > MAX_PART_CHARS ? `${text.slice(0, MAX_PART_CHARS)}…` : text;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SIGNOFF_RE =
  /^(best|best regards|kind regards|warm regards|regards|thanks|thank you|many thanks|cheers|sincerely|with respect|respectfully|yours sincerely|yours truly)[,!.]?$/i;
const BULLET_LINE_RE = /^([-•*]|\d{1,2}[.)])\s+/;

const P_STYLE = "margin:0 0 14px;line-height:1.6";
const UL_STYLE = "margin:0 0 14px;padding-left:22px;line-height:1.6";
const LI_STYLE = "margin:0 0 6px";

/**
 * Plain-text reply → HTML with real paragraph spacing.
 * Every line is its own paragraph; bullet runs become a list; the sign-off
 * stays together with the name lines under it.
 */
function replyTextToHtml(text: string) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  const blocks: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push(
        `<ul style="${UL_STYLE}">${bullets
          .map((item) => `<li style="${LI_STYLE}">${escapeHtml(item)}</li>`)
          .join("")}</ul>`,
      );
      bullets = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      flushBullets();
      continue;
    }
    if (BULLET_LINE_RE.test(line)) {
      bullets.push(line.replace(BULLET_LINE_RE, ""));
      continue;
    }
    flushBullets();
    if (SIGNOFF_RE.test(line)) {
      const signature = lines.slice(index).filter(Boolean).map(escapeHtml);
      blocks.push(`<p style="${P_STYLE};margin-top:18px">${signature.join("<br>")}</p>`);
      break;
    }
    blocks.push(`<p style="${P_STYLE}">${escapeHtml(line)}</p>`);
  }
  flushBullets();
  return blocks.join("");
}

export async function suggestInboxReply(input: {
  projectId: ObjectId;
  threadKey: string;
  instruction?: string;
}) {
  const db = await getDb();
  const thread = await db
    .collection<InboxMessageDoc>("inbox_messages")
    .find({ projectId: input.projectId, threadKey: input.threadKey, relatedSendId: { $exists: true } })
    .sort({ receivedAt: 1 })
    .toArray();
  if (thread.length === 0) {
    throw new Error("Thread not found");
  }

  const anchor = thread.find((doc) => doc.relatedSendId) ?? thread[0];
  const contactEmail = (anchor.relatedContactEmail || anchor.fromEmail || "").toLowerCase();

  const relatedSend = anchor.relatedSendId
    ? await db.collection<CampaignSendDoc>("campaign_sends").findOne({ _id: anchor.relatedSendId })
    : null;
  const blast = relatedSend
    ? await db.collection<CampaignBlastDoc>("campaign_blasts").findOne({ _id: relatedSend.blastId })
    : null;

  const campaignEmails: string[] = [];
  if (blast && contactEmail) {
    const sends = await db
      .collection<CampaignSendDoc>("campaign_sends")
      .find({ blastId: blast._id, email: contactEmail, status: "sent" })
      .sort({ sequenceIndex: 1 })
      .toArray();
    const sequences = blast.sequences ?? [];
    for (const send of sends) {
      const index = send.sequenceIndex ?? 0;
      const subject =
        send.subjectLine || sequences[index]?.subject || (index === 0 ? blast.subject : "") || "(same thread)";
      const html = send.htmlBody || sequences[index]?.designHtml || (index === 0 ? blast.html : "") || "";
      const body = htmlToText(html)
        .replace(/\{\{\s*first_?name\s*\}\}/gi, send.firstName || "")
        .replace(/Unsubscribe\s*$/i, "")
        .trim();
      campaignEmails.push(
        `Email ${index + 1}${send.sentAt ? ` (sent ${send.sentAt.toISOString().slice(0, 10)})` : ""}\nSubject: ${subject}\n\n${clip(body)}`,
      );
    }
  }

  const conversation = thread.map((doc) => {
    const who = doc.direction === "outbound" ? `Us (${doc.senderEmail})` : `Contact (${doc.fromName || doc.fromEmail})`;
    const text = stripQuoted(doc.textBody?.trim() || htmlToText(doc.htmlBody || ""));
    return `${who} · ${doc.receivedAt.toISOString().slice(0, 16).replace("T", " ")}\nSubject: ${doc.subject}\n\n${clip(text)}`;
  });

  const contactName =
    [relatedSend?.firstName, relatedSend?.lastName].filter(Boolean).join(" ") ||
    anchor.fromName ||
    contactEmail;

  const userPrompt = [
    `Campaign: ${blast?.name ?? "Unknown"}`,
    `Sender: ${blast?.senderName ?? ""} <${blast?.senderEmail ?? anchor.senderEmail}>`,
    `Contact: ${contactName} <${contactEmail}>${relatedSend?.companyName ? `, ${relatedSend.companyName}` : ""}`,
    "",
    "=== Campaign emails we sent ===",
    campaignEmails.length ? campaignEmails.join("\n\n---\n\n") : "(not found)",
    "",
    "=== Conversation after the campaign ===",
    conversation.join("\n\n---\n\n"),
    "",
    input.instruction?.trim()
      ? `What I want this reply to say: ${input.instruction.trim().slice(0, 1000)}`
      : "Write the best next reply.",
  ].join("\n");

  const reply = await chatWithDeepSeek({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 900,
  });

  const text = reply.replace(/^```[a-z]*\n?|```$/gi, "").replace(/^Subject:.*\n+/i, "").trim();
  return { text, html: replyTextToHtml(text) };
}
