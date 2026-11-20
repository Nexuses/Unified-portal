import { notFound, redirect } from "next/navigation";
import { revalidateEventPages } from "@/lib/revalidate-dashboard";
import { getEventByPublicId } from "@/lib/events";
import {
  acceptWebinarInviteByPublicId,
  acceptWebinarInviteBySubmissionId,
} from "@/lib/submissions";

type AcceptInvitePageProps = {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ sid?: string; email?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * Email "Accept invite" lands here. Confirm attendance immediately and send the
 * guest to the public event page with the thank-you modal — no second Accept step.
 */
export default async function AcceptInvitePage({ params, searchParams }: AcceptInvitePageProps) {
  const { publicId } = await params;
  const query = await searchParams;
  const sid = query.sid?.trim() ?? "";
  const email = query.email?.trim() ?? "";

  if (!sid && !email) {
    redirect(`/e/${publicId}`);
  }

  const event = await getEventByPublicId(publicId);
  if (!event || event.status !== "published") {
    notFound();
  }

  let accepted = false;
  try {
    if (sid) {
      await acceptWebinarInviteBySubmissionId(publicId, sid);
    } else {
      const decodedEmail = decodeURIComponent(email.replace(/ /g, "+"));
      await acceptWebinarInviteByPublicId(publicId, decodedEmail);
    }
    revalidateEventPages({ publicId });
    accepted = true;
  } catch {
    accepted = false;
  }

  redirect(accepted ? `/e/${publicId}?going=1` : `/e/${publicId}?accept-error=1`);
}
