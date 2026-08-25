export const DEFAULT_TRACKING_HOST = "unifiedhub.nexuses.xyz";
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

  const pixel = `<img src="${openUrl}" width="1" height="1" alt="" style="display:none !important;width:1px;height:1px;border:0;overflow:hidden;" />`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${html}${pixel}`;
}

function injectUnsubscribe(
  html: string,
  unsubscribeUrl: string,
) {
  const withVariable = html.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl);
  if (/\/t\/u\//i.test(withVariable) || /\/unsubscribe\//i.test(withVariable)) {
    return withVariable;
  }

  const footer = `<div style="padding:24px 0 8px;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
  <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
</div>`;

  if (/<\/body>/i.test(withVariable)) {
    return withVariable.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${withVariable}${footer}`;
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
