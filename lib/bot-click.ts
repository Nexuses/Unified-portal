/** Matches campaign click bot-grace (first 45s after send). */
export const BOT_CLICK_GRACE_MS = 45_000;
/** Matches campaign burst window for multi-link scanners. */
const BOT_CLICK_BURST_WINDOW_MS = 5_000;
const BOT_CLICK_BURST_DISTINCT_URLS = 2;

/** Shown in campaign report Clicks view when a click is bot/scanner-like. */
export const BOT_CLICK_TAG = "Bot click";

type ClickHint = {
  url?: string;
  at?: Date | string;
  bot?: boolean;
  ignored?: boolean;
};

type SendClickHints = {
  sentAt?: Date | string | null;
  clickedAt?: Date | string | null;
  clickedUrl?: string | null;
  botClick?: boolean;
  clickBurstIgnored?: boolean;
  clickEvents?: ClickHint[];
};

function asTimeMs(value: Date | string | null | undefined) {
  if (!value) {
    return NaN;
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function normalizeClickUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString().toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function eventsLookLikeBurst(events: ClickHint[]) {
  const list = events
    .map((event) => ({
      url: normalizeClickUrl(event.url ?? ""),
      at: asTimeMs(event.at),
    }))
    .filter((event) => Number.isFinite(event.at))
    .sort((left, right) => left.at - right.at);
  for (let start = 0; start < list.length; start += 1) {
    const window = list.filter(
      (event) =>
        event.at >= list[start].at &&
        event.at - list[start].at <= BOT_CLICK_BURST_WINDOW_MS,
    );
    const distinct = new Set(window.map((event) => event.url).filter(Boolean));
    if (distinct.size >= BOT_CLICK_BURST_DISTINCT_URLS || window.length >= 3) {
      return true;
    }
  }
  return false;
}

/** True when this click event looks like a bot (grace window, flag, or ignored). */
export function clickEventIsBot(send: SendClickHints, event: ClickHint) {
  if (event.bot || event.ignored) {
    return true;
  }
  const sentAt = asTimeMs(send.sentAt);
  const at = asTimeMs(event.at);
  if (Number.isFinite(sentAt) && Number.isFinite(at) && at - sentAt < BOT_CLICK_GRACE_MS) {
    return true;
  }
  return false;
}

/**
 * True when this send's counted click(s) should be tagged as bot clicks
 * (early after send, multi-link burst, or explicit flags).
 */
export function sendIsBotClick(send: SendClickHints) {
  if (send.botClick || send.clickBurstIgnored) {
    return true;
  }
  const events = (send.clickEvents ?? []).filter((event) => !event.ignored);
  if (events.length > 0) {
    if (eventsLookLikeBurst(events)) {
      return true;
    }
    const first = [...events].sort(
      (left, right) => asTimeMs(left.at) - asTimeMs(right.at),
    )[0];
    if (first && clickEventIsBot(send, first)) {
      return true;
    }
    return events.some((event) => event.bot === true);
  }
  const clickedAt = asTimeMs(send.clickedAt);
  const sentAt = asTimeMs(send.sentAt);
  if (
    Number.isFinite(clickedAt) &&
    Number.isFinite(sentAt) &&
    clickedAt - sentAt < BOT_CLICK_GRACE_MS
  ) {
    return true;
  }
  return false;
}

export function botClickLabel(send: SendClickHints) {
  return sendIsBotClick(send) ? BOT_CLICK_TAG : "";
}
