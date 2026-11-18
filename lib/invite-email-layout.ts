import { isEmailBannerUsable } from "@/lib/email-banner";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function inviteDateBadge(eventDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(eventDate ?? "").trim());
  if (!match) {
    return { month: "EVT", day: "—" };
  }
  const monthIndex = Number(match[2]) - 1;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return {
    month: months[monthIndex] ?? "EVT",
    day: String(Number(match[3])),
  };
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const DIVIDER = `<div style="height:1px;background:#e5e7eb;margin:22px 0;line-height:1;font-size:0;">&nbsp;</div>`;

function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Skip flow copy that only repeats the built-in "You're invited to …" line. */
function isRedundantInviteMessage(messageHtml: string, eventName: string) {
  const plain = htmlToPlainText(messageHtml).toLowerCase();
  if (!plain) {
    return true;
  }
  const name = eventName.trim().toLowerCase();
  const normalized = plain.replace(/[.“”"']/g, "").replace(/\s+/g, " ").trim();
  const inviteOnly = `you're invited to ${name}`.replace(/\s+/g, " ").trim();
  return (
    normalized === inviteOnly ||
    normalized === `${inviteOnly}.` ||
    normalized === `youre invited to ${name}` ||
    normalized === `youre invited to ${name}.`
  );
}

function brandRowHtml(brandName: string, logoUrl: string) {
  const brand = escapeHtml(brandName.trim() || "Event");
  const logo = logoUrl.trim();
  const showLogo = isEmailBannerUsable(logo);
  const logoHtml = showLogo
    ? `<img src="${escapeHtml(logo)}" alt="" width="28" height="28" style="display:block;width:28px;height:28px;border-radius:999px;object-fit:cover;border:0;" />`
    : `<div style="width:28px;height:28px;border-radius:999px;background:#111111;"></div>`;

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`,
    `<tr>`,
    `<td style="vertical-align:middle;padding:0 10px 0 0;">${logoHtml}</td>`,
    `<td style="vertical-align:middle;font-size:14px;font-weight:600;color:#6b7280;letter-spacing:0.01em;">${brand}</td>`,
    `</tr>`,
    `</table>`,
  ].join("");
}

function dateBlockHtml(input: {
  eventDateYmd: string;
  displayDate: string;
  displayTime: string;
}) {
  const badge = inviteDateBadge(input.eventDateYmd);

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`,
    `<tr>`,
    `<td style="vertical-align:top;padding:0 14px 0 0;">`,
    `<div style="width:52px;height:52px;border-radius:12px;border:1px solid #e5e7eb;background:#ffffff;text-align:center;overflow:hidden;">`,
    `<div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:#111111;padding-top:8px;line-height:1;">${escapeHtml(badge.month)}</div>`,
    `<div style="font-size:18px;font-weight:700;color:#111827;line-height:1.2;padding-top:2px;">${escapeHtml(badge.day)}</div>`,
    `</div>`,
    `</td>`,
    `<td style="vertical-align:middle;">`,
    `<div style="font-size:16px;font-weight:700;color:#111827;line-height:1.3;">${escapeHtml(input.displayDate)}</div>`,
    `<div style="font-size:14px;color:#6b7280;margin-top:4px;line-height:1.4;">${escapeHtml(input.displayTime)}</div>`,
    `</td>`,
    `</tr>`,
    `</table>`,
  ].join("");
}

function platformIconFile(_platform: string) {
  return "platform-video.png";
}

/** `cid` embeds the icon in the sent mail. A blank base uses the local public file for previews. */
function platformIconSrc(platform: string, assetBaseUrl?: string) {
  const file = platformIconFile(platform);
  if (assetBaseUrl === "cid") {
    return `cid:${file.replace(/\.png$/, "")}`;
  }
  const base = String(assetBaseUrl ?? "").replace(/\/$/, "");
  return base ? `${base}/email/${file}` : `/email/${file}`;
}

/** Separate platform row: video icon + platform name. */
function platformBlockHtml(platformRaw?: string, assetBaseUrl?: string) {
  const platform = String(platformRaw ?? "").trim();
  if (!platform) {
    return "";
  }
  const src = platformIconSrc(platform, assetBaseUrl);

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;">`,
    `<tr>`,
    `<td width="52" valign="middle" style="width:52px;vertical-align:middle;padding:0 14px 0 0;">`,
    `<div style="width:52px;height:52px;border-radius:12px;border:1px solid #e5e7eb;background:#ffffff;text-align:center;line-height:52px;font-size:0;">`,
    `<img src="${escapeHtml(src)}" width="28" height="28" alt="" style="display:inline-block;width:28px;height:28px;border:0;outline:none;vertical-align:middle;" />`,
    `</div>`,
    `</td>`,
    `<td valign="middle" style="vertical-align:middle;font-size:15px;font-weight:600;color:#111827;line-height:1.3;">${escapeHtml(platform)}</td>`,
    `</tr>`,
    `</table>`,
  ].join("");
}

