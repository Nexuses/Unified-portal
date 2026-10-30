import {
  sendHasHumanClick,
  sendIsBotClick,
  type SendClickHints,
} from "@/lib/bot-click";

/** Matches campaign open bot-grace (first 25s after send). */
export const BOT_OPEN_GRACE_MS = 25_000;

/** Shown in campaign report Opens view when an open is bot-like. */
export const BOT_OPEN_TAG = "Bot open";

type OpenHint = {
  at?: Date | string;
  bot?: boolean;
};

type SendOpenHints = {
  sentAt?: Date | string | null;
  openedAt?: Date | string | null;
  botOpen?: boolean;
  openEvents?: OpenHint[];
};

type SendOpenHideHints = SendOpenHints & SendClickHints;

function asTimeMs(value: Date | string | null | undefined) {
  if (!value) {
    return NaN;
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/** True when this send's counted open should be tagged as a bot open. */
export function sendIsBotOpen(send: SendOpenHints) {
  if (send.botOpen) {
    return true;
  }
  const events = send.openEvents ?? [];
  if (events.some((event) => event.bot === true)) {
    return true;
  }
  const openedAt = asTimeMs(send.openedAt);
  const sentAt = asTimeMs(send.sentAt);
  if (
    Number.isFinite(openedAt) &&
    Number.isFinite(sentAt) &&
    openedAt - sentAt < BOT_OPEN_GRACE_MS
  ) {
    return true;
  }
  if (events.length > 0) {
    const first = [...events].sort(
      (left, right) => asTimeMs(left.at) - asTimeMs(right.at),
    )[0];
    const at = asTimeMs(first?.at);
    if (
      Number.isFinite(at) &&
      Number.isFinite(sentAt) &&
      at - sentAt < BOT_OPEN_GRACE_MS
    ) {
      return true;
    }
  }
  return false;
}

export function botOpenLabel(send: SendOpenHints) {
  return sendIsBotOpen(send) ? BOT_OPEN_TAG : "";
}

/**
 * When hiding bot engagement: exclude opens that look bot-like, or opens that
 * only came with scanner/multi-link clicks, unless a real human click remains.
 */
export function sendIsBotOnlyOpen(send: SendOpenHideHints) {
  if (sendHasHumanClick(send)) {
    return false;
  }
  return sendIsBotOpen(send) || sendIsBotClick(send);
}
