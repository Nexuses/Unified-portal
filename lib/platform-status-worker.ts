const INTERVAL_MS = 2 * 60 * 1000;
const FIRST_DELAY_MS = 20_000;

type WorkerGlobal = typeof globalThis & {
  __nexusesPlatformStatusWorker?: boolean;
};

/** Check every API in the background and post to Slack when one stays down. */
export function startPlatformStatusWorker() {
  const g = globalThis as WorkerGlobal;
  if (g.__nexusesPlatformStatusWorker) return;
  g.__nexusesPlatformStatusWorker = true;

  const tick = () => {
    void import("@/lib/platform-status")
      .then((mod) => mod.runPlatformStatusCheck())
      .catch(() => {
        console.error("[status] platform check failed");
      });
  };

  const first = setTimeout(tick, FIRST_DELAY_MS);
  const timer = setInterval(tick, INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
}
