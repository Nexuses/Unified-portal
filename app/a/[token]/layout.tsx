import { PublicReportHeader } from "@/app/components/portal/PublicReportHeader";
import {
  formatAnalyticsExpiry,
  formatAnalyticsRange,
  isAnalyticsShareExpired,
  resolveAnalyticsShareExpiry,
} from "@/lib/analytics";
import { findAnalyticsShareByToken } from "@/lib/analytics-server";
import { getProjectBranding } from "@/lib/project-branding";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
};

export default async function PublicAnalyticsTokenLayout({
  children,
  params,
}: LayoutProps) {
  const { token } = await params;
  const share = await findAnalyticsShareByToken(token);
  const branding = share
    ? await getProjectBranding(share.projectId)
    : { name: "", logoUrl: "" };
  const clientName = branding.name || share?.projectName || "";
  const expired = Boolean(share && isAnalyticsShareExpired(share));

  return (
    <>
      <PublicReportHeader
        clientName={clientName}
        clientLogoUrl={branding.logoUrl}
        title={
          expired
            ? "This report has expired"
            : clientName
              ? `${clientName} analytics`
              : "Analytics"
        }
        description={
          expired
            ? "Public analytics links expire 30 days after they are created. Ask the sender for a new URL."
            : share
              ? `Email performance for ${formatAnalyticsRange(share.from, share.to)}. Open a campaign to see its full report. This public link expires on ${formatAnalyticsExpiry(resolveAnalyticsShareExpiry(share))}.`
              : undefined
        }
      />
      {children}
    </>
  );
}
