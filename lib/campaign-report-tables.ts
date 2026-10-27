import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";
import {
  formatEngagementDevice,
  isEngagementDevice,
} from "@/lib/engagement-client-meta";
import {
  OPEN_PIXEL_BLOCKED_TAG,
  sendCountsAsOpen,
  sendOpenPixelBlocked,
} from "@/lib/open-pixel";
import { BOT_CLICK_TAG, sendIsBotClick } from "@/lib/bot-click";
import { BOT_OPEN_TAG, sendIsBotOnlyOpen, sendIsBotOpen } from "@/lib/bot-open";

export const REPORT_DASH = "—";

export type ReportSentRow = {
  name: string;
  email: string;
  company: string;
  domain: string;
  step: string;
  date: string;
  time: string;
};

export type ReportEngageRow = {
  name: string;
  email: string;
  company: string;
  domain: string;
  openDate: string;
  openTime: string;
  openDevice: string;
  clickDevice: string;
  /** Client IP from the counted click (Clickers); dash when unknown / opens-only. */
  clickIp: string;
  opens: number;
  clicks: number;
  cta: string;
  status: "Clicked" | "Opened";
  /** e.g. "Bot open" / "Open not tracked". */
  openTag: string;
  /**
   * e.g. "Bot click" when Show bot opens/clicks is on and this clicker is bot/scanner.
   * Empty dash when bots are hidden or not a bot.
   */
  clickTag: string;
};

export type ReportBounceRow = {
  name: string;
  email: string;
  company: string;
  domain: string;
  reason: string;
  date: string;
  time: string;
};

export type ReportUnsubscribeRow = {
  name: string;
  email: string;
  company: string;
  domain: string;
  reason: string;
  date: string;
  time: string;
};

export type ReportCompanyRow = {
  company: string;
  domain: string;
  contacts: number;
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  openRate: string;
  clickRate: string;
};

export type CampaignReportTables = {
  campaignName: string;
  sentLong: string;
  summary: Array<[string, string | number]>;
  companies: ReportCompanyRow[];
  sent: ReportSentRow[];
  clickers: ReportEngageRow[];
  /** Everyone who counts as an open (pixel + click-inferred). */
  opensOnly: ReportEngageRow[];
  bounces: ReportBounceRow[];
  unsubscribes: ReportUnsubscribeRow[];
  unsubscribed: number;
  totals: { sent: number; opens: number; clicks: number };
};

