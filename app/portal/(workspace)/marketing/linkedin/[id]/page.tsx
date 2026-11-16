import PortalLinkedinBoardPage from "@/app/components/portal/PortalLinkedinBoardPage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function LinkedinCampaignPage({ params }: PageProps) {
  const { id } = await params;
  return <PortalLinkedinBoardPage campaignId={id} />;
}
