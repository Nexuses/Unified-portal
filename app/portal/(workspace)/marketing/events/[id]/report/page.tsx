import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { EventReportBoard } from "@/components/event-report-board";
import { buildEventReportPayload } from "@/lib/event-report";

type EventReportPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function EventReportPage({ params }: EventReportPageProps) {
  const session = await getSessionUser();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const report = await buildEventReportPayload(id);
  if (!report || report.projectId !== session.projectId) {
    notFound();
  }

  return <EventReportBoard report={report} />;
}
