import { Suspense } from "react";
import PortalBotsPage from "@/app/components/portal/PortalBotsPage";

export default function BotsPage() {
  // useSearchParams (?bot=) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <PortalBotsPage />
    </Suspense>
  );
}
