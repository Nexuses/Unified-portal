import { Suspense } from "react";
import AutomationUnderDevelopment from "@/app/components/portal/AutomationUnderDevelopment";
import PortalAutomationPage from "@/app/components/portal/PortalAutomationPage";
import { AUTOMATION_UNDER_DEVELOPMENT } from "@/lib/automations";

export default function AutomationPage() {
  if (AUTOMATION_UNDER_DEVELOPMENT) {
    return <AutomationUnderDevelopment />;
  }

  return (
    <Suspense fallback={<div className="portal-loading-screen">Loading automation…</div>}>
      <PortalAutomationPage mode="create" />
    </Suspense>
  );
}
