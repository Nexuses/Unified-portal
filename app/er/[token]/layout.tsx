import { PublicReportHeader } from "@/app/components/portal/PublicReportHeader";
import { getEventByShareToken } from "@/lib/events";
import { getProjectBranding } from "@/lib/project-branding";
import { ObjectId } from "mongodb";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
};

export default async function PublicEventReportLayout({
  children,
  params,
}: LayoutProps) {
  const { token } = await params;
  const event = await getEventByShareToken(token);
  const projectId =
    event?.projectId && ObjectId.isValid(event.projectId)
      ? new ObjectId(event.projectId)
      : null;
  const branding = projectId
    ? await getProjectBranding(projectId)
    : { name: "", logoUrl: "" };

  return (
    <>
      <PublicReportHeader
        clientName={branding.name}
        clientLogoUrl={branding.logoUrl}
        title={event?.eventName ? `${event.eventName} report` : "Event report"}
      />
      {children}
    </>
  );
}
