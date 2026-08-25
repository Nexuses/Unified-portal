import PortalCampaignDetailPage from "@/app/components/portal/PortalCampaignDetailPage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <PortalCampaignDetailPage campaignId={id} />;
}
