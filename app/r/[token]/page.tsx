import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedCampaignReport } from "@/app/components/portal/PortalCampaignReport";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const found = await getDripCampaignByShareToken(token);
  return {
    title: found ? `${found.campaign.name} report` : "Campaign report",
  };
}

export default async function PublicCampaignReportPage({ params }: PageProps) {
  const { token } = await params;
  const found = await getDripCampaignByShareToken(token);
  if (!found) {
    notFound();
  }

  return <SharedCampaignReport campaign={found.campaign} publicToken={token} />;
}
