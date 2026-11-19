const DEV_POLL_INTERVAL_MS = 30_000;

let devPollerStarted = false;

/**
 * Prefer localhost over 127.0.0.1 — on macOS, Next often binds IPv6 while
 * another process can own IPv4 on the same port (causing 404s).
 */
function getDevServerOrigin() {
  const fromEnv = process.env.DEV_SERVER_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}`;
}

async function triggerDevDispatch() {
  const secret = process.env.CRON_SECRET?.trim();
  const headers: Record<string, string> = {};
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }

  const origin = getDevServerOrigin();
  const response = await fetch(`${origin}/api/invites/dispatch`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      payload?.message ?? `Dispatch failed with status ${response.status} at ${origin}.`
    );
  }
}

export function startDevScheduledInvitePoller() {
  if (devPollerStarted || process.env.NODE_ENV !== "development") {
    return;
  }

  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  devPollerStarted = true;
  const tick = () => {
    void triggerDevDispatch().catch((error) => {
      console.error("[scheduled-invites] Dev poller failed:", error);
    });
  };

  setTimeout(tick, 5_000);
  setInterval(tick, DEV_POLL_INTERVAL_MS);
}
