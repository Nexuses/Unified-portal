import ExcelJS from "exceljs";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";
import {
  asDate,
  buildCampaignReportTables,
  formatInZone,
  REPORT_DASH,
} from "@/lib/campaign-report-tables";

export type CampaignReportExportFormat = "formatted" | "rows";

export function parseCampaignReportExportFormat(
  value: string | null | undefined,
): CampaignReportExportFormat {
  return value === "rows" ? "rows" : "formatted";
}

const COLORS = {
  titleNavy: "FF0B1F3A",
  subtitleBlue: "FF1565C0",
  sentGreen: "FF00695C",
  clickersGreen: "FF1B5E20",
  opensBlue: "FF0D47A1",
  bounceOrange: "FFE65100",
  unsubPurple: "FF4A148C",
  headerBg: "FFDCE6F1",
  headerInk: "FF0D47A1",
  rowAlt: "FFF5F9FC",
  rowWhite: "FFFFFFFF",
  ink: "FF1A1A1A",
  clickedBg: "FFC8E6C9",
  clickedInk: "FF1B5E20",
  openedBg: "FFBBDEFB",
  openedInk: "FF0D47A1",
  white: "FFFFFFFF",
};

const DASH = REPORT_DASH;

function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function paintCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    fill: string;
    fontColor?: string;
    bold?: boolean;
    size?: number;
  },
) {
  const cell = sheet.getCell(row, col);
  cell.value = value;
  cell.fill = solid(opts.fill);
  cell.font = {
    name: "Calibri",
    size: opts.size ?? 10,
    bold: Boolean(opts.bold),
    color: { argb: opts.fontColor ?? COLORS.ink },
  };
  cell.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
}

function paintMergedBanner(
  sheet: ExcelJS.Worksheet,
  row: number,
  lastCol: number,
  value: string,
  fill: string,
  size: number,
  height: number,
) {
  sheet.mergeCells(row, 1, row, lastCol);
  sheet.getRow(row).height = height;
  for (let col = 1; col <= lastCol; col += 1) {
    paintCell(sheet, row, col, value, {
      fill,
      fontColor: COLORS.white,
      bold: true,
      size,
    });
  }
}

function paintHeaderRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  headers: string[],
) {
  sheet.getRow(row).height = 20;
  headers.forEach((header, index) => {
    paintCell(sheet, row, index + 1, header, {
      fill: COLORS.headerBg,
      fontColor: COLORS.headerInk,
      bold: true,
      size: 10,
    });
  });
}

function rowFill(index: number) {
  return index % 2 === 0 ? COLORS.rowWhite : COLORS.rowAlt;
}

export function campaignReportFilename(
  campaignName: string,
  format: CampaignReportExportFormat = "formatted",
) {
  const safe = campaignName
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = safe || "Campaign";
  return format === "rows" ? `${base} Row Export.xlsx` : `${base} Report.xlsx`;
}

function fullTimestamp(value: Date | string | undefined, timeZone: string) {
  const date = asDate(value);
  if (!date) return "";
  const local = `${formatInZone(date, timeZone, "date")} ${formatInZone(date, timeZone, "time")}`.trim();
  return local || date.toISOString();
}

function isoTimestamp(value: Date | string | undefined) {
  const date = asDate(value);
  return date ? date.toISOString() : "";
}

function personName(send: CampaignSendDoc) {
  return (
    send.fullName ||
    `${send.firstName ?? ""} ${send.lastName ?? ""}`.trim() ||
    send.email
  ).trim();
}

function serializeOpenEvents(send: CampaignSendDoc, timeZone: string) {
  return (send.openEvents ?? [])
    .map((event) => {
      const bits = [
        fullTimestamp(event.at, timeZone),
        event.device || "",
        event.ip || "",
        event.bot ? "bot" : "",
        event.inferredFromClick ? "inferred_from_click" : "",
      ].filter(Boolean);
      return bits.join(" | ");
    })
    .filter(Boolean)
    .join(" || ");
}

function serializeClickEvents(send: CampaignSendDoc, timeZone: string) {
  return (send.clickEvents ?? [])
    .map((event) => {
      const bits = [
        fullTimestamp(event.at, timeZone),
        event.url || "",
        event.device || "",
        event.ip || "",
        event.bot ? "bot" : "",
        event.ignored ? "ignored" : "",
      ].filter(Boolean);
      return bits.join(" | ");
    })
    .filter(Boolean)
    .join(" || ");
}

