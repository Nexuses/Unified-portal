import { isClickTrapUrl } from "@/lib/campaign-tracking";

/** @deprecated Click bots use honeypot trap links; kept for older report math. */
export const BOT_CLICK_GRACE_MS = 25_000;
/** Matches campaign burst window for multi-link scanners. */
const BOT_CLICK_BURST_WINDOW_MS = 5_000;
const BOT_CLICK_BURST_DISTINCT_URLS = 2;

/** Shown in campaign report Clicks view when a click is bot/scanner-like. */
export const BOT_CLICK_TAG = "Bot click";

export type ClickHint = {
  url?: string;
  at?: Date | string;
  bot?: boolean;
  ignored?: boolean;
};

export type SendClickHints = {
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

function timedClickEvents(events: ClickHint[]) {
  return events
    .map((event) => ({
      url: normalizeClickUrl(event.url ?? ""),
      at: asTimeMs(event.at),
    }))
    .filter((event) => Number.isFinite(event.at))
    .sort((left, right) => left.at - right.at);
}

function eventsLookLikeBurst(events: ClickHint[]) {
  const list = timedClickEvents(events);
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

/** True when this event sits inside a multi-link / rapid-fire scanner burst. */
function eventIsInBurst(events: ClickHint[], event: ClickHint) {
  const at = asTimeMs(event.at);
  if (!Number.isFinite(at)) {
    return false;
  }
  const list = timedClickEvents(events);
  if (list.length < 2) {
    return false;
  }
  for (let start = 0; start < list.length; start += 1) {
    const windowStart = list[start].at;
    if (at < windowStart || at - windowStart > BOT_CLICK_BURST_WINDOW_MS) {
      continue;
    }
    const window = list.filter(
      (item) =>
        item.at >= windowStart &&
        item.at - windowStart <= BOT_CLICK_BURST_WINDOW_MS,
    );
    const distinct = new Set(window.map((item) => item.url).filter(Boolean));
    if (distinct.size >= BOT_CLICK_BURST_DISTINCT_URLS || window.length >= 3) {
      return true;
    }
  }
  return false;
}

/** True when this send ever hit the hidden /nxs-click-trap honeypot. */
export function sendHasTrapClick(send: SendClickHints) {
  if (isClickTrapUrl(send.clickedUrl ?? "")) {
    return true;
  }
  return (send.clickEvents ?? []).some((event) =>
    isClickTrapUrl(event.url ?? ""),
  );
}

/**
 * True when this click event looks like a bot (honeypot trap, sticky flag,
 * ignored, or multi-link scanner burst). Used when "Show bot opens/clicks"
 * is off so scanner clicks are not counted as human.
 */
export function clickEventIsBot(send: SendClickHints, event: ClickHint) {
  if (event.bot || event.ignored) {
    return true;
  }
  if (isClickTrapUrl(event.url ?? "")) {
    return true;
  }
  // Scanners that hit the trap contaminate the whole send.
  if (sendHasTrapClick(send) || send.botClick) {
    return true;
  }
  const peers = (send.clickEvents ?? []).filter((item) => !item.ignored);
  if (peers.length >= 2 && eventIsInBurst(peers, event)) {
    return true;
  }
  return false;
}

/**
 * True when this send's counted click(s) should be tagged as bot clicks
 * (honeypot trap, multi-link burst, or explicit flags).
 */
export function sendIsBotClick(send: SendClickHints) {
  if (send.botClick || send.clickBurstIgnored || sendHasTrapClick(send)) {
    return true;
  }
  const events = (send.clickEvents ?? []).filter((event) => !event.ignored);
  if (events.length > 0) {
    if (eventsLookLikeBurst(events)) {
      return true;
    }
    return events.some((event) => event.bot === true || isClickTrapUrl(event.url ?? ""));
  }
  return isClickTrapUrl(send.clickedUrl ?? "");
}

export function botClickLabel(send: SendClickHints) {
  return sendIsBotClick(send) ? BOT_CLICK_TAG : "";
}

/**
 * True when this send has at least one non-bot click event.
 * Used so a human click keeps the contact in Opens when bot opens/clicks
 * are hidden.
 *
 * Trap hits and multi-link scanner sends do not count as human.
 */
export function sendHasHumanClick(send: SendClickHints) {
  if (sendHasTrapClick(send)) {
    return false;
  }

  const events =
    send.clickEvents && send.clickEvents.length > 0
      ? send.clickEvents
      : send.clickedAt
        ? [{ url: send.clickedUrl || "", at: send.clickedAt }]
        : [];
  const nonIgnored = events.filter((event) => !event.ignored);
  const humanEvents = nonIgnored.filter((event) => {
    if (clickEventIsBot(send, event)) {
      return false;
    }
    return Boolean((event.url || send.clickedUrl || "").trim() || event.at);
  });
  if (humanEvents.length === 0) {
    return false;
  }

  const distinctAll = new Set(
    nonIgnored.map((event) => normalizeClickUrl(event.url ?? "")).filter(Boolean),
  );
  const scannerLike =
    Boolean(send.botClick) ||
    Boolean(send.clickBurstIgnored) ||
    eventsLookLikeBurst(nonIgnored) ||
    distinctAll.size >= 3;

  if (scannerLike) {
    const distinctHuman = new Set(
      humanEvents.map((event) => normalizeClickUrl(event.url ?? "")).filter(Boolean),
    );
    // Another multi-link pass, or crumbs after a scan, are not human proof.
    if (distinctHuman.size >= 2) {
      return false;
    }
    if (distinctAll.size >= 3) {
      return false;
    }
  }

  return true;
}
