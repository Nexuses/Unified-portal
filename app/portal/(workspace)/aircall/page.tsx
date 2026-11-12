import { Suspense } from "react";
import PortalAircallPage from "@/app/components/portal/PortalAircallPage";

export default function AircallPage() {
  return (
    <Suspense
      fallback={
        <div className="crm-page-head">
          <h2>Aircall calling</h2>
        </div>
      }
    >
      <PortalAircallPage />
    </Suspense>
  );
}
