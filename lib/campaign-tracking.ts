import { replaceUnsubscribeVariables } from "@/lib/email-variables";

export const DEFAULT_TRACKING_HOST = "unified.nexuses.xyz";
export const DEFAULT_TRACKING_ORIGIN = `https://${DEFAULT_TRACKING_HOST}`;

export function normalizeTrackingDomain(value: string | undefined | null) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host || host.includes(" ") || !host.includes(".")) {
      return "";
    }
    return host;
  } catch {
    return "";
  }
}

export function trackingOrigin(trackingDomain?: string | null) {
  const host = normalizeTrackingDomain(trackingDomain);
  return host ? `https://${host}` : DEFAULT_TRACKING_ORIGIN;
}

const trackingProbeCache = new Map<string, { ok: boolean; at: number; detail?: string }>();
const TRACKING_PROBE_TTL_MS = 5 * 60 * 1000;

/**
 * Custom CNAMEs to a Cloudflare-hosted hub often hit Error 1014
 * (CNAME Cross-User Banned) even when DNS looks correct.
 * Only use a custom host if HTTPS tracking actually returns our open pixel.
 */
export async function probeTrackingHost(hostInput: string) {
  const host = normalizeTrackingDomain(hostInput);
  if (!host) {
    return { ok: false, detail: "Invalid tracking host." };
  }
  if (host === DEFAULT_TRACKING_HOST) {
    return { ok: true, detail: "Default tracking host." };
  }

  const cached = trackingProbeCache.get(host);
  if (cached && Date.now() - cached.at < TRACKING_PROBE_TTL_MS) {
    return { ok: cached.ok, detail: cached.detail };
  }

  try {
    const response = await fetch(`https://${host}/t/o/healthcheck`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { Accept: "image/gif,*/*" },
    });
    const contentType = response.headers.get("content-type") || "";
    const ok =
      response.status === 200 &&
      (contentType.includes("image/gif") || contentType.includes("image/"));
    const detail = ok
      ? `${host} responds to open tracking.`
      : response.status === 403 || response.status === 1014
        ? `${host} is blocked by Cloudflare (often Error 1014 CNAME Cross-User Banned when both zones are on Cloudflare). Use ${DEFAULT_TRACKING_HOST}, or set up Cloudflare for SaaS custom hostnames.`
        : `${host} returned HTTP ${response.status} for /t/o/…. Tracking links would break — use ${DEFAULT_TRACKING_HOST} until this is fixed.`;
    trackingProbeCache.set(host, { ok, at: Date.now(), detail });
    return { ok, detail };
  } catch (error) {
    const detail =
      error instanceof Error
        ? `Could not reach ${host}: ${error.message}`
        : `Could not reach ${host}.`;
    trackingProbeCache.set(host, { ok: false, at: Date.now(), detail });
    return { ok: false, detail };
  }
}

/** Origin used in outbound email links — never bake in a broken custom CNAME. */
export async function resolveUsableTrackingOrigin(trackingDomain?: string | null) {
  const host = normalizeTrackingDomain(trackingDomain);
  if (!host || host === DEFAULT_TRACKING_HOST) {
    return DEFAULT_TRACKING_ORIGIN;
  }
  const probe = await probeTrackingHost(host);
  return probe.ok ? `https://${host}` : DEFAULT_TRACKING_ORIGIN;
}

export type TrackingDnsRecord = {
  type: "CNAME";
  host: string;
  value: string;
  purpose: string;
};

export type TrackingDomainVerification = {
  domain: string;
  verified: boolean;
  checkedAt?: string;
  detail?: string;
};

export function trackingDnsRecords(domain: string): TrackingDnsRecord[] {
  const host = normalizeTrackingDomain(domain);
  if (!host) {
    return [];
  }

  return [
    {
      type: "CNAME",
      host,
      value: DEFAULT_TRACKING_HOST,
      purpose: "Open, click, and unsubscribe tracking",
    },
  ];
}

