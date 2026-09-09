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
      return {
        domain: host,
        verified: true,
        checkedAt: new Date().toISOString(),
        detail: `${host} CNAME points to ${expected}.`,
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
) {
  const urls = campaignTrackingUrls(origin, token);
  const withUnsubscribe = injectUnsubscribe(html, urls.unsubscribe);
  const withClicks = wrapTrackedLinks(withUnsubscribe, urls.click);
  return injectOpenPixel(withClicks, urls.open);
}