export function asDate(value?: Date | string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string, kind: "parts" | "long") {
  const key = `${kind}:${timeZone}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter =
      kind === "long"
        ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone })
        : new Intl.DateTimeFormat("en-GB", {
            timeZone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });
    formatters.set(key, formatter);
  }
  return formatter;
}

export function formatInZone(
  value: Date | string | undefined,
  timeZone: string,
  kind: "date" | "time" | "long",
) {
  const date = asDate(value);
  if (!date) return "";
  if (kind === "long") return zoneFormatter(timeZone, "long").format(date);
  const parts = zoneFormatter(timeZone, "parts").formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  if (kind === "date") return `${pick("day")}-${pick("month")}-${pick("year")}`;
  return `${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function personName(send: CampaignSendDoc) {
  return (
    send.fullName ||
    `${send.firstName ?? ""} ${send.lastName ?? ""}`.trim() ||
    send.email
  ).trim();
}

function stepLabel(send: CampaignSendDoc) {
  return `Email Step ${typeof send.sequenceIndex === "number" ? send.sequenceIndex + 1 : 1}`;
}

function isHardBounce(error?: string) {
  const text = String(error ?? "").toLowerCase();
  if (!text) return false;
  return /550|551|552|553|554|5\.1\.|permanent|does not exist|user unknown|unknown user|invalid mailbox|mailbox unavailable|recipient rejected|no such user|address rejected|unrouteable/.test(
    text,
  );
}

function ctaLabel(send: CampaignSendDoc) {
  if (send.clickedUrl?.trim()) {
    try {
      const parsed = new URL(send.clickedUrl);
      const path = parsed.pathname === "/" ? "" : parsed.pathname;
      return `${parsed.hostname}${path}${parsed.search}`.slice(0, 80);
    } catch {
      return send.clickedUrl.slice(0, 80);
    }
  }
  if (send.clickEvents?.length) {
    return send.clickEvents
      .map((event) => event.url)
      .filter(Boolean)
      .slice(0, 2)
      .join(" + ")
      .slice(0, 80);
  }
  return REPORT_DASH;
}

function labelDevice(value?: string) {
  if (!isEngagementDevice(value) || value === "unknown") {
    return REPORT_DASH;
  }
  return formatEngagementDevice(value) || REPORT_DASH;
}

function openDeviceFromGroup(group: CampaignSendDoc[]) {
  const withOpen = [...group]
    .filter((item) => sendCountsAsOpen(item))
    .sort((a, b) => {
      const left =
        asDate(a.openedAt)?.getTime() ??
        asDate(a.clickedAt)?.getTime() ??
        Number.POSITIVE_INFINITY;
      const right =
        asDate(b.openedAt)?.getTime() ??
        asDate(b.clickedAt)?.getTime() ??
        Number.POSITIVE_INFINITY;
      return left - right;
    })[0];
  if (!withOpen) {
    return REPORT_DASH;
  }
  const fromEvent = withOpen.openEvents?.[0]?.device;
  return labelDevice(fromEvent || withOpen.openedDevice);
}

function firstCountedClick(group: CampaignSendDoc[]) {
  return [...group]
    .filter((item) => item.clickedAt || (item.clickCount || 0) > 0)
    .sort((a, b) => {
      const left = asDate(a.clickedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      const right = asDate(b.clickedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      return left - right;
    })[0];
}

function clickDeviceFromGroup(group: CampaignSendDoc[]) {
  const withClick = firstCountedClick(group);
  if (!withClick) {
    return REPORT_DASH;
  }
  const fromEvent = withClick.clickEvents?.find((event) => !event.ignored)?.device;
  return labelDevice(fromEvent || withClick.clickedDevice);
}

function clickIpFromGroup(group: CampaignSendDoc[]) {
  const withClick = firstCountedClick(group);
  if (!withClick) {
    return REPORT_DASH;
  }
  const fromEvent = withClick.clickEvents?.find(
    (event) => !event.ignored && event.ip?.trim(),
  )?.ip;
  const ip = (fromEvent || withClick.clickedIp || "").trim();
  return ip || REPORT_DASH;
}

function percent(part: number, total: number) {
  return total ? `${Math.round((part / total) * 100)}%` : "0%";
}

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

export function buildCampaignReportTables({
  campaignName,
  timezone,
  sentAt,
  sends,
  hideBotClicks = false,
}: {
  campaignName: string;
  timezone: string;
  sentAt?: string | Date;
  sends: CampaignSendDoc[];
  /** When true, exclude bot opens/clicks from Opens / Clickers (and export). */
  hideBotClicks?: boolean;
}): CampaignReportTables {
  const timeZone = timezone || "Asia/Kolkata";
  const sentDate =
    asDate(sentAt) ?? sends.map((send) => asDate(send.sentAt)).find(Boolean) ?? null;
  const sentLong = sentDate ? formatInZone(sentDate, timeZone, "long") : REPORT_DASH;

  const delivered = sends.filter((send) => send.status === "sent");
  const bouncedSends = sends.filter(
    (send) => send.status === "failed" && send.error !== "Unsubscribed",
  );
  const unsubscribedSends = sends.filter(
    (send) => Boolean(send.unsubscribedAt) || send.error === "Unsubscribed",
  );

  const byEmail = new Map<string, CampaignSendDoc[]>();
  for (const send of delivered) {
    const key = emailKey(send.email);
    const list = byEmail.get(key) ?? [];
    list.push(send);
    byEmail.set(key, list);
  }

  const engaged: Array<ReportEngageRow & { openedAtMs: number }> = [];
  for (const group of byEmail.values()) {
    const humanClick = group.some(
      (item) =>
        ((item.clickCount || 0) > 0 || item.clickedAt) &&
        !item.clickBurstIgnored &&
        !sendIsBotClick(item),
    );
    const anyClick = group.some(
      (item) =>
        ((item.clickCount || 0) > 0 || item.clickedAt) && !item.clickBurstIgnored,
    );
    const clicks =
      hideBotClicks ? (humanClick ? 1 : 0) : anyClick ? 1 : 0;
    const countsAsOpen = group.some((item) => sendCountsAsOpen(item));
    if (!countsAsOpen && clicks <= 0) continue;
    const opened =
      group
        .map((item) => asDate(item.openedAt) ?? asDate(item.clickedAt))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const primary =
      group.find(
        (item) =>
          ((item.clickCount || 0) > 0 || item.clickedAt) &&
          (!hideBotClicks || !sendIsBotClick(item)),
      ) ??
      group.find((item) => item.clickCount > 0) ??
      group.find((item) => sendCountsAsOpen(item)) ??
      group[0];
    const pixelBlocked = group.some((item) => sendOpenPixelBlocked(item));
    const botOpen = group.some((item) => sendCountsAsOpen(item) && sendIsBotOpen(item));
    const countsAsHumanOpen = group.some(
      (item) =>
        sendCountsAsOpen(item) && !(hideBotClicks && sendIsBotOnlyOpen(item)),
    );
    if (hideBotClicks && !countsAsHumanOpen && clicks <= 0) {
      // Pure bot opens (no human click) omitted when Show bot opens/clicks is off.
      continue;
    }
    const botClick =
      !hideBotClicks &&
      clicks > 0 &&
      group.some(
        (item) =>
          ((item.clickCount || 0) > 0 || item.clickedAt) &&
          !item.clickBurstIgnored &&
          sendIsBotClick(item),
      );
    const openCountSum = group.reduce((sum, item) => {
      if (hideBotClicks && sendIsBotOnlyOpen(item)) {
        return sum;
      }
      if (sendCountsAsOpen(item)) {
        return sum + Math.max(item.openCount || 0, 1);
      }
      return sum;
    }, 0);
    const openTags: string[] = [];
    if (!hideBotClicks && botOpen) {
      openTags.push(BOT_OPEN_TAG);
    }
    if (pixelBlocked) {
      openTags.push(OPEN_PIXEL_BLOCKED_TAG);
    }
    engaged.push({
      name: personName(primary),
      email: primary.email,
      company: primary.companyName || "",
      domain: emailDomain(primary.email),
      openDate: formatInZone(opened ?? undefined, timeZone, "date"),
      openTime: formatInZone(opened ?? undefined, timeZone, "time"),
      openDevice: openDeviceFromGroup(group),
      clickDevice: clicks > 0 ? clickDeviceFromGroup(group) : REPORT_DASH,
      clickIp: clicks > 0 ? clickIpFromGroup(group) : REPORT_DASH,
      opens: openCountSum || (countsAsHumanOpen ? 1 : 0),
      clicks,
      cta: clicks ? ctaLabel(primary) : REPORT_DASH,
      status: clicks ? "Clicked" : "Opened",
      openTag: openTags.length > 0 ? openTags.join(" · ") : REPORT_DASH,
      clickTag: botClick ? BOT_CLICK_TAG : REPORT_DASH,
      openedAtMs: opened?.getTime() ?? 0,
    });
  }
  engaged.sort((a, b) =>
    a.openedAtMs !== b.openedAtMs ? a.openedAtMs - b.openedAtMs : a.email.localeCompare(b.email),
  );
  const strip = ({ openedAtMs: _skip, ...row }: ReportEngageRow & { openedAtMs: number }) => {
    void _skip;
    return row;
  };
  const clickers = engaged.filter((row) => row.clicks > 0).map(strip);
  // All opens (including clickers / pixel-blocked inferred opens).
  // Opens sheet always uses Opened — Clicked stays on the Clickers section.
  const opensOnly = engaged
    .filter((row) => row.opens > 0)
    .map(strip)
    .map((row) => ({
      ...row,
      status: "Opened" as const,
      clickTag: REPORT_DASH,
    }));

  const sent = [...delivered]
    .sort((a, b) => {
      const left = asDate(a.sentAt)?.getTime() ?? 0;
      const right = asDate(b.sentAt)?.getTime() ?? 0;
      return left !== right ? left - right : personName(a).localeCompare(personName(b));
    })
    .map((send) => ({
      name: personName(send),
      email: send.email,
      company: send.companyName || "",
      domain: emailDomain(send.email),
      step: stepLabel(send),
      date: formatInZone(send.sentAt, timeZone, "date"),
      time: formatInZone(send.sentAt, timeZone, "time"),
    }));

  const bounces = bouncedSends.map((send) => {
    const eventAt = asDate(send.sentAt) ?? send._id.getTimestamp();
    return {
      name: personName(send),
      email: send.email,
      company: send.companyName || "",
      domain: emailDomain(send.email),
      reason:
        send.error?.trim() || (isHardBounce(send.error) ? "Hard bounce" : "Delivery failed"),
      date: formatInZone(eventAt, timeZone, "date"),
      time: formatInZone(eventAt, timeZone, "time"),
    };
  });

  const unsubscribesByEmail = new Map<string, CampaignSendDoc>();
  for (const send of unsubscribedSends) {
    const key = emailKey(send.email);
    if (!key) continue;
    const existing = unsubscribesByEmail.get(key);
    if (!existing || (send.unsubscribedAt && !existing.unsubscribedAt)) {
      unsubscribesByEmail.set(key, send);
    }
  }
  const unsubscribes = [...unsubscribesByEmail.values()]
    .sort((a, b) => personName(a).localeCompare(personName(b)) || a.email.localeCompare(b.email))
    .map((send) => {
      const eventAt = asDate(send.unsubscribedAt);
      return {
        name: personName(send),
        email: send.email,
        company: send.companyName || "",
        domain: emailDomain(send.email),
        reason: send.unsubscribedAt ? "Unsubscribed" : "On unsubscribe list",
        date: eventAt ? formatInZone(eventAt, timeZone, "date") : "",
        time: eventAt ? formatInZone(eventAt, timeZone, "time") : "",
      };
    });

  const openedEmails = new Set(engaged.filter((row) => row.opens > 0).map((row) => emailKey(row.email)));
  const clickedEmails = new Set(clickers.map((row) => emailKey(row.email)));
  const bouncedEmails = new Set(bouncedSends.map((send) => emailKey(send.email)));
  const unsubEmails = new Set(unsubscribedSends.map((send) => emailKey(send.email)));
  const deliveredEmails = new Set(byEmail.keys());

  type CompanyGroup = { name: string; emails: Set<string>; domains: Map<string, number> };
  const companies = new Map<string, CompanyGroup>();
  for (const send of sends) {
    const email = emailKey(send.email);
    if (!email) continue;
    const domain = emailDomain(email);
    const name = send.companyName?.trim() || "";
    const key = name ? `c:${name.toLowerCase()}` : `d:${domain}`;
    const group = companies.get(key) ?? { name, emails: new Set(), domains: new Map() };
    group.emails.add(email);
    if (domain) group.domains.set(domain, (group.domains.get(domain) ?? 0) + 1);
    companies.set(key, group);
  }
  const companyRows: ReportCompanyRow[] = [...companies.values()]
    .map((group) => {
      const emails = [...group.emails];
      const count = (set: Set<string>) => emails.filter((email) => set.has(email)).length;
      const domain = [...group.domains.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const sentCount = count(deliveredEmails);
      const opened = emails.filter(
        (email) => openedEmails.has(email) || clickedEmails.has(email),
      ).length;
      const clicked = count(clickedEmails);
      return {
        company: group.name || domain || REPORT_DASH,
        domain: domain || REPORT_DASH,
        contacts: emails.length,
        sent: sentCount,
        opened,
        clicked,
        bounced: count(bouncedEmails),
        unsubscribed: count(unsubEmails),
        openRate: percent(opened, sentCount),
        clickRate: percent(clicked, sentCount),
      };
    })
    .sort(
      (a, b) =>
        b.clicked - a.clicked ||
        b.opened - a.opened ||
        b.contacts - a.contacts ||
        a.company.localeCompare(b.company),
    );

  const uniqueOpens = openedEmails.size;
  const uniqueClicks = clickers.length;
  const totalSent = delivered.length;
  const audience = new Set(sends.map((send) => emailKey(send.email)).filter(Boolean));
  const sequenceSteps = Math.max(
    1,
    ...delivered.map((send) => (typeof send.sequenceIndex === "number" ? send.sequenceIndex + 1 : 1)),
  );
  const generatedLong = formatInZone(new Date(), timeZone, "long");

  return {
    campaignName,
    sentLong,
    summary: [
      ["Campaign", campaignName],
      ["Report Date", generatedLong],
      ["Total Contacts (audience)", audience.size],
      ["Eligible Recipients", Math.max(0, audience.size - unsubscribes.length)],
      ["Unsubscribed", unsubscribes.length],
      ["Total Sent", totalSent],
      ["Unique Opens", uniqueOpens],
      ["Unique Clicks", uniqueClicks],
      ["Bounces", bouncedSends.length],
      ["Open Rate", percent(uniqueOpens, totalSent)],
      ["Click Rate", percent(uniqueClicks, totalSent)],
      ["Sequence Steps", sequenceSteps],
      ["Companies", companyRows.length],
    ],
    companies: companyRows,
    sent,
    clickers,
    opensOnly,
    bounces,
    unsubscribes,
    unsubscribed: unsubscribes.length,
    totals: { sent: totalSent, opens: uniqueOpens, clicks: uniqueClicks },
  };
}
