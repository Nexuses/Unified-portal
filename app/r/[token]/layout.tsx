import { PublicReportHeader } from "@/app/components/portal/PublicReportHeader";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";
import { getProjectBranding } from "@/lib/project-branding";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
};

export default async function PublicCampaignTokenLayout({
  children,
  params,
}: LayoutProps) {
  const { token } = await params;
  const found = await getDripCampaignByShareToken(token);
  const branding = found
    ? await getProjectBranding(found.projectId)
    : { name: "", logoUrl: "" };
  const campaign = found?.campaign;

  return (
    <>
      <PublicReportHeader
        clientName={branding.name}
        clientLogoUrl={branding.logoUrl}
        title={campaign?.name || "Campaign report"}
        description={
          campaign
            ? `#${campaign.id}${campaign.kind === "oneone" ? " · 1-1 campaign" : " · Drip campaign"} report`
            : undefined
        }
      />
      {children}
    </>
  );
}
