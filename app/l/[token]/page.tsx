import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedLeadReport from "@/app/components/portal/crm/SharedLeadReport";
import { getPublicContactByShareToken } from "@/lib/crm-contacts-server";
import { getProjectBranding } from "@/lib/project-branding";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const found = await getPublicContactByShareToken(token);
  const name = found?.contact.fullName?.trim();
  return {
    title: name ? `${name} · Lead report` : "Lead report",
  };
}

export default async function PublicLeadReportPage({ params }: PageProps) {
  const { token } = await params;
  const found = await getPublicContactByShareToken(token);
  if (!found) {
    notFound();
  }

  const branding = await getProjectBranding(found.projectId);

  return (
    <SharedLeadReport
      shareToken={token}
      initialContact={found.contact}
      initialBranding={{
        name: branding.name,
        logoUrl: branding.logoUrl
          ? `/api/public/leads/${encodeURIComponent(token)}/project-logo`
          : "",
      }}
    />
  );
}
