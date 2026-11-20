import {
  applyEmailFlowPlaceholders,
  resolveEmailFlowTemplate,
  variantToEmailFlowKey,
  type EmailFlowKey,
} from "@/lib/event-email-flows";
import {
  EVENT_WALL_TIME_ZONE,
  formatEventEmailDateTime,
} from "@/lib/public-event-time";
import {
  inviteMessageHtmlToPlainText,
  isInviteMessageHtmlEmpty,
  sanitizeInviteMessageHtml,
} from "@/lib/sanitize-invite-message-html";
import { hiddenClickTrapHtml } from "@/lib/click-trap";
import { sendPortalEventMail } from "@/lib/event-sender-mail";
import { applyEventInviteCustomTracking } from "@/lib/event-invite-tracking";
import { ensureSubmissionTrapToken, inviteClickTrapUrl } from "@/lib/invite-trap";
import { eventPublicUrl } from "@/lib/event-public-url";
import { isSharedSessionFormat } from "@/lib/event-format";
import type { EventDocument } from "@/lib/events";
import {
  buildCalendarInviteAnnouncementHtml,
  buildInviteAnnouncementHtml,
  parseCalendarInviteAgenda,
} from "@/lib/invite-email-layout";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePublicHeaderLogo } from "@/lib/public-header-logo";
import {
  platformUsesMeetingLink,
  resolveMeetingLink,
} from "@/lib/event-platform";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function platformIconMailAttachment(_platform: string) {
  const filename = "platform-video.png";
  const content = readFileSync(path.join(process.cwd(), "public", "email", filename)).toString(
    "base64",
  );
  return {
    filename,
    content,
    contentType: "image/png",
    cid: filename.replace(/\.png$/, ""),
    encoding: "base64" as const,
  };
}

type InviteRecipient = {
  name: string;
  email: string;
};

type InviteEmailVariant = "registration" | "reminder" | "waitlist" | "waitlist_confirmation" | "waitlist_rejection";
type InviteEmailOptions = {
  acceptInviteUrl?: string;
  calendarInviteUid?: string;
  customMessage?: string;
  viewerTimeZone?: string | null;
  emailFlowKey?: EmailFlowKey;
  fromInviteRoute?: boolean;
  useEventBanner?: boolean;
  bannerUrl?: string;
  submissionId?: string;
};
type InviteCalendarSlot = {
  eventDate?: string;
  eventTimeStart?: string;
  eventTimeEnd?: string;
  platform?: string;
  platformLink?: string;
};

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toLocalDateTimeToken(date: string, time: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match || !timeMatch) {
    return null;
  }
  return `${match[1]}${match[2]}${match[3]}T${timeMatch[1]}${timeMatch[2]}00`;
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildAttendeeLines(primary: InviteRecipient, extras: InviteRecipient[] = []) {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const person of [primary, ...extras]) {
    const email = person.email.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push(
      `ATTENDEE;CN=${escapeIcsText(person.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${email}`
    );
  }

  return lines;
}

