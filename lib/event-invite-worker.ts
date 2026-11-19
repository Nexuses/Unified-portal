let started = false;

/** Sends event invites that were scheduled for later. */
export function startEventInviteWorker() {
  if (started) {
    return;
  }
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  started = true;

  const tick = async () => {
    try {
      const { dispatchDueScheduledInvites } = await import("./scheduled-invites");
      await dispatchDueScheduledInvites();
    } catch (error) {
      console.error("[event-invites]", error);
    }
  };

  setTimeout(() => {
    void tick();
  }, 20_000);
  setInterval(() => {
    void tick();
  }, 60_000);
}
