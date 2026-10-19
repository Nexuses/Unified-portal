import { Suspense } from "react";
import AutomationUnderDevelopment from "@/app/components/portal/AutomationUnderDevelopment";
import PortalAutomationPage from "@/app/components/portal/PortalAutomationPage";
import { AUTOMATION_UNDER_DEVELOPMENT } from "@/lib/automations";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AutomationEditPage({ params }: PageProps) {
  if (AUTOMATION_UNDER_DEVELOPMENT) {
    return <AutomationUnderDevelopment />;
  }

  const { id } = await params;
  return (
    <Suspense fallback={<div className="portal-loading-screen">Loading automation…</div>}>
      <PortalAutomationPage mode="edit" automationId={id} />
    </Suspense>
  );
}
