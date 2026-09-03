import PortalCampaignDetailPage from "@/app/components/portal/PortalCampaignDetailPage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function OneOneCampaignDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <PortalCampaignDetailPage campaignId={id} kind="oneone" />;
}
