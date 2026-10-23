import ExcelJS from "exceljs";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";
import { buildCampaignReportTables, REPORT_DASH } from "@/lib/campaign-report-tables";

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

export function campaignReportFilename(campaignName: string) {
  const safe = campaignName
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe || "Campaign"} Report.xlsx`;
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
    "Open Tag",
    "Click Tag",
    "Opens",
    "Clicks",
    "CTA Clicked",
    "Status",
  ];
  const engageSections = [
    { title: "CLICKERS — Opened & Clicked a Link", color: COLORS.clickersGreen, rows: clickers },
    { title: "OPENS — All Opens (incl. Image pixel blocked)", color: COLORS.opensBlue, rows: opensOnly },
  ];
  for (const section of engageSections) {
    row += 1;
    paintMergedBanner(main, row, 15, section.title, section.color, 12, 24);
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
      paintCell(main, row, 15, person.status, {
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
