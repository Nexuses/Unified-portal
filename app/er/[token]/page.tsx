import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventReportBoard } from "@/components/event-report-board";
import { buildEventReportByShareToken } from "@/lib/event-report";

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const report = await buildEventReportByShareToken(token);
  return {
    title: report ? `${report.eventName} report` : "Event report",
  };
}

export default async function PublicEventReportPage({ params }: PageProps) {
  const { token } = await params;
  const report = await buildEventReportByShareToken(token);
  if (!report) {
    notFound();
  }

  return <EventReportBoard report={report} publicToken={token} />;
}
