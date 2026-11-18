import {
  type EventFormat,
  isSharedSessionFormat,
  isWaitlistedWebinarFormat,
} from "@/lib/event-format";
import { sanitizeEmailFlowHtml } from "@/lib/sanitize-email-flow-html";
import { buildInviteAnnouncementHtml } from "@/lib/invite-email-layout";
import { platformUsesMeetingLink } from "@/lib/event-platform";

export type EmailFlowKey =
  | "registration"
  | "invite"
  | "reminder"
  | "waitlist"
  | "waitlist_confirmation"
  | "waitlist_rejection";

export type EmailFlowTemplate = {
  subject: string;
  messageHtml: string;
  actionText: string;
};

export type EventEmailFlows = Partial<Record<EmailFlowKey, EmailFlowTemplate>>;

export type EmailFlowDefinition = {
  id: EmailFlowKey;
  label: string;
  description: string;
  includesGoingButton: boolean;
  includesCalendarInvite: boolean;
};

export type EmailFlowPreviewContext = {
  recipientName?: string;
  eventName?: string;
  eventDate?: string;
  eventTime?: string;
  platform?: string;
  platformLink?: string;
};

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function applyEmailFlowPlaceholders(
  template: string,
  context: EmailFlowPreviewContext
): string {
  const eventName = (context.eventName ?? "").trim() || "Sample Event";
  const replacements: Record<string, string> = {
    eventName,
    recipientName: (context.recipientName ?? "").trim() || "Alex",
    eventDate: (context.eventDate ?? "").trim() || "Mon, Jan 15, 2025",
    eventTime: (context.eventTime ?? "").trim() || "10:00 AM – 11:00 AM IST",
    platform: (context.platform ?? "").trim() || "Zoom",
    platformLink: platformUsesMeetingLink(context.platform)
      ? (context.platformLink ?? "").trim() || "https://zoom.us/j/example"
      : "",
  };

  return String(template ?? "").replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    return replacements[key] ?? "";
  });
}

function defaultMessageHtml(text: string) {
  return `<p>${escapeHtml(text)}</p>`;
}

export function getDefaultEmailFlowTemplate(
  flowKey: EmailFlowKey,
  eventName = "this event"
): EmailFlowTemplate {
  const name = eventName.trim() || "this event";

  switch (flowKey) {
    case "waitlist":
      return {
        subject: "Waitlist: {{eventName}} • {{eventDate}}",
        messageHtml: defaultMessageHtml(
          `Thank you for registering for ${name}. You're on the waitlist — we'll email you once your seat is confirmed.`
        ),
        actionText:
          "No calendar invite yet — we'll send one when your seat is confirmed.",
      };
    case "waitlist_confirmation":
      return {
        subject: "Confirmed: {{eventName}} • {{eventDate}}",
        messageHtml: defaultMessageHtml(`Great news! Your seat for ${name} has been confirmed.`),
        actionText:
          "Your calendar invite is attached (.ics). Add it to your calendar and join with the link below.",
      };
    case "waitlist_rejection":
      return {
        subject: "Waitlist update: {{eventName}} • {{eventDate}}",
        messageHtml: defaultMessageHtml(
          `Thank you for your interest in ${name}. Unfortunately we couldn't confirm a seat this time.`
        ),
        actionText: "You're welcome to register for a future event.",
      };
    case "reminder":
      return {
        subject: "Reminder: {{eventName}} • {{eventDate}}",
        messageHtml: defaultMessageHtml(`Just a quick reminder for ${name}.`),
        actionText: "Tap Accept invite below to confirm you're going.",
      };
    case "invite":
      return {
        subject: "Invitation: {{eventName}} • {{eventDate}}",
        messageHtml: defaultMessageHtml(`We'd love to have you join ${name}.`),
        actionText: "Tap Accept invite below to confirm you're going.",
      };
    case "registration":
    default:
      return {
        subject: "Invitation: {{eventName}} • {{eventDate}}",
        messageHtml: defaultMessageHtml(`Thank you for registering for ${name}.`),
        actionText: "Tap Accept invite below to confirm you're going.",
      };
  }
}

export function getEmailFlowHeading(flowKey: EmailFlowKey): string {
  switch (flowKey) {
    case "waitlist":
      return "You're on the waitlist";
    case "waitlist_confirmation":
      return "Your seat is confirmed";
    case "waitlist_rejection":
      return "Waitlist update";
    case "reminder":
      return "Event reminder";
    case "invite":
      return "You're invited";
    case "registration":
    default:
      return "Thanks for registering";
  }
}

