import ExcelJS from "exceljs";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";

const COLORS = {
  page: "FFEEF0F3",
  black: "FF000000",
  header: "FFEBEBEB",
  click: "FFEFF6EE",
  clickStatus: "FFD4EDDA",
  open: "FFEEF3FB",
  openStatus: "FFD0E4F8",
  soft: "FFFEF9EC",
  softStatus: "FFFDE8A0",
  hard: "FFFDEEEE",
  unsub: "FFF5F0FB",
  ink: "FF1A1A1A",
  muted: "FF888888",
  section: "FFAAAAAA",
  headerInk: "FF404040",
  green: "FF276B3A",
  blue: "FF1A4F8A",
  gold: "FF7A5C00",
};

const DASH = "—";

type FontStyle = Partial<ExcelJS.Font>;
type FillArgb = string;

type CellStyle = {
  fill: FillArgb;
  font: FontStyle;
};

function solid(argb: FillArgb): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function font(overrides: FontStyle): FontStyle {
  return { name: "Calibri", size: 9, color: { argb: COLORS.ink }, ...overrides };
}

const STYLES = {
  page: { fill: COLORS.page, font: font({ size: 11 }) },
  title: {
    fill: COLORS.page,
    font: font({ size: 14, bold: true, color: { argb: COLORS.ink } }),
  },
  subtitle: {
    fill: COLORS.page,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  sectionBar: { fill: COLORS.black, font: font({ size: 11 }) },
  sectionTitle: {
    fill: COLORS.black,
    font: font({ size: 7, bold: true, color: { argb: COLORS.section } }),
  },
  tableHeader: {
    fill: COLORS.header,
    font: font({ size: 8, bold: true, color: { argb: COLORS.headerInk } }),
  },
  clickMuted: {
    fill: COLORS.click,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  clickName: {
    fill: COLORS.click,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  clickBody: {
    fill: COLORS.click,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  clickInk: {
    fill: COLORS.click,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  clickGreen: {
    fill: COLORS.click,
    font: font({ size: 9, bold: true, color: { argb: COLORS.green } }),
  },
  clickStatus: {
    fill: COLORS.clickStatus,
    font: font({ size: 8, bold: true, color: { argb: COLORS.green } }),
  },
  openMuted: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  openName: {
    fill: COLORS.open,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  openBody: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  openInk: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  openCta: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.section } }),
  },
  openStatus: {
    fill: COLORS.openStatus,
    font: font({ size: 8, bold: true, color: { argb: COLORS.blue } }),
  },
  softMuted: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  softName: {
    fill: COLORS.soft,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  softBody: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  softInk: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  softGold: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.gold } }),
  },
  softStatus: {
    fill: COLORS.softStatus,
    font: font({ size: 8, bold: true, color: { argb: COLORS.gold } }),
  },
  hardMuted: {
    fill: COLORS.hard,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  hardName: {
    fill: COLORS.hard,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  hardBody: {
    fill: COLORS.hard,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  hardInk: {
    fill: COLORS.hard,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  hardStatus: {
    fill: COLORS.hard,
    font: font({ size: 8, bold: true, color: { argb: COLORS.gold } }),
  },
  unsubName: {
    fill: COLORS.unsub,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  unsubBody: {
    fill: COLORS.unsub,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  unsubMuted: {
    fill: COLORS.unsub,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  unsubInk: {
    fill: COLORS.unsub,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  summaryName: {
    fill: COLORS.open,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  summaryBody: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  summaryMuted: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  summaryInk: {
    fill: COLORS.open,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  summaryGreen: {
    fill: COLORS.open,
    font: font({ size: 9, bold: true, color: { argb: COLORS.green } }),
  },
  clicksName: {
    fill: COLORS.click,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  clicksBody: {
    fill: COLORS.click,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  clicksMuted: {
    fill: COLORS.click,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  clicksGreen: {
    fill: COLORS.click,
    font: font({ size: 9, bold: true, color: { argb: COLORS.green } }),
  },
  hardSummaryName: {
    fill: COLORS.hard,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  hardSummaryBody: {
    fill: COLORS.hard,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  hardSummaryMuted: {
    fill: COLORS.hard,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  hardSummaryInk: {
    fill: COLORS.hard,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  hardSummaryGreen: {
    fill: COLORS.hard,
    font: font({ size: 9, bold: true, color: { argb: COLORS.green } }),
  },
  softSummaryName: {
    fill: COLORS.soft,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  softSummaryBody: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  softSummaryMuted: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  softSummaryInk: {
    fill: COLORS.soft,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  softSummaryGreen: {
    fill: COLORS.soft,
    font: font({ size: 9, bold: true, color: { argb: COLORS.green } }),
  },
  unsubSummaryName: {
    fill: COLORS.unsub,
    font: font({ size: 9, bold: true, color: { argb: COLORS.ink } }),
  },
  unsubSummaryBody: {
    fill: COLORS.unsub,
    font: font({ size: 9, color: { argb: COLORS.headerInk } }),
  },
  unsubSummaryMuted: {
    fill: COLORS.unsub,
    font: font({ size: 9, color: { argb: COLORS.muted } }),
  },
  unsubSummaryInk: {
    fill: COLORS.unsub,
    font: font({ size: 9, color: { argb: COLORS.ink } }),
  },
  unsubSummaryGreen: {
    fill: COLORS.unsub,
    font: font({ size: 9, bold: true, color: { argb: COLORS.green } }),
  },
} as const satisfies Record<string, CellStyle>;

type PersonRow = {
  name: string;
  email: string;
  company: string;
  domain: string;
  openDate: string;
  openTime: string;
  opens: number;
  clicks: number;
  sendDate: string;
  eventDate: string;
  reason: string;
  openedAtMs: number;
};

function asDate(value?: Date | string) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInZone(
  value: Date | string | undefined,
  timeZone: string,
  kind: "date" | "time" | "long",
) {
  const date = asDate(value);
  if (!date) {
    return "";
  }

  if (kind === "long") {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    }).format(date);
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  if (kind === "date") {
    return `${pick("day")}-${pick("month")}-${pick("year")}`;
  }
  return `${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function personName(send: CampaignSendDoc) {
  return (send.fullName || `${send.firstName} ${send.lastName}`.trim() || send.email).trim();
}

function fallbackDate(send: CampaignSendDoc) {
  return asDate(send.sentAt) ?? send._id.getTimestamp();
}

function isHardBounce(error?: string) {
  const text = String(error ?? "").toLowerCase();
  if (!text) {
    return false;
  }
  return /550|551|552|553|554|5\.1\.|permanent|does not exist|user unknown|unknown user|invalid mailbox|mailbox unavailable|recipient rejected|no such user|address rejected|unrouteable/.test(
    text,
  );
}

function pct(value: number, total: number) {
  if (!total) {
    return DASH;
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}

function vsRange(rate: number, low: number, high: number) {
  if (!Number.isFinite(rate)) {
    return DASH;
  }
  if (rate > high) {
    return "↑ Above";
  }
  if (rate < low) {
    return "↓ Below";
  }
  return "✓ OK";
}

function vsMax(rate: number, max: number) {
  if (!Number.isFinite(rate)) {
    return DASH;
  }
  return rate <= max ? "✓ OK" : "↑ Above";
}

function rateNumber(value: number, total: number) {
  if (!total) {
    return Number.NaN;
  }
  return (value / total) * 100;
}

function mapPerson(send: CampaignSendDoc, timeZone: string): PersonRow {
  const openedAt = asDate(send.openedAt);
  const eventAt = asDate(send.unsubscribedAt) ?? fallbackDate(send);
  return {
    name: personName(send),
    email: send.email,
    company: send.companyName || "",
    domain: emailDomain(send.email),
    openDate: formatInZone(openedAt ?? undefined, timeZone, "date"),
    openTime: formatInZone(openedAt ?? undefined, timeZone, "time"),
    opens: send.openCount > 0 ? 1 : 0,
    clicks: send.clickCount > 0 ? 1 : 0,
    sendDate: formatInZone(fallbackDate(send), timeZone, "date"),
    eventDate: formatInZone(eventAt, timeZone, "date"),
    reason: send.error?.trim() || "Message delivery failed",
    openedAtMs: openedAt?.getTime() ?? 0,
  };
}

function sortPeople(rows: PersonRow[]) {
  return rows.sort((a, b) => {
    if (a.openedAtMs !== b.openedAtMs) {
      return a.openedAtMs - b.openedAtMs;
    }
    return a.name.localeCompare(b.name);
  });
}

function paintCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  style: CellStyle,
) {
  const cell = sheet.getCell(row, col);
  cell.value = value;
  cell.fill = solid(style.fill);
  cell.font = style.font;
  cell.alignment = { horizontal: "left", vertical: "middle" };
}

function paintRange(
  sheet: ExcelJS.Worksheet,
  row: number,
  from: number,
  to: number,
  style: CellStyle,
) {
  for (let col = from; col <= to; col += 1) {
    paintCell(sheet, row, col, sheet.getCell(row, col).value ?? null, style);
  }
}

function setupSheet(
  sheet: ExcelJS.Worksheet,
  lastCol: number,
  widths: number[],
) {
  sheet.properties.defaultRowHeight = 15;
  sheet.views = [{ showGridLines: false, state: "normal" }];
  sheet.pageSetup.orientation = "portrait";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 1;
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getRow(1).height = 9.75;
  paintRange(sheet, 1, 1, lastCol, STYLES.page);
}

function writeTitleBlock(
  sheet: ExcelJS.Worksheet,
  lastCol: number,
  title: string,
  subtitle: string,
) {
  sheet.getRow(2).height = 27.75;
  paintRange(sheet, 2, 1, lastCol, STYLES.page);
  paintCell(sheet, 2, 2, title, STYLES.title);

  sheet.getRow(3).height = 15.75;
  paintRange(sheet, 3, 1, lastCol, STYLES.page);
  paintCell(sheet, 3, 2, subtitle, STYLES.subtitle);

  sheet.getRow(4).height = 7.5;
  sheet.getRow(5).height = 6.75;
}

function writeSectionBar(
  sheet: ExcelJS.Worksheet,
  row: number,
  lastCol: number,
  title: string,
) {
  sheet.getRow(row).height = 12.75;
  paintRange(sheet, row, 1, lastCol, STYLES.sectionBar);
  paintCell(sheet, row, 2, title, STYLES.sectionTitle);
}

function writeHeaderRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  headers: string[],
  startCol = 2,
) {
  sheet.getRow(row).height = 16.5;
  headers.forEach((header, index) => {
    paintCell(sheet, row, startCol + index, header, STYLES.tableHeader);
  });
}

function writeClickerRow(sheet: ExcelJS.Worksheet, row: number, index: number, person: PersonRow) {
  sheet.getRow(row).height = 18;
  const values: Array<[number, ExcelJS.CellValue, CellStyle]> = [
    [2, index, STYLES.clickMuted],
    [3, person.name, STYLES.clickName],
    [4, person.email, STYLES.clickBody],
    [5, person.company, STYLES.clickInk],
    [6, person.domain, STYLES.clickMuted],
    [7, person.openDate, STYLES.clickBody],
    [8, person.openTime, STYLES.clickMuted],
    [9, person.opens, STYLES.clickInk],
    [10, person.clicks, STYLES.clickGreen],
    [11, "Link Clicked", STYLES.clickBody],
    [12, "Clicked", STYLES.clickStatus],
  ];
  values.forEach(([col, value, style]) => paintCell(sheet, row, col, value, style));
}

function writeOpenRow(sheet: ExcelJS.Worksheet, row: number, index: number, person: PersonRow) {
  sheet.getRow(row).height = 18;
  const values: Array<[number, ExcelJS.CellValue, CellStyle]> = [
    [2, index, STYLES.openMuted],
    [3, person.name, STYLES.openName],
    [4, person.email, STYLES.openBody],
    [5, person.company, STYLES.openInk],
    [6, person.domain, STYLES.openMuted],
    [7, person.openDate, STYLES.openBody],
    [8, person.openTime, STYLES.openMuted],
    [9, person.opens, STYLES.openInk],
    [10, person.clicks, STYLES.openMuted],
    [11, DASH, STYLES.openCta],
    [12, "Opened", STYLES.openStatus],
  ];
  values.forEach(([col, value, style]) => paintCell(sheet, row, col, value, style));
}

function writeBounceRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  index: number,
  person: PersonRow,
  kind: "hard" | "soft" | "unsub",
) {
  sheet.getRow(row).height = 18;
  const styles =
    kind === "hard"
      ? {
          muted: STYLES.hardMuted,
          name: STYLES.hardName,
          body: STYLES.hardBody,
          ink: STYLES.hardInk,
          note: STYLES.hardBody,
          status: STYLES.hardStatus,
          statusLabel: "Hard Bounce",
          reason: person.reason || "Permanent failure",
        }
      : kind === "soft"
        ? {
            muted: STYLES.softMuted,
            name: STYLES.softName,
            body: STYLES.softBody,
            ink: STYLES.softInk,
            note: STYLES.softGold,
            status: STYLES.softStatus,
            statusLabel: "Soft Bounce",
            reason: person.reason || "Message delivery failed",
          }
        : {
            muted: STYLES.unsubMuted,
            name: STYLES.unsubName,
            body: STYLES.unsubBody,
            ink: STYLES.unsubInk,
            note: STYLES.unsubBody,
            status: STYLES.unsubName,
            statusLabel: "Unsubscribed",
            reason: "Opted out",
          };

  const values: Array<[number, ExcelJS.CellValue, CellStyle]> = [
    [2, index, styles.muted],
    [3, person.name, styles.name],
    [4, person.email, styles.body],
    [5, person.company, styles.ink],
    [6, person.domain, styles.muted],
    [7, person.sendDate, styles.body],
    [8, person.eventDate, styles.note],
    [9, styles.reason, styles.note],
    [10, styles.statusLabel, styles.status],
  ];
  values.forEach(([col, value, style]) => paintCell(sheet, row, col, value, style));
}

const OPEN_HEADERS = [
  "#",
  "Person Name",
  "Email Address",
  "Company",
  "Domain",
  "Open Date",
  "Open Time",
  "Opens",
  "Clicks",
  "CTA Clicked",
  "Status",
];

const BOUNCE_HEADERS = [
  "#",
  "Person Name",
  "Email Address",
  "Company",
  "Domain",
  "Send Date",
  "Bounce / Unsub Date",
  "Reason / Note",
  "Status",
];

export function campaignReportFilename(campaignName: string) {
  const safe = campaignName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${safe || "Campaign"} Report.xlsx`;
}

export async function buildCampaignReportWorkbook({
  campaignName,
  timezone,
  sentAt,
  sends,
}: {
  campaignName: string;
  timezone: string;
  sentAt?: string | Date;
  sends: CampaignSendDoc[];
}) {
  const timeZone = timezone || "Asia/Kolkata";
  const sentDate = asDate(sentAt) ?? sends.map((send) => asDate(send.sentAt)).find(Boolean) ?? null;
  const sentLong = sentDate ? formatInZone(sentDate, timeZone, "long") : DASH;

  const attempted = sends.filter(
    (send) => send.status === "sent" || (send.status === "failed" && send.error !== "Unsubscribed"),
  );
  const delivered = sends.filter((send) => send.status === "sent");
  const bounceFails = sends.filter(
    (send) => send.status === "failed" && send.error !== "Unsubscribed",
  );
  const hardBounces = bounceFails.filter((send) => isHardBounce(send.error));
  const softBounces = bounceFails.filter((send) => !isHardBounce(send.error));
  const clickers = sortPeople(
    delivered.filter((send) => send.clickCount > 0).map((send) => mapPerson(send, timeZone)),
  );
  const opensOnly = sortPeople(
    delivered
      .filter((send) => send.openCount > 0 && send.clickCount === 0)
      .map((send) => mapPerson(send, timeZone)),
  );
  const uniqueOpens = delivered.filter((send) => send.openCount > 0).length;
  const uniqueClicks = delivered.filter((send) => send.clickCount > 0).length;
  const unsubscribes = sends
    .filter((send) => Boolean(send.unsubscribedAt))
    .map((send) => mapPerson(send, timeZone));

  const totalSent = attempted.length;
  const totalDelivered = delivered.length;
  const openRate = rateNumber(uniqueOpens, totalDelivered);
  const clickRate = rateNumber(uniqueClicks, totalDelivered);
  const ctoRate = rateNumber(uniqueClicks, uniqueOpens);
  const hardRate = rateNumber(hardBounces.length, totalSent);
  const softRate = rateNumber(softBounces.length, totalSent);
  const unsubRate = rateNumber(unsubscribes.length, totalSent);

  const companies = new Map<
    string,
    { company: string; domain: string; opened: number; clicked: number; opens: number }
  >();
  for (const send of delivered.filter((item) => item.openCount > 0)) {
    const domain = emailDomain(send.email);
    const company = send.companyName || domain || send.email;
    const key = `${company.toLowerCase()}|${domain}`;
    const current = companies.get(key) ?? {
      company,
      domain,
      opened: 0,
      clicked: 0,
      opens: 0,
    };
    current.opened += 1;
    current.opens += send.openCount > 0 ? 1 : 0;
    if (send.clickCount > 0) {
      current.clicked += 1;
    }
    companies.set(key, current);
  }
  const topCompanies = [...companies.values()].sort((a, b) => {
    if (b.clicked !== a.clicked) {
      return b.clicked - a.clicked;
    }
    if (b.opened !== a.opened) {
      return b.opened - a.opened;
    }
    return a.company.localeCompare(b.company);
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Unified Portal";
  workbook.created = new Date();

  const opensSheet = workbook.addWorksheet("Opens & Clicks", {
    properties: { tabColor: { argb: "FF276B3A" } },
  });
  setupSheet(opensSheet, 12, [3, 22, 24, 20, 16, 12, 11, 10, 7, 8, 18, 8.71]);
  writeTitleBlock(
    opensSheet,
    12,
    `${campaignName} — Opens & Clicks Tracker`,
    `EDM 1 · ${sentLong} · ${uniqueOpens} Opens · ${uniqueClicks} Clicks · ${totalSent} Total Sent`,
  );

  let row = 6;
  writeSectionBar(opensSheet, row, 12, "CLICKERS  —  Opened & Clicked a Link");
  row += 1;
  writeHeaderRow(opensSheet, row, OPEN_HEADERS);
  row += 1;
  clickers.forEach((person, index) => {
    writeClickerRow(opensSheet, row, index + 1, person);
    row += 1;
  });
  row += 1;
  writeSectionBar(opensSheet, row, 12, "OPENS ONLY  —  Opened Email, No Click");
  row += 1;
  writeHeaderRow(opensSheet, row, OPEN_HEADERS);
  row += 1;
  opensOnly.forEach((person, index) => {
    writeOpenRow(opensSheet, row, index + 1, person);
    row += 1;
  });

  const bounceSheet = workbook.addWorksheet("Bounces & Unsubscribes", {
    properties: { tabColor: { argb: "FF7A5C00" } },
  });
  setupSheet(bounceSheet, 10, [3, 22, 24, 20, 16, 14, 11, 20, 14, 8.71]);
  writeTitleBlock(
    bounceSheet,
    10,
    `${campaignName} — Bounces & Unsubscribes`,
    `EDM 1 · ${sentLong} · ${hardBounces.length} Hard Bounces · ${softBounces.length} Soft Bounces · ${unsubscribes.length} Unsubscribes`,
  );

  row = 6;
  writeSectionBar(bounceSheet, row, 10, "HARD BOUNCES  —  Invalid / Permanently Undeliverable");
  row += 1;
  writeHeaderRow(bounceSheet, row, BOUNCE_HEADERS);
  row += 1;
  hardBounces.forEach((send, index) => {
    writeBounceRow(bounceSheet, row, index + 1, mapPerson(send, timeZone), "hard");
    row += 1;
  });
  row += 1;
  writeSectionBar(bounceSheet, row, 10, "SOFT BOUNCES  —  Temporary Delivery Failure");
  row += 1;
  writeHeaderRow(bounceSheet, row, BOUNCE_HEADERS);
  row += 1;
  softBounces.forEach((send, index) => {
    writeBounceRow(bounceSheet, row, index + 1, mapPerson(send, timeZone), "soft");
    row += 1;
  });
  row += 1;
  writeSectionBar(bounceSheet, row, 10, "UNSUBSCRIBES  —  Opted Out");
  row += 1;
  writeHeaderRow(bounceSheet, row, BOUNCE_HEADERS);
  row += 1;
  unsubscribes.forEach((person, index) => {
    writeBounceRow(bounceSheet, row, index + 1, person, "unsub");
    row += 1;
  });
  row += 2;
  bounceSheet.getRow(row).height = 15.75;
  paintRange(bounceSheet, row, 1, 10, STYLES.page);
  paintCell(
    bounceSheet,
    row,
    2,
    `${campaignName} — Bounces & Unsubscribes · Confidential`,
    STYLES.subtitle,
  );

  const summarySheet = workbook.addWorksheet("Summary", {
    properties: { tabColor: { argb: "FF1A4F8A" } },
  });
  setupSheet(summarySheet, 7, [3, 30, 16, 12, 13, 14, 20]);
  writeTitleBlock(
    summarySheet,
    7,
    `${campaignName} — Campaign Summary`,
    `EDM 1 · Sent ${sentLong}`,
  );

  row = 6;
  writeSectionBar(summarySheet, row, 7, "CAMPAIGN PERFORMANCE OVERVIEW");
  row += 1;
  writeHeaderRow(summarySheet, row, [
    "Metric",
    "Count",
    "Rate",
    "Benchmark",
    "vs Benchmark",
    "Notes",
  ]);
  row += 1;

  type MetricTone = "open" | "click" | "hard" | "soft" | "unsub";
  const metricTones: Record<
    MetricTone,
    { name: CellStyle; count: CellStyle; body: CellStyle; muted: CellStyle; vs: CellStyle }
  > = {
    open: {
      name: STYLES.summaryName,
      count: STYLES.summaryInk,
      body: STYLES.summaryBody,
      muted: STYLES.summaryMuted,
      vs: STYLES.summaryGreen,
    },
    click: {
      name: STYLES.clicksName,
      count: STYLES.clickInk,
      body: STYLES.clicksBody,
      muted: STYLES.clicksMuted,
      vs: STYLES.clicksGreen,
    },
    hard: {
      name: STYLES.hardSummaryName,
      count: STYLES.hardSummaryInk,
      body: STYLES.hardSummaryBody,
      muted: STYLES.hardSummaryMuted,
      vs: STYLES.hardSummaryGreen,
    },
    soft: {
      name: STYLES.softSummaryName,
      count: STYLES.softSummaryInk,
      body: STYLES.softSummaryBody,
      muted: STYLES.softSummaryMuted,
      vs: STYLES.softSummaryGreen,
    },
    unsub: {
      name: STYLES.unsubSummaryName,
      count: STYLES.unsubSummaryInk,
      body: STYLES.unsubSummaryBody,
      muted: STYLES.unsubSummaryMuted,
      vs: STYLES.unsubSummaryGreen,
    },
  };

  function writeMetric(
    metric: string,
    count: ExcelJS.CellValue,
    rate: string,
    benchmark: string,
    vs: string,
    notes: string,
    tone: MetricTone,
  ) {
    const styles = metricTones[tone];
    summarySheet.getRow(row).height = 18;
    paintCell(summarySheet, row, 2, metric, styles.name);
    paintCell(summarySheet, row, 3, count, styles.count);
    paintCell(summarySheet, row, 4, rate, styles.body);
    paintCell(summarySheet, row, 5, benchmark, styles.muted);
    paintCell(summarySheet, row, 6, vs, styles.vs);
    paintCell(summarySheet, row, 7, notes, styles.muted);
    row += 1;
  }

  writeMetric("Total Sent", totalSent, DASH, DASH, DASH, "Emails dispatched", "open");
  writeMetric("Total Delivered", totalDelivered, DASH, DASH, DASH, "Excl. all bounces", "open");
  writeMetric(
    "Total Opens",
    uniqueOpens,
    pct(uniqueOpens, totalDelivered),
    "20–25%",
    vsRange(openRate, 20, 25),
    "Unique opens",
    "open",
  );
  writeMetric(
    "Total Clicks",
    uniqueClicks,
    pct(uniqueClicks, totalDelivered),
    "2–5%",
    vsRange(clickRate, 2, 5),
    "Unique clicks",
    "click",
  );
  writeMetric(
    "Click-to-Open Rate",
    DASH,
    pct(uniqueClicks, uniqueOpens),
    "10–15%",
    vsRange(ctoRate, 10, 15),
    "Clicks ÷ Opens",
    "open",
  );
  writeMetric(
    "Hard Bounces",
    hardBounces.length,
    pct(hardBounces.length, totalSent),
    "<2%",
    vsMax(hardRate, 2),
    "Permanent failures",
    "hard",
  );
  writeMetric(
    "Soft Bounces",
    softBounces.length,
    pct(softBounces.length, totalSent),
    "<5%",
    vsMax(softRate, 5),
    "Temporary failures",
    "soft",
  );
  writeMetric(
    "Unsubscribes",
    unsubscribes.length,
    pct(unsubscribes.length, totalSent),
    "<0.5%",
    vsMax(unsubRate, 0.5),
    "Opted out",
    "unsub",
  );

  row += 1;
  writeSectionBar(summarySheet, row, 7, "TOP COMPANIES BY ENGAGEMENT");
  row += 1;
  writeHeaderRow(summarySheet, row, [
    "Company",
    "Domain",
    "Contacts Opened",
    "Contacts Clicked",
    "Total Opens",
    "Status",
  ]);
  row += 1;
  topCompanies.forEach((company) => {
    const clicked = company.clicked > 0;
    summarySheet.getRow(row).height = 18;
    paintCell(
      summarySheet,
      row,
      2,
      company.company,
      clicked ? STYLES.clickName : STYLES.openName,
    );
    paintCell(
      summarySheet,
      row,
      3,
      company.domain,
      clicked ? STYLES.clickMuted : STYLES.openMuted,
    );
    paintCell(
      summarySheet,
      row,
      4,
      company.opened,
      clicked ? STYLES.clickInk : STYLES.openInk,
    );
    paintCell(
      summarySheet,
      row,
      5,
      company.clicked,
      clicked ? STYLES.clickGreen : STYLES.openMuted,
    );
    paintCell(
      summarySheet,
      row,
      6,
      company.opens,
      clicked ? STYLES.clickInk : STYLES.openInk,
    );
    paintCell(
      summarySheet,
      row,
      7,
      clicked ? "Clicked" : "Opened",
      clicked ? STYLES.clickStatus : STYLES.openStatus,
    );
    row += 1;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
