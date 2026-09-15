import PortalContactDetailPage from "@/app/components/portal/crm/PortalContactDetailPage";

export default async function ContactDetailPage({
  params,
  searchParams,
}: PageProps<"/portal/crm/contacts/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const from = typeof query.from === "string" ? query.from : undefined;
  return <PortalContactDetailPage contactId={id} from={from} />;
}
