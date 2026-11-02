import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicAllProjectsStatsPanel from "@/app/components/PublicAllProjectsStatsPanel";
import {
  findAllProjectsStatsShareByToken,
} from "@/lib/all-projects-stats-share-server";
import { isAnalyticsShareExpired } from "@/lib/analytics";

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await findAllProjectsStatsShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return { title: share ? "Report expired" : "Shared project performance" };
  }
  return { title: share.title || "All projects performance" };
}

export default async function PublicAllProjectsPage({ params }: PageProps) {
  const { token } = await params;
  const share = await findAllProjectsStatsShareByToken(token);
  if (!share) {
    notFound();
  }
  if (isAnalyticsShareExpired(share)) {
    return (
      <div className="admin-page admin-all-projects admin-all-projects-public">
        <div className="admin-card admin-list-card">
          <div className="admin-stats-body">
            <p className="admin-empty">
              This public link expired after 30 days. Ask for a new URL.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PublicAllProjectsStatsPanel
      token={share.token}
      title={share.title || "All projects performance"}
    />
  );
}
