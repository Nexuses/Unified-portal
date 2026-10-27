import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PortalAnalyticsKanban from "@/app/components/portal/PortalAnalyticsKanban";
import { isAnalyticsShareExpired } from "@/lib/analytics";
import { findKanbanShareByToken, getSharedKanbanBoard } from "@/lib/analytics-kanban-server";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string; hideBotClicks?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await findKanbanShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return { title: share ? "Board expired" : "Pipeline board" };
  }
  return { title: `${share.projectName} lead pipeline` };
}

export default async function PublicKanbanPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { view, hideBotClicks: hideBotParam } = await searchParams;
  const share = await findKanbanShareByToken(token);
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
  const board = await getSharedKanbanBoard(share);
  if (!board) {
    return (
      <div className="an-page an-public">
        <div className="an-empty">This board is no longer available.</div>
      </div>
    );
  }
  return (
    <div className="an-public">
      <PortalAnalyticsKanban
        boardId={board.id}
        sharedBoard={board}
        shareToken={token}
        initialView={view === "funnel" ? "funnel" : "board"}
        initialHideBotClicks={hideBotParam === "1"}
      />
    </div>
  );
}