function isIpv4(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

export async function lookupCnameTargets(host: string) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=CNAME`;
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not look up DNS records.");
  }

  const data = (await response.json()) as {
    Answer?: Array<{ type: number; data?: string }>;
  };
  return (data.Answer ?? [])
    .filter((answer) => answer.type === 5 && answer.data)
    .map((answer) => answer.data!.replace(/\.$/, "").toLowerCase());
}

export async function verifyTrackingDomain(domain: string) {
  const host = normalizeTrackingDomain(domain);
  if (!host) {
    return {
      domain: "",
      verified: false,
      checkedAt: new Date().toISOString(),
      detail: "Enter a valid tracking domain.",
    } satisfies TrackingDomainVerification;
  }

  if (host === DEFAULT_TRACKING_HOST) {
    return {
      domain: host,
      verified: true,
      checkedAt: new Date().toISOString(),
      detail: "Using the default Unified Hub tracking domain.",
    } satisfies TrackingDomainVerification;
  }

  try {
    const cnames = await lookupCnameTargets(host);
    const expected = DEFAULT_TRACKING_HOST;
    const matched = cnames.some((target) => target === expected);
    if (matched) {
      const probe = await probeTrackingHost(host);
      if (!probe.ok) {
        return {
          domain: host,
          verified: false,
          checkedAt: new Date().toISOString(),
          detail: probe.detail,
        } satisfies TrackingDomainVerification;
      }
      return {
        domain: host,
        verified: true,
        checkedAt: new Date().toISOString(),
        detail: `${host} CNAME points to ${expected} and HTTPS tracking works.`,
      } satisfies TrackingDomainVerification;
    }

    const aLookup = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      { headers: { Accept: "application/dns-json" }, cache: "no-store" },
    );
    const aData = aLookup.ok
      ? ((await aLookup.json()) as { Answer?: Array<{ type: number; data?: string }> })
      : { Answer: [] };
    const aRecords = (aData.Answer ?? [])
      .filter((answer) => answer.type === 1 && answer.data && isIpv4(answer.data))
      .map((answer) => answer.data as string);

    return {
      domain: host,
      verified: false,
      checkedAt: new Date().toISOString(),
      detail: cnames.length
        ? `${host} currently points to ${cnames.join(", ")}. Add a CNAME to ${expected}.`
        : aRecords.length
          ? `${host} has A records (${aRecords.join(", ")}), but tracking needs a CNAME to ${expected}.`
          : `No CNAME found for ${host} yet. Add ${host} → ${expected} and try again.`,
    } satisfies TrackingDomainVerification;
  } catch (error) {
    return {
      domain: host,
      verified: false,
      checkedAt: new Date().toISOString(),
      detail:
        error instanceof Error ? error.message : "Could not verify the tracking domain.",
    } satisfies TrackingDomainVerification;
  }
}

export const DEFAULT_UTM_SOURCE = "nexuses";
export const DEFAULT_UTM_MEDIUM = "email";
export const DEFAULT_UTM_CAMPAIGN = "[CAMPAIGN_NAME]";

export type CampaignUtmConfig = {
  enabled: boolean;
  sourceEnabled: boolean;
  source: string;
  mediumEnabled: boolean;
  medium: string;
  campaignEnabled: boolean;
  campaign: string;
};

export type CampaignUtmFields = {
  utmEnabled?: boolean;
  utmSourceEnabled?: boolean;
  utmSource?: string;
  utmMediumEnabled?: boolean;
  utmMedium?: string;
  utmCampaignEnabled?: boolean;
  utmCampaign?: string;
};

export function resolveUtmConfig(fields?: CampaignUtmFields | null): CampaignUtmConfig {
  return {
    enabled: Boolean(fields?.utmEnabled),
    sourceEnabled: fields?.utmSourceEnabled !== false,
    source: fields?.utmSource?.trim() || DEFAULT_UTM_SOURCE,
    mediumEnabled: fields?.utmMediumEnabled !== false,
    medium: fields?.utmMedium?.trim() || DEFAULT_UTM_MEDIUM,
    campaignEnabled: fields?.utmCampaignEnabled !== false,
    campaign: fields?.utmCampaign?.trim() || DEFAULT_UTM_CAMPAIGN,
  };
}

function fillUtmToken(value: string, campaignName: string) {
  const name = campaignName.trim() || "campaign";
  return value.replace(/\[CAMPAIGN_NAME\]/gi, name);
}

export function applyUtmParams(
  url: string,
  utm: CampaignUtmConfig,
  campaignName: string,
) {
  if (!utm.enabled) {
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (utm.source) {
    parsed.searchParams.set("utm_source", fillUtmToken(utm.source, campaignName));
  }
  if (utm.medium) {
    parsed.searchParams.set("utm_medium", fillUtmToken(utm.medium, campaignName));
  }
  if (utm.campaign) {
    parsed.searchParams.set("utm_campaign", fillUtmToken(utm.campaign, campaignName));
  }
  return parsed.toString();
}

export function campaignTrackingUrls(origin: string, token: string) {
  const base = origin.replace(/\/$/, "");
  return {
    open: `${base}/t/o/${token}`,
    click: (url: string) => `${base}/t/c/${token}?u=${encodeURIComponent(url)}`,
    unsubscribe: `${base}/t/u/${token}`,
  };
}

function isTrackingOrUnsubscribeUrl(url: string) {
  return (
    /\/t\/[ocu]\//i.test(url) ||
    /\/api\/campaigns\/track\//i.test(url) ||
    /\/unsubscribe\//i.test(url)
  );
}

function wrapTrackedLinks(html: string, clickUrl: (url: string) => string) {
  return html.replace(
    /href\s*=\s*(?:(["'])([^"']+)\1|([^\s>]+))/gi,
    (match, quote: string | undefined, quotedUrl: string | undefined, bareUrl: string | undefined) => {
      const trimmed = (quotedUrl ?? bareUrl ?? "").trim();
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("mailto:") ||
        trimmed.startsWith("tel:") ||
        trimmed.includes("{{") ||
        isTrackingOrUnsubscribeUrl(trimmed)
      ) {
        return match;
      }
      if (!/^https?:\/\//i.test(trimmed)) {
        return match;
      }
      const wrapped = clickUrl(trimmed);
      return quote ? `href=${quote}${wrapped}${quote}` : `href="${wrapped}"`;
    },
  );
}

function injectOpenPixel(html: string, openUrl: string) {
  if (html.includes(openUrl) || /\/t\/o\//i.test(html)) {
    return html;
  }

  // Do not use display:none — many clients skip loading those images,
  // so opens never fire. Keep a 1×1 img that clients still fetch.
  const pixel = `<img src="${openUrl}" width="1" height="1" alt="" border="0" style="width:1px;height:1px;border:0;line-height:1px;" />`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${html}${pixel}`;
}

