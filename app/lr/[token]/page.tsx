import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicLeadReportsList from "@/app/components/portal/crm/PublicLeadReportsList";
import { isAnalyticsShareExpired } from "@/lib/analytics";
import { normalizeLeadReportColumns } from "@/lib/lead-reports-columns";
import {
  findLeadReportsShareByToken,
  getPublicLeadReportsBundle,
} from "@/lib/lead-reports-share-server";

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await findLeadReportsShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return { title: share ? "Lead reports expired" : "Shared lead reports" };
  }
  return { title: share.title || "Lead reports" };
}

export default async function PublicLeadReportsPage({ params }: PageProps) {
  const { token } = await params;
  const share = await findLeadReportsShareByToken(token);
  if (!share) {
    notFound();
  }
  if (isAnalyticsShareExpired(share)) {
    return (
      <div className="public-lr-expired-wrap">
        <div className="public-lr-expired">
          <h1>This link expired</h1>
          <p>Ask for a new public lead reports URL.</p>
        </div>
      </div>
    );
  }

  const bundle = await getPublicLeadReportsBundle(token);
  if (!bundle) {
    notFound();
  }

  return (
    <PublicLeadReportsList
      token={token}
      initial={{
        projectName: bundle.projectName,
        projectLogoUrl: bundle.projectLogoUrl,
        columns: normalizeLeadReportColumns(bundle.columns),
        items: bundle.items,
        total: bundle.total,
        expiresAt: bundle.expiresAt,
      }}
    />
  );
}
