import ExcelJS from "exceljs";
import {
  isWaitlistedWebinarFormat,
  isWebinarFormat,
  normalizeEventFormat,
  type EventFormat,
} from "@/lib/event-format";
import { getEventPageAnalytics } from "@/lib/event-page-analytics";
import { getEventById, getEventByShareToken } from "@/lib/events";
import { getSubmissionsByEventId } from "@/lib/submissions";
import {
  getWaitlistedSubmissionStage,
  getWebinarSubmissionStage,
} from "@/lib/webinar-submission-stage";

export type EventReportPerson = {
  id: string;
  name: string;
  email: string;
  companyName: string;
  phone: string;
  status: string;
  source: string;
  sourceListName: string;
  inviteSentAt: string | null;
  botClick: boolean;
  createdAt: string;
};

export type EventReportPayload = {
  eventId: string;
  eventName: string;
  eventFormat: EventFormat;
  status: "draft" | "published";
  projectId: string;
  metrics: {
    pageViews: number;
    uniqueVisitors: number;
    conversionRate: number;
    totalPeople: number;
    inviteTo: number;
    invited: number;
    going: number;
    waitlist: number;
    rejected: number;
    botClicks: number;
    registrations: number;
  };
  people: EventReportPerson[];
};

function personStatus(
  eventFormat: EventFormat,
  submission: Awaited<ReturnType<typeof getSubmissionsByEventId>>[number],
) {
  if (isWaitlistedWebinarFormat(eventFormat)) {
    const stage = getWaitlistedSubmissionStage(submission);
    if (stage === "invite_to") return "Invite to";
    if (stage === "invited") return "Invited";
    if (stage === "waitlist") return "Waitlist";
    if (stage === "going") return "Going";
    if (stage === "rejected") return "Rejected";
    return "Other";
  }
  if (isWebinarFormat(eventFormat)) {
    const stage = getWebinarSubmissionStage(submission);
    if (stage === "invite_to") return "Invite to";
    if (stage === "invited") return "Invited";
    if (stage === "going") return "Going";
    return "Other";
  }
  if (submission.inviteAcceptedAt) return "Going";
  if (submission.inviteSentAt) return "Invited";
  return "Invite to";
}

function sourceLabel(
  submission: Awaited<ReturnType<typeof getSubmissionsByEventId>>[number],
) {
  if (submission.sourceListName) return submission.sourceListName;
  if (submission.source === "list") return "List";
  if (submission.source === "csv") return "CSV upload";
  if (submission.source === "registration") return "Registration";
  return "—";
}

export async function buildEventReportPayload(
  eventId: string,
): Promise<EventReportPayload | null> {
  const event = await getEventById(eventId);
  if (!event) {
    return null;
  }
  return buildEventReportFromEvent(event);
}

export async function buildEventReportByShareToken(
  token: string,
): Promise<EventReportPayload | null> {
  const event = await getEventByShareToken(token);
  if (!event) {
    return null;
  }
  return buildEventReportFromEvent(event);
}

async function buildEventReportFromEvent(
  event: NonNullable<Awaited<ReturnType<typeof getEventById>>>,
): Promise<EventReportPayload> {
  const eventId = String(event.id);
  const eventFormat = normalizeEventFormat(event.eventFormat);
  const submissions = await getSubmissionsByEventId(eventId);
  const analytics = await getEventPageAnalytics(eventId, {
    registrationCount: submissions.filter((item) => item.source === "registration")
      .length,
  });

  let inviteTo = 0;
  let invited = 0;
  let going = 0;
  let waitlist = 0;
  let rejected = 0;
  let botClicks = 0;
  let registrations = 0;

  const people: EventReportPerson[] = submissions.map((submission) => {
    const status = personStatus(eventFormat, submission);
    if (status === "Invite to") inviteTo += 1;
    else if (status === "Invited") invited += 1;
    else if (status === "Going") going += 1;
    else if (status === "Waitlist") waitlist += 1;
    else if (status === "Rejected") rejected += 1;
    if (submission.botClick) botClicks += 1;
    if (submission.source === "registration") registrations += 1;

    return {
      id: submission.id,
      name: submission.name,
      email: submission.email,
      companyName: submission.companyName,
      phone: submission.phone,
      status,
      source: sourceLabel(submission),
      sourceListName: submission.sourceListName ?? "",
      inviteSentAt: submission.inviteSentAt,
      botClick: Boolean(submission.botClick),
      createdAt: submission.createdAt,
    };
  });

  return {
    eventId,
    eventName: event.eventName,
    eventFormat,
    status: event.status === "published" ? "published" : "draft",
    projectId: String(event.projectId ?? ""),
    metrics: {
      pageViews: analytics.totalViews,
      uniqueVisitors: analytics.uniqueVisitors,
      conversionRate: analytics.conversionRate,
      totalPeople: people.length,
      inviteTo,
      invited,
      going,
      waitlist,
      rejected,
      botClicks,
      registrations,
    },
    people,
  };
}

export async function buildEventReportWorkbook(report: EventReportPayload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nexgos Platform";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 18 },
  ];
  const summaryRows: Array<[string, string | number]> = [
    ["Event", report.eventName],
    ["Status", report.status === "published" ? "Published" : "Draft"],
    ["Page views", report.metrics.pageViews],
    ["Unique visitors", report.metrics.uniqueVisitors],
    ["Conversion rate", `${report.metrics.conversionRate}%`],
    ["Total people", report.metrics.totalPeople],
    ["Invite to", report.metrics.inviteTo],
    ["Invited", report.metrics.invited],
    ["Going", report.metrics.going],
    ["Waitlist", report.metrics.waitlist],
    ["Rejected", report.metrics.rejected],
    ["Registrations", report.metrics.registrations],
    ["Bot clicks", report.metrics.botClicks],
  ];
  for (const [metric, value] of summaryRows) {
    summary.addRow({ metric, value });
  }
  summary.getRow(1).font = { bold: true };

  const people = workbook.addWorksheet("People");
  people.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Email", key: "email", width: 32 },
    { header: "Company", key: "companyName", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Source", key: "source", width: 28 },
    { header: "Invite sent", key: "inviteSentAt", width: 22 },
    { header: "Bot click", key: "botClick", width: 12 },
    { header: "Added", key: "createdAt", width: 22 },
  ];
  people.getRow(1).font = { bold: true };
  for (const person of report.people) {
    people.addRow({
      name: person.name,
      email: person.email,
      companyName: person.companyName,
      phone: person.phone,
      status: person.status,
      source: person.source,
      inviteSentAt: person.inviteSentAt ?? "",
      botClick: person.botClick ? "Yes" : "No",
      createdAt: person.createdAt,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function eventReportDownloadName(eventName: string) {
  const safe = String(eventName ?? "event")
    .trim()
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${safe || "event"}-report.xlsx`;
}
