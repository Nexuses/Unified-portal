import { Suspense } from "react";
import PortalAutomationPage from "@/app/components/portal/PortalAutomationPage";

export default function AutomationPage() {
  return (
    <Suspense fallback={<div className="portal-loading-screen">Loading automation…</div>}>
      <PortalAutomationPage mode="create" />
    </Suspense>
  );
}
