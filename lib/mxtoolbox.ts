import type { SmtpProviderId } from "@/lib/smtp-senders";

export type MxLookupItem = {
  ID?: number;
  Name?: string;
  Info?: string;
  Url?: string;
};

export type MxLookupResponse = {
  Command?: string;
  CommandArgument?: string;
  Failed?: MxLookupItem[];
  Warnings?: MxLookupItem[];
  Passed?: MxLookupItem[];
  Timeouts?: MxLookupItem[];
};

export type SenderAuthVerification = {
  checkedAt: string;
  dkimOk: boolean;
  dkimSelector?: string;
  dkimLabel: string;
  dkimDetail?: string;
  dmarcOk: boolean;
  dmarcLabel: string;
  dmarcDetail?: string;
  spfOk: boolean;
  spfLabel: string;
  spfDetail?: string;
};

const MX_API_BASE = "https://api.mxtoolbox.com/api/v1/Lookup";

const PROVIDER_DKIM_SELECTORS: Record<SmtpProviderId, string[]> = {
  gmail: ["google"],
  outlook: ["selector1", "selector2"],
  aws_ses: ["amazonses"],
  sendgrid: ["s1", "s2"],
  cloudflare: ["cf2024"],
  resend: ["resend"],
};

const FALLBACK_DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "s1",
  "dkim",
  "k1",
];

function getMxApiKey() {
  return process.env.MXTOOLBOX_API_KEY?.trim() ?? "";
}

function lookupSucceeded(result: MxLookupResponse) {
  const passed = result.Passed?.length ?? 0;
  const failed = result.Failed?.length ?? 0;
  const timedOut = result.Timeouts?.length ?? 0;
  return passed > 0 && failed === 0 && timedOut === 0;
}

function firstDetail(result: MxLookupResponse) {
  const passed = result.Passed?.[0]?.Info?.trim();
  if (passed) {
    return passed;
  }
  return (
    result.Failed?.[0]?.Info?.trim() ??
    result.Warnings?.[0]?.Info?.trim() ??
    result.Timeouts?.[0]?.Info?.trim() ??
    undefined
  );
}

export async function mxLookup(command: string, argument: string) {
  const apiKey = getMxApiKey();
  if (!apiKey) {
    throw new Error("MX Toolbox API key is not configured");
  }

  const url = `${MX_API_BASE}/${command}/?argument=${encodeURIComponent(argument)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`MX Toolbox lookup failed (${response.status})`);
  }

  return (await response.json()) as MxLookupResponse;
}

async function verifyDmarc(domain: string) {
  const result = await mxLookup("dmarc", domain);
  const ok = lookupSucceeded(result);

  return {
    ok,
    label: ok ? "DMARC is configured" : "DMARC is not configured",
    detail: firstDetail(result),
  };
}

async function verifySpf(domain: string) {
  const result = await mxLookup("spf", domain);
  const ok = lookupSucceeded(result);

  return {
    ok,
    label: ok ? "SPF is configured" : "SPF is not configured",
    detail: firstDetail(result),
  };
}

async function verifyDkim(domain: string, provider: SmtpProviderId) {
  const selectors = [
    ...new Set([
      ...PROVIDER_DKIM_SELECTORS[provider],
      ...FALLBACK_DKIM_SELECTORS,
    ]),
  ];

  let lastDetail: string | undefined;

  for (const selector of selectors) {
    try {
      const result = await mxLookup("dkim", `${domain}:${selector}`);
      lastDetail = firstDetail(result);
      if (lookupSucceeded(result)) {
        return {
          ok: true,
          selector,
          label: domain,
          detail: lastDetail,
        };
      }
    } catch {
      // Try the next selector.
    }
  }

  return {
    ok: false,
    label: domain,
    detail: lastDetail ?? "No valid DKIM record found",
  };
}

export async function verifySenderAuth(
  domain: string,
  provider: SmtpProviderId,
): Promise<SenderAuthVerification> {
  const checkedAt = new Date().toISOString();

  if (!getMxApiKey()) {
    return {
      checkedAt,
      dkimOk: false,
      dkimLabel: domain,
      dkimDetail: "MX Toolbox API key is not configured",
      dmarcOk: false,
      dmarcLabel: "DMARC check unavailable",
      dmarcDetail: "Add MXTOOLBOX_API_KEY to your environment",
      spfOk: false,
      spfLabel: "SPF check unavailable",
      spfDetail: "Add MXTOOLBOX_API_KEY to your environment",
    };
  }

  try {
    const [dmarc, dkim, spf] = await Promise.all([
      verifyDmarc(domain),
      verifyDkim(domain, provider),
      verifySpf(domain),
    ]);

    return {
      checkedAt,
      dkimOk: dkim.ok,
      dkimSelector: dkim.selector,
      dkimLabel: dkim.label,
      dkimDetail: dkim.detail,
      dmarcOk: dmarc.ok,
      dmarcLabel: dmarc.label,
      dmarcDetail: dmarc.detail,
      spfOk: spf.ok,
      spfLabel: spf.label,
      spfDetail: spf.detail,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";

    return {
      checkedAt,
      dkimOk: false,
      dkimLabel: domain,
      dkimDetail: message,
      dmarcOk: false,
      dmarcLabel: "DMARC check failed",
      dmarcDetail: message,
      spfOk: false,
      spfLabel: "SPF check failed",
      spfDetail: message,
    };
  }
}

export function emailDomain(fromEmail: string) {
  return fromEmail.split("@")[1]?.trim().toLowerCase() ?? fromEmail;
}

export function formatSenderDisplayName(fromEmail: string) {
  const [local, domainPart] = fromEmail.split("@");
  if (!local || !domainPart) {
    return fromEmail;
  }

  const name = local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(" ");

  return `${name} <${fromEmail}>`;
}
