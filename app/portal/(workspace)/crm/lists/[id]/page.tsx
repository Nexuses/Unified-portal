import PortalListDetailPage from "@/app/components/portal/crm/PortalListDetailPage";

export default async function ListDetailPage({
  params,
}: PageProps<"/portal/crm/lists/[id]">) {
  const { id } = await params;
  return <PortalListDetailPage listId={id} />;
}
