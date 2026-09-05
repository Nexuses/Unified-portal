import ExcelJS from "exceljs";
import type { CampaignSendDoc } from "@/lib/campaign-blasts-server";

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
  muted: "FF5F6368",
  clickedBg: "FFC8E6C9",
  clickedInk: "FF1B5E20",
  openedBg: "FFBBDEFB",
  openedInk: "FF0D47A1",
  noteBg: "FFFFF8E1",
  white: "FFFFFFFF",
};

const DASH = "—";

function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

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
  return (
    send.fullName ||
    `${send.firstName ?? ""} ${send.lastName ?? ""}`.trim() ||
    send.email
  ).trim();
}

function stepLabel(send: CampaignSendDoc) {
  if (typeof send.sequenceIndex === "number") {
    return `Email Step ${send.sequenceIndex + 1}`;
  }
  return "Email Step 1";
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
  return DASH;
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
}: {
  campaignName: string;
  timezone: string;
  sentAt?: string | Date;
  sends: CampaignSendDoc[];
}) {
  const timeZone = timezone || "Asia/Kolkata";
  const sentDate =
    asDate(sentAt) ??
    sends.map((send) => asDate(send.sentAt)).find(Boolean) ??
    null;
  const sentLong = sentDate ? formatInZone(sentDate, timeZone, "long") : DASH;

  const delivered = sends.filter((send) => send.status === "sent");
  const bounced = sends.filter(
    (send) => send.status === "failed" && send.error !== "Unsubscribed",
  );
  const unsubscribed = sends.filter(
    (send) => Boolean(send.unsubscribedAt) || send.error === "Unsubscribed",
  );

  const byEmail = new Map<string, CampaignSendDoc[]>();
  for (const send of delivered) {
    const key = send.email.trim().toLowerCase();
    const list = byEmail.get(key) ?? [];
    list.push(send);
    byEmail.set(key, list);
  }

  type EngageRow = {
    name: string;
    email: string;
    company: string;
    domain: string;
    openDate: string;
    openTime: string;
    opens: number;
    clicks: number;
    cta: string;
    openedAtMs: number;
  };

  const engageRows: EngageRow[] = [];
  for (const group of byEmail.values()) {
    const opens = group.reduce((sum, item) => sum + (item.openCount || 0), 0);
    const clicks = group.reduce((sum, item) => sum + (item.clickCount || 0), 0);
    if (opens <= 0 && clicks <= 0) {
      continue;
    }
    const opened =
      group
        .map((item) => asDate(item.openedAt))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const primary =
      group.find((item) => item.clickCount > 0) ??
      group.find((item) => item.openCount > 0) ??
      group[0];
    engageRows.push({
      name: personName(primary),
      email: primary.email,
      company: primary.companyName || "",
      domain: emailDomain(primary.email),
      openDate: formatInZone(opened ?? undefined, timeZone, "date"),
      openTime: formatInZone(opened ?? undefined, timeZone, "time"),
      opens: opens || (opened ? 1 : 0),
      clicks,
      cta: ctaLabel(primary),
      openedAtMs: opened?.getTime() ?? 0,
    });
  }

  engageRows.sort((a, b) => {
    if (a.openedAtMs !== b.openedAtMs) {
      return a.openedAtMs - b.openedAtMs;
    }
    return a.email.localeCompare(b.email);
  });

  const clickers = engageRows.filter((row) => row.clicks > 0);
  const opensOnly = engageRows.filter((row) => row.opens > 0 && row.clicks <= 0);
  const uniqueOpens = engageRows.filter((row) => row.opens > 0).length;
  const uniqueClicks = clickers.length;
  const totalSent = delivered.length;
  const sequenceSteps = Math.max(
    1,
    ...delivered.map((send) =>
      typeof send.sequenceIndex === "number" ? send.sequenceIndex + 1 : 1,
    ),
    1,
  );
  const audienceEmails = new Set(
    sends.map((send) => send.email.trim().toLowerCase()).filter(Boolean),
  );
  const openRate = totalSent
    ? `${Math.round((uniqueOpens / totalSent) * 100)}%`
    : "0%";
  const clickRate = totalSent
    ? `${Math.round((uniqueClicks / totalSent) * 100)}%`
    : "0%";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Unified Portal";
  workbook.created = new Date();

  const main = workbook.addWorksheet("Sent, Open, Click");
  main.views = [{ showGridLines: false }];
  [5, 22, 34, 22, 22, 18, 12, 10, 7, 26, 11].forEach((width, index) => {
    main.getColumn(index + 1).width = width;
  });

  paintMergedBanner(
    main,
    2,
    11,
    `${campaignName} · Sent, Open & Click Tracker`,
    COLORS.titleNavy,
    14,
    28,
  );
  paintMergedBanner(
    main,
    3,
    11,
    `${campaignName} · ${sentLong} · ${totalSent} Total Sent · ${uniqueOpens} Opens · ${uniqueClicks} Clicks`,
    COLORS.subtitleBlue,
    11,
    22,
  );

  let row = 6;
  paintMergedBanner(main, row, 11, "SENT — All Emails Delivered", COLORS.sentGreen, 12, 24);
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

  const sentRows = [...delivered].sort((a, b) => {
    const left = asDate(a.sentAt)?.getTime() ?? 0;
    const right = asDate(b.sentAt)?.getTime() ?? 0;
    if (left !== right) {
      return left - right;
    }
    return personName(a).localeCompare(personName(b));
  });

  sentRows.forEach((send, index) => {
    const fill = rowFill(index);
    const values = [
      index + 1,
      personName(send),
      send.email,
      send.companyName || "",
      emailDomain(send.email),
      stepLabel(send),
      formatInZone(send.sentAt, timeZone, "date"),
      formatInZone(send.sentAt, timeZone, "time"),
    ];
    values.forEach((value, col) => {
      paintCell(main, row, col + 1, value, { fill, size: 10 });
    });
    row += 1;
  });

  row += 1;
  paintMergedBanner(
    main,
    row,
    11,
    "CLICKERS — Opened & Clicked a Link",
    COLORS.clickersGreen,
    12,
    24,
  );
  row += 1;
  paintHeaderRow(main, row, [
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
  ]);
  row += 1;
  clickers.forEach((person, index) => {
    const fill = rowFill(index);
    const values: Array<[number, ExcelJS.CellValue, string?, string?, boolean?]> = [
      [1, index + 1, fill],
      [2, person.name, fill],
      [3, person.email, fill],
      [4, person.company, fill],
      [5, person.domain, fill],
      [6, person.openDate, fill],
      [7, person.openTime, fill],
      [8, person.opens, fill],
      [9, person.clicks, fill],
      [10, person.cta, fill],
      [11, "Clicked", COLORS.clickedBg, COLORS.clickedInk, true],
    ];
    values.forEach(([col, value, bg, fontColor, bold]) => {
      paintCell(main, row, col, value, {
        fill: bg ?? fill,
        fontColor,
        bold,
        size: 10,
      });
    });
    row += 1;
  });

  row += 1;
  paintMergedBanner(
    main,
    row,
    11,
    "OPENS ONLY — Opened Email, No Click",
    COLORS.opensBlue,
    12,
    24,
  );
  row += 1;
  paintHeaderRow(main, row, [
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
  ]);
  row += 1;
  opensOnly.forEach((person, index) => {
    const fill = rowFill(index);
    const values: Array<[number, ExcelJS.CellValue, string?, string?, boolean?]> = [
      [1, index + 1, fill],
      [2, person.name, fill],
      [3, person.email, fill],
      [4, person.company, fill],
      [5, person.domain, fill],
      [6, person.openDate, fill],
      [7, person.openTime, fill],
      [8, person.opens, fill],
      [9, 0, fill],
      [10, DASH, fill],
      [11, "Opened", COLORS.openedBg, COLORS.openedInk, true],
    ];
    values.forEach(([col, value, bg, fontColor, bold]) => {
      paintCell(main, row, col, value, {
        fill: bg ?? fill,
        fontColor,
        bold,
        size: 10,
      });
    });
    row += 1;
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
    `${campaignName} · ${sentLong} · ${bounced.length} Bounces · ${unsubscribed.length} Unsubscribed`,
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
  if (bounced.length === 0) {
    ["—", "No records", "", "", "", "", "", ""].forEach((value, col) => {
      paintCell(bounceSheet, row, col + 1, value, { fill: COLORS.rowWhite, size: 10 });
    });
    row += 1;
  } else {
    bounced.forEach((send, index) => {
      const fill = rowFill(index);
      const eventAt = asDate(send.sentAt) ?? send._id.getTimestamp();
      const values = [
        index + 1,
        personName(send),
        send.email,
        send.companyName || "",
        emailDomain(send.email),
        send.error?.trim() ||
          (isHardBounce(send.error) ? "Hard bounce" : "Delivery failed"),
        formatInZone(eventAt, timeZone, "date"),
        formatInZone(eventAt, timeZone, "time"),
      ];
      values.forEach((value, col) => {
        paintCell(bounceSheet, row, col + 1, value, { fill, size: 10 });
      });
      row += 1;
    });
  }

  row += 1;
  paintMergedBanner(
    bounceSheet,
    row,
    8,
    "UNSUBSCRIBES (suppressed at launch)",
    COLORS.unsubPurple,
    12,
    24,
  );
  row += 1;
  paintCell(bounceSheet, row, 1, "Count", {
    fill: COLORS.rowWhite,
    size: 10,
  });
  paintCell(bounceSheet, row, 2, unsubscribed.length, {
    fill: COLORS.rowWhite,
    size: 10,
  });
  row += 1;
  bounceSheet.mergeCells(row, 1, row, 8);
  bounceSheet.getRow(row).height = 18;
  for (let col = 1; col <= 8; col += 1) {
    paintCell(
      bounceSheet,
      row,
      col,
      "Contacts on the unsubscribe list were excluded when the campaign launched.",
      {
        fill: COLORS.noteBg,
        fontColor: COLORS.muted,
        size: 10,
      },
    );
  }

  const generatedLong = formatInZone(new Date(), timeZone, "long");
  const eligible = Math.max(0, audienceEmails.size - unsubscribed.length);

  const summary = workbook.addWorksheet("Summary");
  summary.views = [{ showGridLines: false }];
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 42;
  paintMergedBanner(
    summary,
    2,
    2,
    `${campaignName} · Campaign Summary`,
    COLORS.titleNavy,
    14,
    28,
  );
  paintMergedBanner(
    summary,
    3,
    2,
    `Generated · ${generatedLong}`,
    COLORS.subtitleBlue,
    11,
    22,
  );
  paintHeaderRow(summary, 5, ["Metric", "Value"]);

  const summaryRows: Array<[string, ExcelJS.CellValue]> = [
    ["Campaign", campaignName],
    ["Report Date", generatedLong],
    ["Total Contacts (audience)", audienceEmails.size],
    ["Eligible Recipients", eligible],
    ["Unsubscribed at Launch", unsubscribed.length],
    ["Total Sent", totalSent],
    ["Unique Opens", uniqueOpens],
    ["Unique Clicks", uniqueClicks],
    ["Bounces", bounced.length],
    ["Open Rate", openRate],
    ["Click Rate", clickRate],
    ["Sequence Steps", sequenceSteps],
  ];
  summaryRows.forEach(([metric, value], index) => {
    const fill = rowFill(index);
    const r = 6 + index;
    paintCell(summary, r, 1, metric, { fill, bold: true, size: 10 });
    paintCell(summary, r, 2, value, { fill, size: 10 });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
