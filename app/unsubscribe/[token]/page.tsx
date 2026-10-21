import UnsubscribePublicPage from "@/app/components/portal/UnsubscribePublicPage";
import { getCampaignSendByToken } from "@/lib/campaign-blasts-server";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function PublicUnsubscribePage({ params }: PageProps) {
  const { token } = await params;
  const send = await getCampaignSendByToken(token);

  if (!send) {
    return (
      <div className="unsub-public-page">
        <div className="unsub-public-card">
          <h1>Unsubscribe</h1>
          <p>This unsubscribe link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  // Do not pass the recipient email: the client types it manually.
  return <UnsubscribePublicPage token={token} />;
}
