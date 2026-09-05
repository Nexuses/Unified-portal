import { Suspense } from "react";
import PortalAutomationPage from "@/app/components/portal/PortalAutomationPage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AutomationEditPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="portal-loading-screen">Loading automation…</div>}>
      <PortalAutomationPage mode="edit" automationId={id} />
    </Suspense>
  );
}
