import { Suspense } from "react";
import PortalCloudCampaignDetailPage from "@/app/components/portal/PortalCloudCampaignDetailPage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CloudCampaignDetailRoute({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="portal-loading-screen">Loading campaign…</div>}>
      <PortalCloudCampaignDetailPage campaignId={id} />
    </Suspense>
  );
}
