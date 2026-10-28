import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicAnalyticsReport } from "@/app/components/portal/PortalAnalyticsPage";
import {
  filterAnalyticsDashboardByKinds,
  formatAnalyticsRange,
  isAnalyticsShareExpired,
  type AnalyticsDashboard,
} from "@/lib/analytics";
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

  const hideBotClicks = Boolean(share.hideBotClicks);
  const botToggle = Boolean(share.botToggle);
  const kinds = share.includeKinds;

  function applyKinds(dashboard: AnalyticsDashboard) {
    return filterAnalyticsDashboardByKinds(dashboard, kinds);
  }

  let dashboard: AnalyticsDashboard;
  let dashboardWithBots: AnalyticsDashboard | undefined;

  if (botToggle) {
    const [hidden, shown] = await Promise.all([
      getAnalyticsDashboard(share.projectId, share.from, share.to, share.projectName, {
        withShareTokens: true,
        hideBotClicks: true,
      }),
      getAnalyticsDashboard(share.projectId, share.from, share.to, share.projectName, {
        withShareTokens: true,
        hideBotClicks: false,
      }),
    ]);
    dashboard = applyKinds(hidden);
    dashboardWithBots = applyKinds(shown);
  } else {
    dashboard = applyKinds(
      await getAnalyticsDashboard(
        share.projectId,
        share.from,
        share.to,
        share.projectName,
        { withShareTokens: true, hideBotClicks },
      ),
    );
  }

  return (
    <PublicAnalyticsReport
      dashboard={dashboard}
      dashboardWithBots={dashboardWithBots}
      analyticsToken={token}
      hideBotClicks={hideBotClicks}
      botToggle={botToggle}
    />
  );
}