export function getEmailFlowsForFormat(eventFormat: EventFormat): EmailFlowDefinition[] {
  if (isWaitlistedWebinarFormat(eventFormat)) {
    return [
      {
        id: "invite",
        label: "Invite",
        description: "Sent when you invite contacts from Invite to / Invited.",
        includesGoingButton: true,
        includesCalendarInvite: true,
      },
      {
        id: "waitlist",
        label: "Waitlist",
        description: "Sent when someone joins the waitlist from the public page.",
        includesGoingButton: false,
        includesCalendarInvite: false,
      },
      {
        id: "waitlist_confirmation",
        label: "Confirmed",
        description: "Sent when you confirm a waitlisted guest.",
        includesGoingButton: false,
        includesCalendarInvite: true,
      },
      {
        id: "waitlist_rejection",
        label: "Rejected",
        description: "Sent when you reject a waitlisted guest.",
        includesGoingButton: false,
        includesCalendarInvite: false,
      },
      {
        id: "reminder",
        label: "Reminder",
        description: "Sent automatically before the event (1 day / 1 hour).",
        includesGoingButton: true,
        includesCalendarInvite: true,
      },
    ];
  }

  if (isSharedSessionFormat(eventFormat)) {
    return [
      {
        id: "invite",
        label: "Invite",
        description: "Sent when you invite contacts from Invite to / Invited.",
        includesGoingButton: true,
        includesCalendarInvite: true,
      },
      {
        id: "registration",
        label: "Registration",
        description: "Sent when someone registers on the public page.",
        includesGoingButton: false,
        includesCalendarInvite: true,
      },
      {
        id: "reminder",
        label: "Reminder",
        description: "Sent automatically before the event (1 day / 1 hour).",
        includesGoingButton: true,
        includesCalendarInvite: true,
      },
    ];
  }

  return [
    {
      id: "registration",
      label: "Registration",
      description: "Sent when someone books a slot on the public page.",
      includesGoingButton: false,
      includesCalendarInvite: true,
    },
    {
      id: "reminder",
      label: "Reminder",
      description: "Sent automatically before the booked meeting (1 day / 1 hour).",
      includesGoingButton: false,
      includesCalendarInvite: true,
    },
  ];
}

function sanitizeFlowTemplate(
  input: unknown,
  flowKey: EmailFlowKey,
  eventName: string
): EmailFlowTemplate {
  const defaults = getDefaultEmailFlowTemplate(flowKey, eventName);
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const subject =
    typeof raw.subject === "string" && raw.subject.trim()
      ? raw.subject.trim().slice(0, 240)
      : defaults.subject;
  const messageHtml = sanitizeEmailFlowHtml(
    typeof raw.messageHtml === "string" ? raw.messageHtml : defaults.messageHtml
  );
  const actionText =
    typeof raw.actionText === "string" && raw.actionText.trim()
      ? raw.actionText.trim().slice(0, 500)
      : defaults.actionText;

  return { subject, messageHtml, actionText };
}

export function normalizeEventEmailFlows(
  input: unknown,
  eventFormat: EventFormat,
  eventName = ""
): EventEmailFlows {
  const flows: EventEmailFlows = {};
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  for (const definition of getEmailFlowsForFormat(eventFormat)) {
    flows[definition.id] = sanitizeFlowTemplate(raw[definition.id], definition.id, eventName);
  }

  return flows;
}

export function resolveEmailFlowTemplate(
  event: { eventName?: string; emailFlows?: EventEmailFlows | null },
  flowKey: EmailFlowKey
): EmailFlowTemplate {
  const defaults = getDefaultEmailFlowTemplate(flowKey, event.eventName ?? "");
  const stored = event.emailFlows?.[flowKey];
  if (!stored) {
    return defaults;
  }

  return {
    subject: stored.subject?.trim() || defaults.subject,
    messageHtml: stored.messageHtml?.trim() ? stored.messageHtml : defaults.messageHtml,
    actionText: stored.actionText?.trim() || defaults.actionText,
  };
}

export function variantToEmailFlowKey(
  variant: "registration" | "reminder" | "waitlist" | "waitlist_confirmation" | "waitlist_rejection",
  options?: { fromInviteRoute?: boolean }
): EmailFlowKey {
  if (variant === "reminder" && options?.fromInviteRoute) {
    return "invite";
  }
  return variant;
}

export const LOCKED_GOING_BUTTON_HTML = `<a href="#" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:999px;line-height:1.2;pointer-events:none;">Accept invite</a>`;

export function buildEmailFlowPreviewHtml(
  flowKey: EmailFlowKey,
  template: EmailFlowTemplate,
  context: EmailFlowPreviewContext,
  options?: { includesGoingButton?: boolean; bannerUrl?: string; brandName?: string; brandLogoUrl?: string; eventDateYmd?: string }
) {
  void flowKey;
  const eventName = applyEmailFlowPlaceholders("{{eventName}}", context);
  const displayDate = applyEmailFlowPlaceholders("{{eventDate}}", context);
  const displayTime = applyEmailFlowPlaceholders("{{eventTime}}", context);
  const messageHtml = applyEmailFlowPlaceholders(template.messageHtml, context);
  const showGoingButton = options?.includesGoingButton ?? false;
  const brandName = String(options?.brandName ?? "Event").trim() || "Event";
  const brandLogoUrl = String(options?.brandLogoUrl ?? options?.bannerUrl ?? "").trim();
  const eventDateYmd = String(options?.eventDateYmd ?? "").trim();

  return buildInviteAnnouncementHtml({
    brandName,
    brandLogoUrl,
    eventName,
    eventDateYmd,
    displayDate,
    displayTime,
    platform: (context.platform ?? "").trim() || "Zoom",
    messageHtml,
    acceptInviteUrl: showGoingButton ? "#" : undefined,
    viewEventUrl: "#",
    declineUrl: "#",
  });
}
