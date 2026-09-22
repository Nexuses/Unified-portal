/**
 * Starts the in-process campaign send worker on the Node server.
 * On Vultr (`next start`), this keeps drip + 1-1 sending even when the portal is closed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startCampaignSendWorker } = await import(
    "./lib/campaign-send-worker"
  );
  startCampaignSendWorker();
}