function buildIcsContent(
  event: EventDocument,
  recipient: InviteRecipient,
  slot: InviteCalendarSlot,
  options?: {
    acceptInviteUrl?: string;
    calendarInviteUid?: string;
    additionalAttendees?: InviteRecipient[];
    descriptionParticipant?: InviteRecipient;
    organizerName?: string;
    organizerEmail?: string;
  }
) {
  const dtStamp = formatIcsDate(new Date());
  const eventDate = slot.eventDate ?? event.eventDate;
  const eventTimeStart = slot.eventTimeStart ?? event.eventTimeStart;
  const eventTimeEnd = slot.eventTimeEnd ?? event.eventTimeEnd;
  const platform = slot.platform ?? event.platform;
  const platformLink = resolveMeetingLink(platform, slot.platformLink ?? event.platformLink);
  const dtStart = toLocalDateTimeToken(eventDate, eventTimeStart) ?? dtStamp;
  const dtEnd = toLocalDateTimeToken(eventDate, eventTimeEnd) ?? dtStamp;

  const descriptionParticipant = options?.descriptionParticipant ?? recipient;
  const agendaItems = parseCalendarInviteAgenda(event.calendarInviteAgenda);
  const agendaBlock = agendaItems.length
    ? ["Agenda:", ...agendaItems.map((item) => `• ${item}`)].join("\n")
    : "";

  const description = escapeIcsText(
    [
      agendaBlock,
      agendaBlock ? "" : String(event.aboutEvent ?? "").trim(),
      "",
      `Participant: ${descriptionParticipant.name}`,
      `Email: ${descriptionParticipant.email}`,
      platformLink ? `Meeting Link: ${platformLink}` : "",
      options?.acceptInviteUrl
        ? `\nConfirm attendance on the guest list:\n${options.acceptInviteUrl}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  const summary = escapeIcsText(event.eventName);
  const location = escapeIcsText(
    platformUsesMeetingLink(platform)
      ? platformLink || platform || "Online"
      : platform || "In Person Meeting"
  );
  const uidBase = event.publicId || event._id?.toString() || `${event.eventName}-${event.eventDate}`;
  const uid =
    options?.calendarInviteUid?.trim() ||
    `${uidBase}-${recipient.email}`.replace(/\s+/g, "");
  const extraAttendees = [...(options?.additionalAttendees ?? [])];
  const attendeeLines = buildAttendeeLines(recipient, extraAttendees);
  const organizerName = (options?.organizerName ?? "").trim() || "Nexuses";
  const organizerEmail = (options?.organizerEmail ?? "").trim();
  const organizerLine = organizerEmail
    ? `ORGANIZER;CN=${escapeIcsText(organizerName)}:MAILTO:${organizerEmail}`
    : "";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Luma Replica//Event Invite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "X-LIC-LOCATION:Asia/Kolkata",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "TZNAME:IST",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=Asia/Kolkata:${dtStart}`,
    `DTEND;TZID=Asia/Kolkata:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    ...(organizerLine ? [organizerLine] : []),
    ...attendeeLines,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function resolveSenderName(event: EventDocument) {
  const fromEvent = (event.senderName ?? "").trim();
  if (fromEvent) {
    return fromEvent;
  }
  return "Nexgos Platform";
}

function resolveSenderEmail(event: EventDocument) {
  const fromEvent = (event.senderEmail ?? "").trim();
  if (fromEvent && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEvent)) {
    return fromEvent;
  }
  throw new Error("Choose a sender for invite emails.");
}

function resolveReplyToEmail(event: EventDocument) {
  const replyTo = (event.replyToEmail ?? "").trim();
  if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    return replyTo;
  }
  return undefined;
}

/** Calendar ICS invite identity — falls back to notification sender when unset. */
function resolveInviteSenderName(event: EventDocument) {
  const fromEvent = (event.inviteSenderName ?? "").trim();
  if (fromEvent) {
    return fromEvent;
  }
  return resolveSenderName(event);
}

function resolveInviteSenderEmail(event: EventDocument) {
  const fromEvent = (event.inviteSenderEmail ?? "").trim();
  if (fromEvent && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEvent)) {
    return fromEvent;
  }
  return resolveSenderEmail(event);
}

function resolveInviteReplyToEmail(event: EventDocument) {
  const replyTo = (event.inviteReplyToEmail ?? "").trim();
  if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    return replyTo;
  }
  return resolveReplyToEmail(event);
}

function icsFilenameForEvent(event: EventDocument) {
  return `${event.eventName.replace(/[^\w.-]+/g, "-").toLowerCase() || "event"}-invite.ics`;
}

async function sendCalendarInviteMails(
  event: EventDocument,
  recipient: InviteRecipient,
  slot: InviteCalendarSlot,
  options: {
    calendarInviteUid?: string;
    acceptInviteUrl?: string;
    viewerTimeZone?: string | null;
    notifyOwner?: boolean;
    clickTrapUrl?: string;
    submissionId?: string;
  } = {}
) {
  const fromName = resolveInviteSenderName(event);
  const fromEmail = resolveInviteSenderEmail(event);
  const replyTo = resolveInviteReplyToEmail(event);
  const effectiveDate = slot.eventDate ?? event.eventDate;
  const effectiveStart = slot.eventTimeStart ?? event.eventTimeStart;
  const effectiveEnd = slot.eventTimeEnd ?? event.eventTimeEnd;
  const effectivePlatform = slot.platform ?? event.platform;
  const effectivePlatformLink = resolveMeetingLink(
    effectivePlatform,
    slot.platformLink ?? event.platformLink
  );
  const ownerEmail = (event.ownerEmail ?? "").trim();
  const ownerName = (event.ownerName ?? "").trim() || "Owner";
  const shouldNotifyOwner =
    options.notifyOwner !== false &&
    ownerEmail.length > 0 &&
    ownerEmail.toLowerCase() !== recipient.email.trim().toLowerCase()
      ? ownerEmail
      : "";
  const isOneToOne = !isSharedSessionFormat(event.eventFormat);
  const guestDateTime = formatEventEmailDateTime(
    effectiveDate,
    effectiveStart,
    effectiveEnd,
    options.viewerTimeZone
  );
  const ownerDateTime = formatEventEmailDateTime(
    effectiveDate,
    effectiveStart,
    effectiveEnd,
    EVENT_WALL_TIME_ZONE
  );
  const displayDate = guestDateTime.displayDate;
  const displayTime = guestDateTime.displayTime;
  const ownerDisplayDate = ownerDateTime.displayDate;
  const ownerDisplayTime = ownerDateTime.displayTime;
  const icsFilename = icsFilenameForEvent(event);
  const organizer = { organizerName: fromName, organizerEmail: fromEmail };
  const agendaItems = parseCalendarInviteAgenda(event.calendarInviteAgenda);
  const brandName =
    (event.companyName ?? "").trim() ||
    (event.hostedBy ?? "").trim() ||
    fromName ||
    "Event";
  const brandLogoUrl =
    (event.companyLogo ?? "").trim() ||
    resolvePublicHeaderLogo(event.publicHeaderLogo);
  const viewEventUrl = event.publicId ? eventPublicUrl(event.publicId) : "";
  const agendaTextBlock = agendaItems.length
    ? ["Agenda:", ...agendaItems.map((item) => `• ${item}`), ""].join("\n")
    : "";

  const guestIcs = buildIcsContent(event, recipient, slot, {
    acceptInviteUrl: options.acceptInviteUrl,
    calendarInviteUid: options.calendarInviteUid,
    ...(isOneToOne && shouldNotifyOwner
      ? { additionalAttendees: [{ name: ownerName, email: ownerEmail }] }
      : {}),
    ...organizer,
  });

  const calendarEventId =
    ("id" in event && typeof (event as { id?: string }).id === "string"
      ? (event as { id?: string }).id
      : "") ||
    event._id?.toString() ||
    "";
  const calendarHtml = await applyEventInviteCustomTracking({
    html:
      buildCalendarInviteAnnouncementHtml({
        brandName,
        brandLogoUrl,
        eventName: event.eventName,
        eventDateYmd: effectiveDate,
        displayDate,
        displayTime,
        platform: effectivePlatform,
        assetBaseUrl: "cid",
        agendaItems,
        eyebrow: "Calendar invite",
        introHtml: `Hi ${escapeHtml(recipient.name)}, here is your calendar invite. Open the attached .ics file to add it to your calendar.`,
        viewEventUrl,
        footerNote: "A calendar file (.ics) is attached to this email.",
      }) + hiddenClickTrapHtml(options.clickTrapUrl ?? ""),
    event,
    eventId: calendarEventId,
    submissionId: options.submissionId,
  });

  await sendPortalEventMail(event, "calendar", {
    from: `"${fromName}" <${fromEmail}>`,
    ...(replyTo ? { replyTo } : {}),
    to: recipient.email,
    subject: `Calendar invite: ${event.eventName} • ${displayDate}`,
    text: [
      `Hi ${recipient.name},`,
      "",
      `Here is your calendar invite for ${event.eventName}.`,
      "",
      agendaTextBlock.trimEnd(),
      `Date: ${displayDate}`,
      `Time: ${displayTime}`,
      `Platform: ${effectivePlatform}`,
      effectivePlatformLink ? `Meeting Link: ${effectivePlatformLink}` : "",
      "",
      "Open the attached .ics file to add this event to your calendar.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: calendarHtml,
    attachments: [
      {
        filename: icsFilename,
        content: guestIcs,
        contentType: "text/calendar; method=REQUEST; charset=UTF-8",
      },
      ...(effectivePlatform.trim() ? [platformIconMailAttachment(effectivePlatform)] : []),
    ],
  });

  if (!shouldNotifyOwner) {
    return;
  }

  const ownerIcs = buildIcsContent(
    event,
    { name: ownerName, email: ownerEmail },
    slot,
    {
      acceptInviteUrl: options.acceptInviteUrl,
      calendarInviteUid: options.calendarInviteUid,
      ...(isOneToOne
        ? {
            additionalAttendees: [{ name: recipient.name, email: recipient.email }],
            descriptionParticipant: { name: recipient.name, email: recipient.email },
          }
        : {}),
      ...organizer,
    }
  );
  const clientDetailText = isOneToOne
    ? [`Client: ${recipient.name}`, `Client email: ${recipient.email}`]
    : [];
  const ownerIntroHtml = [
    `Hi ${escapeHtml(ownerName)}, you have been added as the owner for this meeting.`,
    isOneToOne
      ? `<div style="margin-top:10px;">Client: <strong>${escapeHtml(recipient.name)}</strong><br />Email: <a href="mailto:${escapeHtml(recipient.email)}" style="color:#111111;text-decoration:underline;">${escapeHtml(recipient.email)}</a></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  await sendPortalEventMail(event, "calendar", {
    from: `"${fromName}" <${fromEmail}>`,
    ...(replyTo ? { replyTo } : {}),
    to: ownerEmail,
    subject: `Calendar invite (Owner): ${event.eventName} • ${ownerDisplayDate}`,
    text: [
      `Hi ${ownerName},`,
      "",
      `You have been added as the owner for ${event.eventName}.`,
      ...clientDetailText,
      "",
      agendaTextBlock.trimEnd(),
      `Date: ${ownerDisplayDate}`,
      `Time: ${ownerDisplayTime}`,
      `Platform: ${effectivePlatform}`,
      effectivePlatformLink ? `Meeting Link: ${effectivePlatformLink}` : "",
      "",
      "Open the attached .ics file to add this event to your calendar.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: buildCalendarInviteAnnouncementHtml({
      brandName,
      brandLogoUrl,
      eventName: event.eventName,
      eventDateYmd: effectiveDate,
      displayDate: ownerDisplayDate,
      displayTime: ownerDisplayTime,
      platform: effectivePlatform,
      assetBaseUrl: "cid",
      agendaItems,
      eyebrow: "Meeting owner calendar invite",
      introHtml: ownerIntroHtml,
      viewEventUrl,
      footerNote: "A calendar file (.ics) is attached to this email.",
    }),
    attachments: [
      {
        filename: icsFilename,
        content: ownerIcs,
        contentType: "text/calendar; method=REQUEST; charset=UTF-8",
      },
      ...(effectivePlatform.trim() ? [platformIconMailAttachment(effectivePlatform)] : []),
    ],
  });
}

/** Sends the .ics calendar invite from the Invite Email SMTP after a guest accepts. */
export async function sendAcceptedCalendarInviteEmail(
  event: EventDocument,
  recipient: InviteRecipient,
  slot: InviteCalendarSlot = {},
  options: { calendarInviteUid?: string; viewerTimeZone?: string | null } = {}
) {
  await sendCalendarInviteMails(event, recipient, slot, {
    calendarInviteUid: options.calendarInviteUid,
    viewerTimeZone: options.viewerTimeZone,
    notifyOwner: true,
  });
}

export async function sendSubmissionInviteEmail(
  event: EventDocument,
  recipient: InviteRecipient,
  variant: InviteEmailVariant = "registration",
  slot: InviteCalendarSlot = {},
  options: InviteEmailOptions = {}
) {
  const fromName = resolveSenderName(event);
  const fromEmail = resolveSenderEmail(event);
  const replyTo = resolveReplyToEmail(event);
  const effectiveDate = slot.eventDate ?? event.eventDate;
  const effectiveStart = slot.eventTimeStart ?? event.eventTimeStart;
  const effectiveEnd = slot.eventTimeEnd ?? event.eventTimeEnd;
  const effectivePlatform = slot.platform ?? event.platform;
  const effectivePlatformLink = resolveMeetingLink(
    effectivePlatform,
    slot.platformLink ?? event.platformLink
  );
  const isWaitlistAck = variant === "waitlist";
  const isWaitlistReject = variant === "waitlist_rejection";
  /** ICS is deferred until accept when the guest must confirm via acceptInviteUrl. */
  const deferCalendarInvite = Boolean(options.acceptInviteUrl?.trim());
  const includeCalendarInvite = !isWaitlistAck && !isWaitlistReject && !deferCalendarInvite;
  const guestDateTime = formatEventEmailDateTime(
    effectiveDate,
    effectiveStart,
    effectiveEnd,
    options.viewerTimeZone
  );
  const displayDate = guestDateTime.displayDate;
  const displayTime = guestDateTime.displayTime;

  const flowKey =
    options.emailFlowKey ?? variantToEmailFlowKey(variant, { fromInviteRoute: options.fromInviteRoute });
  const flowTemplate = resolveEmailFlowTemplate(event, flowKey);
  const placeholderContext = {
    recipientName: recipient.name,
    eventName: event.eventName,
    eventDate: displayDate,
    eventTime: displayTime,
    platform: effectivePlatform,
    platformLink: effectivePlatformLink,
  };
  const customMessageHtml = sanitizeInviteMessageHtml(options.customMessage ?? "");
  const hasCustomMessage = !isInviteMessageHtmlEmpty(customMessageHtml);
  const messageText = hasCustomMessage
    ? inviteMessageHtmlToPlainText(customMessageHtml)
    : inviteMessageHtmlToPlainText(
        applyEmailFlowPlaceholders(flowTemplate.messageHtml, placeholderContext)
      );
  const actionText = applyEmailFlowPlaceholders(flowTemplate.actionText, placeholderContext);
  const subject = applyEmailFlowPlaceholders(flowTemplate.subject, placeholderContext);
  const acceptButtonText = options.acceptInviteUrl
    ? `\nAccept invite: ${options.acceptInviteUrl}\n`
    : "";
  const brandName =
    (event.companyName ?? "").trim() ||
    (event.hostedBy ?? "").trim() ||
    fromName ||
    "Event";
  const brandLogoUrl =
    (event.companyLogo ?? "").trim() ||
    resolvePublicHeaderLogo(event.publicHeaderLogo);
  const viewEventUrl = event.publicId ? eventPublicUrl(event.publicId) : "";

  const resolvedMessageHtml = hasCustomMessage
    ? customMessageHtml
    : applyEmailFlowPlaceholders(flowTemplate.messageHtml, placeholderContext);
  const inviteLine = `You're invited to ${event.eventName}.`;
  const messageLooksLikeInviteOnly = (() => {
    const plain = messageText.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.“”"']/g, "");
    const invite = inviteLine.toLowerCase().replace(/[.“”"']/g, "");
    return !plain || plain === invite || plain === invite.replace(/\.$/, "");
  })();

  const guestText = [
    inviteLine,
    messageLooksLikeInviteOnly ? "" : messageText,
    `Date: ${displayDate}`,
    `Time: ${displayTime}`,
    effectivePlatform ? `Platform: ${effectivePlatform}` : "",
    "",
    actionText,
    acceptButtonText,
    viewEventUrl ? `View event: ${viewEventUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const eventId =
    ("id" in event && typeof (event as { id?: string }).id === "string"
      ? (event as { id?: string }).id
      : "") ||
    event._id?.toString() ||
    "";
  const trapToken =
    options.submissionId && eventId
      ? await ensureSubmissionTrapToken(eventId, options.submissionId)
      : "";
  const clickTrapUrl = inviteClickTrapUrl(trapToken);
  const guestHtml = await applyEventInviteCustomTracking({
    html:
      buildInviteAnnouncementHtml({
        brandName,
        brandLogoUrl,
        eventName: event.eventName,
        eventDateYmd: effectiveDate,
        displayDate,
        displayTime,
        platform: effectivePlatform,
        assetBaseUrl: "cid",
        messageHtml: resolvedMessageHtml,
        acceptInviteUrl: options.acceptInviteUrl,
        viewEventUrl,
        declineUrl: viewEventUrl,
      }) + hiddenClickTrapHtml(clickTrapUrl),
    event,
    eventId,
    submissionId: options.submissionId,
  });

  // Registration already includes the calendar invite. Do not also send the announcement.
  if (!(includeCalendarInvite && variant === "registration")) {
    await sendPortalEventMail(event, "notify", {
      from: `"${fromName}" <${fromEmail}>`,
      ...(replyTo ? { replyTo } : {}),
      to: recipient.email,
      subject,
      text: guestText,
      html: guestHtml,
      ...(effectivePlatform.trim()
        ? { attachments: [platformIconMailAttachment(effectivePlatform)] }
        : {}),
    });
  }

  if (includeCalendarInvite) {
    await sendCalendarInviteMails(event, recipient, slot, {
      calendarInviteUid: options.calendarInviteUid,
      viewerTimeZone: options.viewerTimeZone,
      notifyOwner: true,
      clickTrapUrl,
      submissionId: options.submissionId,
    });
  }
}