function hasUnsubscribeHref(html: string, unsubscribeUrl: string) {
  return (
    html.includes(unsubscribeUrl) ||
    /href\s*=\s*(["'])[^"']*\/t\/u\/[^"']+\1/i.test(html) ||
    /href\s*=\s*(["'])[^"']*\/unsubscribe\/[^"']+\1/i.test(html)
  );
}

/**
 * Replace merge tags with a real unsubscribe link.
 * Tags already inside href="…" become the raw URL; standalone tags become an <a>.
 * If the email has no unsubscribe href at all, append a footer link.
 */
function injectUnsubscribe(html: string, unsubscribeUrl: string) {
  let next = html;

  // href="{{ unsubscribe }}" (and aliases) → href="https://…/t/u/…"
  next = next.replace(
    /href\s*=\s*(["'])\s*(?:\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([^}]+?)\s*\}\})\s*\1/gi,
    (full, quote: string, tripleInner?: string, doubleInner?: string) => {
      const inner = String(tripleInner ?? doubleInner ?? "");
      if (!/unsubscribe|unsub|optout|listunsub/i.test(inner.replace(/\s+/g, ""))) {
        return full;
      }
      return `href=${quote}${unsubscribeUrl}${quote}`;
    },
  );

  // Remaining bare tags → clickable link (not plain text URL)
  const link = `<a href="${unsubscribeUrl}" target="_blank" rel="noopener noreferrer">Unsubscribe</a>`;
  next = replaceUnsubscribeVariables(next, link);

  if (!hasUnsubscribeHref(next, unsubscribeUrl)) {
    const footer = `<p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#666;">${link}</p>`;
    if (/<\/body>/i.test(next)) {
      next = next.replace(/<\/body>/i, `${footer}</body>`);
    } else {
      next = `${next}${footer}`;
    }
  }

  return next;
}

export function injectCampaignTracking(
  html: string,
  origin: string,
  token: string,
  options?: { utm?: CampaignUtmConfig; campaignName?: string },
) {
  const urls = campaignTrackingUrls(origin, token);
  const withUnsubscribe = injectUnsubscribe(html, urls.unsubscribe);
  const utm = options?.utm;
  const campaignName = options?.campaignName ?? "";
  const withClicks = wrapTrackedLinks(withUnsubscribe, (href) => {
    const destination =
      utm?.enabled ? applyUtmParams(href, utm, campaignName) : href;
    return urls.click(destination);
  });
  return injectOpenPixel(withClicks, urls.open);
}
