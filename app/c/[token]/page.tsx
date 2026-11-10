import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedContactDetail } from "@/app/components/portal/crm/PortalContactDetailPage";
import { getPublicContactByShareToken } from "@/lib/crm-contacts-server";

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
    title: name ? `${name} · Contact` : "Contact",
  };
}

export default async function PublicContactPage({ params }: PageProps) {
  const { token } = await params;
  const found = await getPublicContactByShareToken(token);
  if (!found) {
    notFound();
  }

  return (
    <div className="public-contact-shell">
      <SharedContactDetail contact={found.contact} />
    </div>
  );
}
