import PortalCompanyDetailPage from "@/app/components/portal/crm/PortalCompanyDetailPage";

export default async function CompanyDetailPage({
  params,
}: PageProps<"/portal/crm/companies/[id]">) {
  const { id } = await params;
  return <PortalCompanyDetailPage companyId={id} />;
}