/** Flat Luma-style invite announcement email (no card shell). */
export function buildInviteAnnouncementHtml(input: {
  brandName: string;
  brandLogoUrl?: string;
  eventName: string;
  eventDateYmd: string;
  displayDate: string;
  displayTime: string;
  platform?: string;
  assetBaseUrl?: string;
  messageHtml?: string;
  acceptInviteUrl?: string;
  viewEventUrl?: string;
  declineUrl?: string;
}) {
  const acceptUrl = String(input.acceptInviteUrl ?? "").trim();
  const viewUrl = String(input.viewEventUrl ?? "").trim();
  const declineUrl = String(input.declineUrl ?? viewUrl).trim();
  const rawMessageHtml = String(input.messageHtml ?? "").trim();
  const eventName = escapeHtml(input.eventName);
  const messageHtml =
    rawMessageHtml && !isRedundantInviteMessage(rawMessageHtml, input.eventName)
      ? rawMessageHtml
      : "";

  const acceptButton = acceptUrl
    ? `<a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:999px;line-height:1.2;">Accept invite</a>`
    : "";
  const viewButton = viewUrl
    ? `<a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#f3f4f6;color:#374151;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:999px;line-height:1.2;margin-left:10px;">View Event</a>`
    : "";

  return [
    `<div style="background:#ffffff;padding:32px 24px;font-family:${FONT};color:#111827;">`,
    `<div style="max-width:560px;margin:0 auto;">`,
    brandRowHtml(input.brandName, String(input.brandLogoUrl ?? "")),
    DIVIDER,
    `<p style="margin:0;font-size:16px;line-height:1.5;color:#6b7280;">You're invited to <span style="color:#111827;font-weight:600;">${eventName}</span>.</p>`,
    messageHtml
      ? `<div style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:#4b5563;">${messageHtml}</div>`
      : "",
    DIVIDER,
    dateBlockHtml({
      eventDateYmd: input.eventDateYmd,
      displayDate: input.displayDate,
      displayTime: input.displayTime,
    }),
    platformBlockHtml(input.platform, input.assetBaseUrl),
    acceptButton || viewButton
      ? `<div style="margin-top:24px;">${acceptButton}${viewButton}</div>`
      : "",
    declineUrl
      ? `<p style="margin:18px 0 0 0;font-size:13px;line-height:1.5;color:#9ca3af;">Can’t make it? <a href="${escapeHtml(declineUrl)}" style="color:#111111;text-decoration:none;font-weight:600;">Decline the invite</a> to stop receiving emails about this event.</p>`
      : "",
    `</div>`,
    `</div>`,
  ].join("");
}

/** One agenda point per non-empty line. */
export function parseCalendarInviteAgenda(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*]\s+/, "").trim())
    .filter(Boolean);
}

/** Flat calendar invite email — same simple layout as the invite announcement. */
export function buildCalendarInviteAnnouncementHtml(input: {
  brandName: string;
  brandLogoUrl?: string;
  eventName: string;
  eventDateYmd: string;
  displayDate: string;
  displayTime: string;
  platform?: string;
  platformLink?: string;
  assetBaseUrl?: string;
  agendaItems?: string[];
  eyebrow?: string;
  introHtml?: string;
  viewEventUrl?: string;
  footerNote?: string;
}) {
  void input.platformLink;
  const viewUrl = String(input.viewEventUrl ?? "").trim();
  const eyebrow = String(input.eyebrow ?? "Calendar invite").trim() || "Calendar invite";
  const introHtml = String(input.introHtml ?? "").trim();
  const footerNote = String(input.footerNote ?? "").trim();
  const eventName = escapeHtml(input.eventName);
  const agendaItems = (input.agendaItems ?? [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);

  const viewButton = viewUrl
    ? `<a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:999px;line-height:1.2;">View Event</a>`
    : "";

  const agendaHtml = agendaItems.length
    ? [
        `<div style="margin:0;">`,
        `<div style="font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:10px;">Agenda</div>`,
        `<ul style="margin:0;padding:0 0 0 18px;font-size:15px;line-height:1.65;color:#4b5563;">`,
        ...agendaItems.map(
          (item) => `<li style="margin:0 0 6px 0;padding:0;">${escapeHtml(item)}</li>`
        ),
        `</ul>`,
        `</div>`,
      ].join("")
    : "";

  return [
    `<div style="background:#ffffff;padding:32px 24px;font-family:${FONT};color:#111827;">`,
    `<div style="max-width:560px;margin:0 auto;">`,
    brandRowHtml(input.brandName, String(input.brandLogoUrl ?? "")),
    DIVIDER,
    `<p style="margin:0;font-size:16px;line-height:1.5;color:#6b7280;">${escapeHtml(eyebrow)} for <span style="color:#111827;font-weight:600;">${eventName}</span>.</p>`,
    introHtml
      ? `<div style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:#4b5563;">${introHtml}</div>`
      : "",
    agendaHtml ? `${DIVIDER}${agendaHtml}` : "",
    DIVIDER,
    dateBlockHtml({
      eventDateYmd: input.eventDateYmd,
      displayDate: input.displayDate,
      displayTime: input.displayTime,
    }),
    platformBlockHtml(input.platform, input.assetBaseUrl),
    viewButton ? `<div style="margin-top:24px;">${viewButton}</div>` : "",
    footerNote
      ? `<p style="margin:18px 0 0 0;font-size:13px;line-height:1.5;color:#9ca3af;">${escapeHtml(footerNote)}</p>`
      : "",
    `</div>`,
    `</div>`,
  ].join("");
}
