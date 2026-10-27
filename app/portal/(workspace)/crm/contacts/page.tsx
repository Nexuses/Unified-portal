import { Suspense } from "react";
import PortalContactsPage from "@/app/components/portal/crm/PortalContactsPage";

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="crm-page-head"><h2>Contacts</h2></div>}>
      <PortalContactsPage />
    </Suspense>
  );
}
