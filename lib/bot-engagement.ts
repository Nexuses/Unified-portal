import { isClickTrapUrl } from "@/lib/click-trap";

/** Gap between consecutive clicks that starts a new session cluster. */
export const CLICK_CLUSTER_GAP_MS = 5_000;
/** Sliding window inside a cluster for burst / multi-link rules. */
export const CLICK_BURST_WINDOW_MS = 5_000;
export const CLICK_BURST_MIN_COUNT = 3;
export const CLICK_BURST_MIN_DISTINCT_URLS = 2;
/** Cluster start within this window after send → fast-click bot heuristics apply. */
export const FAST_CLICK_AFTER_DELIVERY_MS = 15_000;
/** Single click without a paired burst, within this window after send → bot. */
export const FAST_CLICK_SINGLE_MS = 10_000;
/** Open pixel loads within ±this of a bot-classified click → bot open. */
export const OPEN_NEAR_BOT_CLICK_MS = 6_000;
/** Open shares IP with a bot click within this window → bot open. */
export const OPEN_BOT_IP_WINDOW_MS = 60_000;
/** Clicks within ±this of a honeypot hit inherit bot classification. */
export const HONEYPOT_WINDOW_MS = 5_000;
/** Early open paired with an early bot click cluster. */
export const OPEN_EARLY_DELIVERY_MS = 15_000;

/** @deprecated Kept for ingest grace; report filtering uses event-level rules. */
export const BOT_CLICK_GRACE_MS = 25_000;

export const BOT_CLICK_TAG = "Bot click";

export type ClickHint = {
  url?: string;
  at?: Date | string;
  bot?: boolean;
  ignored?: boolean;
  ip?: string;
  userAgent?: string;
};

export type OpenHint = {
  at?: Date | string;
  bot?: boolean;
  ip?: string;
  userAgent?: string;
};

export type SendClickHints = {
  sentAt?: Date | string | null;
  clickedAt?: Date | string | null;
  clickedUrl?: string | null;
  botClick?: boolean;
  clickBurstIgnored?: boolean;
  clickEvents?: ClickHint[];
};

export type SendOpenHints = {
  sentAt?: Date | string | null;
  openedAt?: Date | string | null;
  openedIp?: string;
  openCount?: number;
  openPixelBlocked?: boolean;
  botOpen?: boolean;
  openEvents?: OpenHint[];
};

export type SendEngagementHints = SendClickHints & SendOpenHints;

