import PortalAnalyticsKanban from "@/app/components/portal/PortalAnalyticsKanban";

export default async function AnalyticsKanbanBoardPage({
  params,
}: PageProps<"/portal/analytics/kanban/[id]">) {
  const { id } = await params;
  return <PortalAnalyticsKanban boardId={id} />;
}
