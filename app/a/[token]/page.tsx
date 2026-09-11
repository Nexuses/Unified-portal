import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicAnalyticsReport } from "@/app/components/portal/PortalAnalyticsPage";
import { formatAnalyticsRange, isAnalyticsShareExpired } from "@/lib/analytics";
import {
  findAnalyticsShareByToken,
  getAnalyticsDashboard,
} from "@/lib/analytics-server";

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await findAnalyticsShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return { title: share ? "Report expired" : "Analytics report" };
  }
  return {
    title: `${share.projectName} analytics · ${formatAnalyticsRange(share.from, share.to)}`,
  };
}

export default async function PublicAnalyticsPage({ params }: PageProps) {
  const { token } = await params;
  const share = await findAnalyticsShareByToken(token);
  if (!share) {
    notFound();
  }
  if (isAnalyticsShareExpired(share)) {
    return (
      <div className="an-page an-public">
        <div className="an-empty">
          This public link expired after 30 days. Ask the sender to create a new URL.
        </div>
      </div>
    );
  }

  const dashboard = await getAnalyticsDashboard(
    share.projectId,
    share.from,
    share.to,
    share.projectName,
    { withShareTokens: true },
  );

  return <PublicAnalyticsReport dashboard={dashboard} analyticsToken={token} />;
}
