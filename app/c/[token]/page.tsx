import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedContactDetail } from "@/app/components/portal/crm/PortalContactDetailPage";
import { getPublicContactByShareToken } from "@/lib/crm-contacts-server";
import { publicContactReturnPath } from "@/lib/portal-nav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ from?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const found = await getPublicContactByShareToken(token);
  const name = found?.contact.fullName?.trim();
  return {
    title: name ? `${name} · Contact` : "Contact",
  };
}

export default async function PublicContactPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const { from } = await searchParams;
  const found = await getPublicContactByShareToken(token);
  if (!found) {
    notFound();
  }

  const backHref = publicContactReturnPath(from);

  return (
    <div className="public-contact-shell">
      <SharedContactDetail
        contact={found.contact}
        backHref={backHref || undefined}
      />
    </div>
  );
}
