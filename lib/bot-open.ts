import {
  sendHasHumanOpen,
  sendIsBotClick,
  type SendEngagementHints,
} from "@/lib/bot-engagement";

/** Matches campaign open bot-grace (first 25s after send) for ingest tagging. */
export const BOT_OPEN_GRACE_MS = 25_000;

export const BOT_OPEN_TAG = "Bot open";

export type { OpenHint, SendOpenHints } from "@/lib/bot-engagement";

function sendHasOpenSignal(send: SendEngagementHints) {
  if (send.openPixelBlocked) {
    return true;
  }
  return Boolean(send.openedAt) || (send.openCount ?? 0) > 0;
}

/** True when this send's counted open should be tagged as a bot open (Show bots ON). */
export function sendIsBotOpen(send: SendEngagementHints) {
  if (sendHasHumanOpen(send)) {
    return false;
  }
  if (sendHasOpenSignal(send)) {
    return true;
  }
  return sendIsBotClick(send);
}

export function botOpenLabel(send: SendEngagementHints) {
  return sendIsBotOpen(send) ? BOT_OPEN_TAG : "";
}

/**
 * When hiding bot engagement: exclude opens with only bot-like pixel loads,
 * unless a human click or non-bot open remains (implied open).
 */
export function sendIsBotOnlyOpen(send: SendEngagementHints) {
  return !sendHasHumanOpen(send);
}
