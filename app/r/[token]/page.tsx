import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedCampaignReport } from "@/app/components/portal/PortalCampaignReport";
import { getAnalyticsShareByToken } from "@/lib/analytics-server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ a?: string; hideBotClicks?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const found = await getDripCampaignByShareToken(token);
  return {
    title: found ? `${found.campaign.name} report` : "Campaign report",
  };
}

export default async function PublicCampaignReportPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { a, hideBotClicks: hideBotParam } = await searchParams;
  const found = await getDripCampaignByShareToken(token);
  if (!found) {
    notFound();
  }

  let analyticsToken: string | undefined;
  let hideBotClicks = hideBotParam === "1";
  const requested = a?.trim();
  if (requested) {
    const share = await getAnalyticsShareByToken(requested);
    if (share && share.projectId.toString() === found.projectId.toString()) {
      analyticsToken = requested;
      if (share.hideBotClicks) {
        hideBotClicks = true;
      }
    }
  }

  return (
    <SharedCampaignReport
      campaign={found.campaign}
      publicToken={token}
      analyticsToken={analyticsToken}
      hideBotClicks={hideBotClicks}
    />
  );
}