export function asTimeMs(value: Date | string | null | undefined) {
  if (!value) {
    return NaN;
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

export function normalizeClickUrl(url: string) {
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

const SCANNER_UA_PATTERNS = [
  /microsoft-defender/i,
  /safelinks/i,
  /proofpoint/i,
  /mimecast/i,
  /barracuda/i,
  /python-requests/i,
  /curl\//i,
  /wget\//i,
  /headless/i,
];

export function isKnownScannerUserAgent(userAgent: string | undefined | null) {
  const ua = String(userAgent ?? "").trim();
  if (!ua) {
    return false;
  }
  return SCANNER_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

export function clickEventsForSend(send: SendClickHints): ClickHint[] {
  if (send.clickEvents && send.clickEvents.length > 0) {
    return send.clickEvents;
  }
  if (send.clickedAt) {
    return [{ url: send.clickedUrl || "", at: send.clickedAt }];
  }
  return [];
}

export function openEventsForSend(send: SendOpenHints): OpenHint[] {
  if (send.openEvents && send.openEvents.length > 0) {
    return send.openEvents;
  }
  if (send.openedAt) {
    return [{ at: send.openedAt, ip: send.openedIp, bot: send.botOpen ? true : undefined }];
  }
  return [];
}

/** Partition clicks into time-bounded session clusters (per send). */
export function clusterClicks(events: ClickHint[]): ClickHint[][] {
  const sorted = events
    .filter((event) => !event.ignored && Number.isFinite(asTimeMs(event.at)))
    .sort((left, right) => asTimeMs(left.at) - asTimeMs(right.at));
  if (sorted.length === 0) {
    return [];
  }
  const clusters: ClickHint[][] = [[sorted[0]]];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = asTimeMs(sorted[index - 1].at);
    const current = asTimeMs(sorted[index].at);
    if (current - previous <= CLICK_CLUSTER_GAP_MS) {
      clusters[clusters.length - 1].push(sorted[index]);
    } else {
      clusters.push([sorted[index]]);
    }
  }
  return clusters;
}

function clusterHasBurstWindow(cluster: ClickHint[]) {
  const list = cluster
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
        event.at - list[start].at <= CLICK_BURST_WINDOW_MS,
    );
    const distinct = new Set(window.map((event) => event.url).filter(Boolean));
    if (distinct.size >= CLICK_BURST_MIN_DISTINCT_URLS || window.length >= CLICK_BURST_MIN_COUNT) {
      return true;
    }
  }
  return false;
}

function trapClickTimes(allEvents: ClickHint[]) {
  return allEvents
    .filter((event) => isClickTrapUrl(event.url ?? ""))
    .map((event) => asTimeMs(event.at))
    .filter((ms) => Number.isFinite(ms));
}

function eventNearTrap(event: ClickHint, trapTimes: number[]) {
  const at = asTimeMs(event.at);
  if (!Number.isFinite(at)) {
    return false;
  }
  return trapTimes.some((trapAt) => Math.abs(at - trapAt) <= HONEYPOT_WINDOW_MS);
}

/**
 * Classify a single click session cluster (no recipient-level lockout).
 */
export function isBotCluster(cluster: ClickHint[], send: SendClickHints, allEvents: ClickHint[]) {
  if (cluster.length === 0) {
    return false;
  }

  const traps = trapClickTimes(allEvents);
  const sentAt = asTimeMs(send.sentAt);
  const clusterStart = asTimeMs(cluster[0].at);

  for (const event of cluster) {
    if (event.bot || event.ignored) {
      return true;
    }
    if (isClickTrapUrl(event.url ?? "")) {
      return true;
    }
    if (isKnownScannerUserAgent(event.userAgent)) {
      return true;
    }
    if (traps.length > 0 && eventNearTrap(event, traps)) {
      return true;
    }
  }

  if (Number.isFinite(sentAt) && Number.isFinite(clusterStart)) {
    const afterSend = clusterStart - sentAt;
    if (afterSend >= 0 && afterSend <= FAST_CLICK_AFTER_DELIVERY_MS) {
      if (cluster.length >= 2) {
        return true;
      }
      if (cluster.length === 1 && afterSend < FAST_CLICK_SINGLE_MS) {
        return true;
      }
    }
  }

  if (clusterHasBurstWindow(cluster)) {
    return true;
  }

  return false;
}

export type ClickBotClassification = {
  key: string;
  event: ClickHint;
  isBot: boolean;
};

export function clickEventKey(event: ClickHint) {
  return `${asTimeMs(event.at)}|${normalizeClickUrl(event.url ?? "")}`;
}

export function classifyClickEvents(send: SendClickHints): ClickBotClassification[] {
  const all = clickEventsForSend(send).filter((event) => !event.ignored);
  const clusters = clusterClicks(all);
  const botByKey = new Map<string, boolean>();
  for (const cluster of clusters) {
    const isBot = isBotCluster(cluster, send, all);
    for (const event of cluster) {
      botByKey.set(clickEventKey(event), isBot);
    }
  }
  return all.map((event) => ({
    key: clickEventKey(event),
    event,
    isBot: botByKey.get(clickEventKey(event)) ?? false,
  }));
}

export type BotClickMeta = {
  botTimes: number[];
  botIps: Array<{ ip: string; at: number }>;
  earlyBotCluster: boolean;
};

export function botClickMeta(
  send: SendClickHints,
  classification: ClickBotClassification[],
): BotClickMeta {
  const sentAt = asTimeMs(send.sentAt);
  const botTimes: number[] = [];
  const botIps: Array<{ ip: string; at: number }> = [];
  let earlyBotCluster = false;

  const clusters = clusterClicks(clickEventsForSend(send).filter((event) => !event.ignored));
  for (const cluster of clusters) {
    if (!isBotCluster(cluster, send, clickEventsForSend(send).filter((event) => !event.ignored))) {
      continue;
    }
    const start = asTimeMs(cluster[0].at);
    if (
      Number.isFinite(sentAt) &&
      Number.isFinite(start) &&
      start - sentAt >= 0 &&
      start - sentAt <= OPEN_EARLY_DELIVERY_MS
    ) {
      earlyBotCluster = true;
    }
  }

  for (const row of classification) {
    if (!row.isBot) {
      continue;
    }
    const at = asTimeMs(row.event.at);
    if (Number.isFinite(at)) {
      botTimes.push(at);
    }
    const ip = String(row.event.ip ?? "").trim();
    if (ip && Number.isFinite(at)) {
      botIps.push({ ip, at });
    }
  }

  return { botTimes, botIps, earlyBotCluster };
}

/** Event-level open bot classification. */
export function isBotOpen(
  open: OpenHint,
  send: SendEngagementHints,
  meta: BotClickMeta,
) {
  if (open.bot) {
    return true;
  }
  if (isKnownScannerUserAgent(open.userAgent)) {
    return true;
  }

  const at = asTimeMs(open.at);
  if (!Number.isFinite(at)) {
    return false;
  }

  const sentAt = asTimeMs(send.sentAt);

  if (meta.botTimes.some((botAt) => Math.abs(at - botAt) <= OPEN_NEAR_BOT_CLICK_MS)) {
    return true;
  }

  const openIp = String(open.ip ?? "").trim();
  if (openIp) {
    for (const bot of meta.botIps) {
      if (bot.ip !== openIp) {
        continue;
      }
      if (Math.abs(at - bot.at) <= OPEN_BOT_IP_WINDOW_MS) {
        return true;
      }
    }
  }

  if (
    Number.isFinite(sentAt) &&
    at - sentAt >= 0 &&
    at - sentAt <= OPEN_EARLY_DELIVERY_MS &&
    meta.earlyBotCluster
  ) {
    return true;
  }

  return false;
}

export function sendHasTrapClick(send: SendClickHints) {
  if (isClickTrapUrl(send.clickedUrl ?? "")) {
    return true;
  }
  return clickEventsForSend(send).some((event) => isClickTrapUrl(event.url ?? ""));
}

export function clickEventIsBot(send: SendClickHints, event: ClickHint) {
  if (event.ignored) {
    return true;
  }
  const key = clickEventKey(event);
  const match = classifyClickEvents(send).find((row) => row.key === key);
  if (match) {
    return match.isBot;
  }
  return isBotCluster([event], send, clickEventsForSend(send));
}

export function sendHasHumanClick(send: SendClickHints) {
  const classification = classifyClickEvents(send);
  return classification.some((row) => {
    if (row.isBot) {
      return false;
    }
    return Boolean((row.event.url || send.clickedUrl || "").trim() || row.event.at);
  });
}

/** Implied open from a verified human click, or any non-bot open pixel event. */
export function sendHasHumanOpen(send: SendEngagementHints) {
  if (sendHasHumanClick(send)) {
    return true;
  }
  const classification = classifyClickEvents(send);
  const meta = botClickMeta(send, classification);
  const opens = openEventsForSend(send);
  if (opens.length === 0) {
    return false;
  }
  return opens.some((open) => !isBotOpen(open, send, meta));
}

export function sendIsBotClick(send: SendClickHints) {
  const events = clickEventsForSend(send).filter((event) => !event.ignored);
  if (events.length === 0) {
    return isClickTrapUrl(send.clickedUrl ?? "");
  }
  return classifyClickEvents(send).some((row) => row.isBot);
}

export function botClickLabel(send: SendClickHints) {
  return sendIsBotClick(send) ? BOT_CLICK_TAG : "";
}
