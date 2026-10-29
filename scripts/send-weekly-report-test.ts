import fs from "fs";
import nodemailer from "nodemailer";

async function main() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }

  const { buildWeeklyReportHtml } = await import("../lib/weekly-report-server");

  const report = {
    weekKey: "2026-10-23_2026-10-29",
    from: "2026-10-23",
    to: "2026-10-29",
    timezone: process.env.WEEKLY_REPORT_TIMEZONE || "Asia/Kolkata",
    generatedAt: new Date().toISOString(),
    projects: [
      {
        projectId: "1",
        projectName: "Sample Project A",
        delivered: 1240,
        opens: 486,
        clicks: 112,
        replies: 37,
        contactsAdded: 94,
        unsubscribed: 8,
        failed: 3,
        openRate: 486 / 1240,
        clickRate: 112 / 1240,
        replyRate: 37 / 1240,
      },
      {
        projectId: "2",
        projectName: "Sample Project B",
        delivered: 820,
        opens: 301,
        clicks: 64,
        replies: 19,
        contactsAdded: 61,
        unsubscribed: 5,
        failed: 1,
        openRate: 301 / 820,
        clickRate: 64 / 820,
        replyRate: 19 / 820,
      },
    ],
    totals: {
      delivered: 2060,
      opens: 787,
      clicks: 176,
      replies: 56,
      contactsAdded: 155,
      unsubscribed: 13,
      failed: 4,
      openRate: 787 / 2060,
      clickRate: 176 / 2060,
      replyRate: 56 / 2060,
    },
  };

  const html = buildWeeklyReportHtml(report);
  const host = process.env.WEEKLY_REPORT_SMTP_HOST || "";
  const port = Number(process.env.WEEKLY_REPORT_SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: process.env.WEEKLY_REPORT_SMTP_USER,
      pass: process.env.WEEKLY_REPORT_SMTP_PASS,
    },
  });
  const fromName = (
    process.env.WEEKLY_REPORT_FROM_NAME || "Nexuses Weekly Report"
  ).replace(/"/g, "");
  const info = await transporter.sendMail({
    from: `"${fromName}" <${process.env.WEEKLY_REPORT_FROM_EMAIL}>`,
    to: process.env.WEEKLY_REPORT_TO,
    subject: "Weekly report · TEST (sample data) · 2026-10-23 → 2026-10-29",
    html,
  });
  console.log(`Sent template test messageId=${info.messageId || "(none)"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
