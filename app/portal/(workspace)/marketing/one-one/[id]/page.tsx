import { Suspense } from "react";
import PortalCampaignDetailPage from "@/app/components/portal/PortalCampaignDetailPage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function OneOneCampaignDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="portal-loading-screen">Loading campaign…</div>}>
      <PortalCampaignDetailPage campaignId={id} kind="oneone" />
    </Suspense>
  );
}
