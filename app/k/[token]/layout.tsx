import { PublicReportHeader } from "@/app/components/portal/PublicReportHeader";
import { formatAnalyticsExpiry, isAnalyticsShareExpired } from "@/lib/analytics";
import { findKanbanShareByToken, kanbanShareExpiresAt } from "@/lib/analytics-kanban-server";
import { getProjectBranding } from "@/lib/project-branding";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
};

export default async function PublicKanbanTokenLayout({ children, params }: LayoutProps) {
  const { token } = await params;
  const share = await findKanbanShareByToken(token);
  const branding = share ? await getProjectBranding(share.projectId) : { name: "", logoUrl: "" };
  const clientName = branding.name || share?.projectName || "";
  const expired = Boolean(share && isAnalyticsShareExpired(share));

  return (
    <>
      <PublicReportHeader
        clientName={clientName}
        clientLogoUrl={branding.logoUrl}
        title={
          expired
            ? "This board has expired"
            : clientName
              ? `${clientName} lead pipeline`
              : "Lead pipeline"
        }
        description={
          expired
            ? "Public kanban links expire 30 days after they are created. Ask the sender for a new URL."
            : share
              ? `Leads from your campaigns, grouped by how far they have engaged. This public link expires on ${formatAnalyticsExpiry(kanbanShareExpiresAt(share))}.`
              : undefined
        }
      />
      {children}
    </>
  );
}
