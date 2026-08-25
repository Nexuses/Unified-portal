import PortalContactDetailPage from "@/app/components/portal/crm/PortalContactDetailPage";

export default async function ContactDetailPage({
  params,
}: PageProps<"/portal/crm/contacts/[id]">) {
  const { id } = await params;
  return <PortalContactDetailPage contactId={id} />;
}
