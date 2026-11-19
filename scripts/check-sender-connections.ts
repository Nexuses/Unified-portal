import { refreshAllSenderConnections } from "@/lib/smtp-senders-server";

async function main() {
  const results = await refreshAllSenderConnections();
  const connected = results.filter((item) => item.status === "connected");
  const disconnected = results.filter((item) => item.status === "disconnected");
  console.log(
    JSON.stringify({
      total: results.length,
      connected: connected.length,
      disconnected: disconnected.length,
      failed: disconnected.map((item) => ({ email: item.fromEmail, error: item.error })),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Sender check failed");
  process.exit(1);
});
