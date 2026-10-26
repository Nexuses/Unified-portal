"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContactDetail } from "@/lib/crm";
import { resolveContactPhotoUrl } from "@/lib/crm";
import LeadReportOverview from "@/app/components/portal/crm/LeadReportOverview";
import PublicLeadReportHeader from "@/app/components/portal/crm/PublicLeadReportHeader";

type Branding = {
  name: string;
  logoUrl: string;
};

type Props = {
  shareToken: string;
  initialContact: ContactDetail;
  initialBranding?: Branding;
};

export default function SharedLeadReport({
  shareToken,
  initialContact,
  initialBranding,
}: Props) {
  const [contact, setContact] = useState(initialContact);
  const [branding, setBranding] = useState<Branding>(
    initialBranding || { name: "", logoUrl: "" },
  );
  const [pdfBusy, setPdfBusy] = useState(false);

  const refresh = useCallback(async (): Promise<ContactDetail | null> => {
    const token = shareToken.trim();
    if (!token) return null;
    try {
      const response = await fetch(
        `/api/public/leads/${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        contact?: ContactDetail;
        branding?: Branding;
        id?: string;
      };
      const nextContact =
        data.contact && data.contact.id
          ? data.contact
          : data.id
            ? (data as unknown as ContactDetail)
            : null;
      if (nextContact?.id) {
        setContact(nextContact);
        if (data.branding) {
          setBranding({
            name: data.branding.name || "",
            logoUrl: data.branding.logoUrl || "",
          });
        }
        return nextContact;
      }
    } catch {
      /* keep last good snapshot */
    }
    return null;
  }, [shareToken]);

  useEffect(() => {
    setContact(initialContact);
  }, [initialContact]);

  useEffect(() => {
    if (initialBranding) setBranding(initialBranding);
  }, [initialBranding]);

  useEffect(() => {
    void refresh();
    function onVisible() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }
    function onFocus() {
      void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refresh(), 20000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const draftCore = {
    firstName: contact.firstName || "",
    lastName: contact.lastName || "",
    email: contact.email || "",
    companyName: contact.companyName || "",
    attributes: contact.attributes || {},
  };

  async function downloadPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const latest = (await refresh()) || contact;
      const { downloadLeadReportPdf } = await import("@/lib/lead-report-pdf");
      const token = shareToken.trim();
      await downloadLeadReportPdf(latest, {
        photoSrc: resolveContactPhotoUrl(latest.profile),
        projectName: branding.name || latest.owner,
        projectLogoSrc:
          branding.logoUrl ||
          (token
            ? `/api/public/leads/${encodeURIComponent(token)}/project-logo`
            : ""),
        nexusesLogoSrc: "/api/brand/nexuses-logo",
      });
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <PublicLeadReportHeader
        clientName={branding.name || contact.owner}
        clientLogoUrl={branding.logoUrl}
        pdfBusy={pdfBusy}
        onDownloadPdf={() => void downloadPdf()}
      />
      <div className="lr-public-shell">
        <LeadReportOverview
          contact={contact}
          editing={null}
          saving={false}
          draftProfile={contact.profile || {}}
          draftCore={draftCore}
          setDraftCore={() => {}}
          patchProfile={() => {}}
          beginEdit={() => {}}
          cancelEdit={() => {}}
          saveSection={() => {}}
          historyEvents={contact.history}
          campaignStats={contact.campaignStats}
          readOnly
        />
      </div>
    </>
  );
}