/** Flat one-row-per-send workbook with full timestamps and event history. */
export async function buildCampaignReportRowsWorkbook({
  campaignName,
  timezone,
  sends,
}: {
  campaignName: string;
  timezone: string;
  sentAt?: string | Date;
  sends: CampaignSendDoc[];
  hideBotClicks?: boolean;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Unified Portal";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Row export");
  const headers = [
    "#",
    "Person Name",
    "Email",
    "Company",
    "Status",
    "Error",
    "Step",
    "Sent At",
    "Sent At (ISO)",
    "Opened At",
    "Opened At (ISO)",
    "Open Count",
    "Open Device",
    "Open IP",
    "Bot Open",
    "Open Pixel Blocked",
    "Open Events",
    "Clicked At",
    "Clicked At (ISO)",
    "Click Count",
    "Clicked URL",
    "Click Device",
    "Click IP",
    "Bot Click",
    "Click Burst Ignored",
    "Click Events",
    "Unsubscribed At",
    "Unsubscribed At (ISO)",
    "Bounced At",
    "Bounced At (ISO)",
    "Replied At",
    "Replied At (ISO)",
  ];
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = Math.min(Math.max(header.length + 2, 12), 42);
  });
  sheet.getColumn(17).width = 48;
  sheet.getColumn(26).width = 48;

  paintMergedBanner(
    sheet,
    1,
    headers.length,
    `${campaignName} · Row export (all timestamps)`,
    COLORS.titleNavy,
    13,
    26,
  );
  paintMergedBanner(
    sheet,
    2,
    headers.length,
    `${sends.length} sends · timezone ${timezone}`,
    COLORS.subtitleBlue,
    10,
    20,
  );
  paintHeaderRow(sheet, 4, headers);

  sends.forEach((send, index) => {
    const fill = rowFill(index);
    const step =
      typeof send.sequenceIndex === "number" ? `Email Step ${send.sequenceIndex + 1}` : "Email Step 1";
    const values: ExcelJS.CellValue[] = [
      index + 1,
      personName(send),
      send.email || "",
      send.companyName || "",
      send.status || "",
      send.error || "",
      step,
      fullTimestamp(send.sentAt, timezone),
      isoTimestamp(send.sentAt),
      fullTimestamp(send.openedAt, timezone),
      isoTimestamp(send.openedAt),
      send.openCount ?? 0,
      send.openedDevice || "",
      send.openedIp || "",
      send.botOpen ? "yes" : "",
      send.openPixelBlocked ? "yes" : "",
      serializeOpenEvents(send, timezone),
      fullTimestamp(send.clickedAt, timezone),
      isoTimestamp(send.clickedAt),
      send.clickCount ?? 0,
      send.clickedUrl || "",
      send.clickedDevice || "",
      send.clickedIp || "",
      send.botClick ? "yes" : "",
      send.clickBurstIgnored ? "yes" : "",
      serializeClickEvents(send, timezone),
      fullTimestamp(send.unsubscribedAt, timezone),
      isoTimestamp(send.unsubscribedAt),
      fullTimestamp(send.bouncedAt, timezone),
      isoTimestamp(send.bouncedAt),
      fullTimestamp(send.repliedAt, timezone),
      isoTimestamp(send.repliedAt),
    ];
    values.forEach((value, col) => {
      paintCell(sheet, 5 + index, col + 1, value, { fill, size: 10 });
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildCampaignReportExportWorkbook(
  args: {
    campaignName: string;
    timezone: string;
    sentAt?: string | Date;
    sends: CampaignSendDoc[];
    hideBotClicks?: boolean;
  },
  format: CampaignReportExportFormat = "formatted",
) {
  if (format === "rows") {
    return buildCampaignReportRowsWorkbook(args);
  }
  return buildCampaignReportWorkbook(args);
}

export async function buildCampaignReportWorkbook({
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
  hideBotClicks?: boolean;
}) {
  const tables = buildCampaignReportTables({
    campaignName,
    timezone,
    sentAt,
    sends,
    hideBotClicks,
  });
  const { sentLong, clickers, opensOnly, bounces, unsubscribes } = tables;
  const { sent: totalSent, opens: uniqueOpens, clicks: uniqueClicks } = tables.totals;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Unified Portal";
  workbook.created = new Date();

  const main = workbook.addWorksheet("Sent, Open, Click");
  main.views = [{ showGridLines: false }];
  [5, 22, 34, 22, 22, 14, 12, 12, 12, 20, 14, 10, 7, 26, 11].forEach((width, index) => {
    main.getColumn(index + 1).width = width;
  });

  paintMergedBanner(
    main,
    2,
    15,
    `${campaignName} · Sent, Open & Click Tracker`,
    COLORS.titleNavy,
    14,
    28,
  );
  paintMergedBanner(
    main,
    3,
    15,
    `${campaignName} · ${sentLong} · ${totalSent} Total Sent · ${uniqueOpens} Opens · ${uniqueClicks} Clicks`,
    COLORS.subtitleBlue,
    11,
    22,
  );

  let row = 6;
  paintMergedBanner(main, row, 14, "SENT — All Emails Delivered", COLORS.sentGreen, 12, 24);
  row += 1;
  paintHeaderRow(main, row, [
    "#",
    "Person Name",
    "Email Address",
    "Company",
    "Domain",
    "Step",
    "Send Date",
    "Send Time",
  ]);
  row += 1;
  tables.sent.forEach((send, index) => {
    const fill = rowFill(index);
    [index + 1, send.name, send.email, send.company, send.domain, send.step, send.date, send.time].forEach(
      (value, col) => {
        paintCell(main, row, col + 1, value, { fill, size: 10 });
      },
    );
    row += 1;
  });

  const engageHeaders = [
    "#",
    "Person Name",
    "Email Address",
    "Company",
    "Domain",
    "Open Date",
    "Open Time",
    "Open Device",
    "Click Device",
    "Click IP",
    "Open Tag",
    "Click Tag",
    "Opens",
    "Clicks",
    "CTA Clicked",
    "Status",
  ];
  const engageSections = [
    { title: "CLICKERS — Opened & Clicked a Link", color: COLORS.clickersGreen, rows: clickers },
    { title: "OPENS — All Opens (incl. Open not tracked)", color: COLORS.opensBlue, rows: opensOnly },
  ];
  for (const section of engageSections) {
    row += 1;
    paintMergedBanner(main, row, 16, section.title, section.color, 12, 24);
    row += 1;
    paintHeaderRow(main, row, engageHeaders);
    row += 1;
    section.rows.forEach((person, index) => {
      const fill = rowFill(index);
      const clicked = person.status === "Clicked";
      const values: ExcelJS.CellValue[] = [
        index + 1,
        person.name,
        person.email,
        person.company,
        person.domain,
        person.openDate,
        person.openTime,
        person.openDevice,
        person.clickDevice,
        person.clickIp,
        person.openTag,
        // Toggle OFF: bot clickers get "Bot click". Toggle ON: bots excluded, tag is dash.
        person.clickTag,
        person.opens,
        person.clicks,
        person.cta,
      ];
      values.forEach((value, col) => {
        paintCell(main, row, col + 1, value, { fill, size: 10 });
      });
      paintCell(main, row, 16, person.status, {
        fill: clicked ? COLORS.clickedBg : COLORS.openedBg,
        fontColor: clicked ? COLORS.clickedInk : COLORS.openedInk,
        bold: true,
        size: 10,
      });
      row += 1;
    });
  }

  const companySheet = workbook.addWorksheet("Companies");
  companySheet.views = [{ showGridLines: false }];
  [5, 30, 26, 11, 9, 9, 9, 10, 13, 11, 11].forEach((width, index) => {
    companySheet.getColumn(index + 1).width = width;
  });
  paintMergedBanner(
    companySheet,
    2,
    11,
    `${campaignName} · Company Engagement`,
    COLORS.titleNavy,
    14,
    28,
  );
  paintMergedBanner(
    companySheet,
    3,
    11,
    `${campaignName} · ${tables.companies.length} Companies · ${uniqueOpens} Opens · ${uniqueClicks} Clicks`,
    COLORS.subtitleBlue,
    11,
    22,
  );
  paintHeaderRow(companySheet, 5, [
    "#",
    "Company",
    "Domain",
    "Contacts",
    "Sent",
    "Opened",
    "Clicked",
    "Bounced",
    "Unsubscribed",
    "Open Rate",
    "Click Rate",
  ]);
  tables.companies.forEach((company, index) => {
    const fill = rowFill(index);
    [
      index + 1,
      company.company,
      company.domain,
      company.contacts,
      company.sent,
      company.opened,
      company.clicked,
      company.bounced,
      company.unsubscribed,
      company.openRate,
      company.clickRate,
    ].forEach((value, col) => {
      paintCell(companySheet, 6 + index, col + 1, value, { fill, size: 10 });
    });
  });

  const bounceSheet = workbook.addWorksheet("Bounces & Unsubscribes");
  bounceSheet.views = [{ showGridLines: false }];
  [5, 22, 34, 22, 22, 28, 12, 10].forEach((width, index) => {
    bounceSheet.getColumn(index + 1).width = width;
  });
  paintMergedBanner(
    bounceSheet,
    2,
    8,
    `${campaignName} · Bounces & Unsubscribes`,
    COLORS.bounceOrange,
    14,
    28,
  );
  paintMergedBanner(
    bounceSheet,
    3,
    8,
    `${campaignName} · ${sentLong} · ${bounces.length} Bounces · ${tables.unsubscribed} Unsubscribed`,
    COLORS.subtitleBlue,
    11,
    22,
  );

  row = 5;
  paintMergedBanner(bounceSheet, row, 8, "BOUNCES", COLORS.bounceOrange, 12, 24);
  row += 1;
  paintHeaderRow(bounceSheet, row, [
    "#",
    "Person Name",
    "Email Address",
    "Company",
    "Domain",
    "Reason",
    "Bounced Date",
    "Bounced Time",
  ]);
  row += 1;
  if (bounces.length === 0) {
    [DASH, "No records", "", "", "", "", "", ""].forEach((value, col) => {
      paintCell(bounceSheet, row, col + 1, value, { fill: COLORS.rowWhite, size: 10 });
    });
    row += 1;
  } else {
    bounces.forEach((bounce, index) => {
      const fill = rowFill(index);
      [
        index + 1,
        bounce.name,
        bounce.email,
        bounce.company,
        bounce.domain,
        bounce.reason,
        bounce.date,
        bounce.time,
      ].forEach((value, col) => {
        paintCell(bounceSheet, row, col + 1, value, { fill, size: 10 });
      });
      row += 1;
    });
  }

  row += 1;
  paintMergedBanner(bounceSheet, row, 8, "UNSUBSCRIBES", COLORS.unsubPurple, 12, 24);
  row += 1;
  paintHeaderRow(bounceSheet, row, [
    "#",
    "Person Name",
    "Email Address",
    "Company",
    "Domain",
    "Reason",
    "Unsubscribed Date",
    "Unsubscribed Time",
  ]);
  row += 1;
  if (unsubscribes.length === 0) {
    [DASH, "No records", "", "", "", "", "", ""].forEach((value, col) => {
      paintCell(bounceSheet, row, col + 1, value, { fill: COLORS.rowWhite, size: 10 });
    });
  } else {
    unsubscribes.forEach((person, index) => {
      const fill = rowFill(index);
      [
        index + 1,
        person.name,
        person.email,
        person.company,
        person.domain,
        person.reason,
        person.date,
        person.time,
      ].forEach((value, col) => {
        paintCell(bounceSheet, row, col + 1, value, { fill, size: 10 });
      });
      row += 1;
    });
  }

  const summary = workbook.addWorksheet("Summary");
  summary.views = [{ showGridLines: false }];
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 42;
  paintMergedBanner(summary, 2, 2, `${campaignName} · Campaign Summary`, COLORS.titleNavy, 14, 28);
  paintMergedBanner(
    summary,
    3,
    2,
    `Generated · ${tables.summary[1][1]}`,
    COLORS.subtitleBlue,
    11,
    22,
  );
  paintHeaderRow(summary, 5, ["Metric", "Value"]);
  tables.summary.forEach(([metric, value], index) => {
    const fill = rowFill(index);
    paintCell(summary, 6 + index, 1, metric, { fill, bold: true, size: 10 });
    paintCell(summary, 6 + index, 2, value, { fill, size: 10 });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
