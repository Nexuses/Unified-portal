import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedCampaignReport } from "@/app/components/portal/PortalCampaignReport";
import { getAnalyticsShareByToken } from "@/lib/analytics-server";
import { getDripCampaignByShareToken } from "@/lib/drip-campaigns-server";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    a?: string;
    hideBotClicks?: string;
    botToggle?: string;
  }>;
};

function parseHideBotParam(value: string | undefined) {
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return null;
}

function parseBotToggleParam(value: string | undefined) {
  return value === "1" || value === "true";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const found = await getDripCampaignByShareToken(token);
  return {
    title: found ? `${found.campaign.name} report` : "Campaign report",
  };
}

export default async function PublicCampaignReportPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const {
    a,
    hideBotClicks: hideBotParam,
    botToggle: botToggleParam,
  } = await searchParams;
  const found = await getDripCampaignByShareToken(token);
  if (!found) {
    notFound();
  }

  let analyticsToken: string | undefined;
  const hideBotFromQuery = parseHideBotParam(hideBotParam);
  let hideBotClicks = hideBotFromQuery === true;
  let allowBotToggle = parseBotToggleParam(botToggleParam);
  const requested = a?.trim();
  if (requested) {
    const share = await getAnalyticsShareByToken(requested);
    if (share && share.projectId.toString() === found.projectId.toString()) {
      analyticsToken = requested;
      allowBotToggle = allowBotToggle || Boolean(share.botToggle);
      if (allowBotToggle) {
        hideBotClicks =
          hideBotFromQuery ?? Boolean(share.hideBotClicks);
      } else if (share.hideBotClicks) {
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
      allowBotToggle={allowBotToggle}
    />
  );
}
