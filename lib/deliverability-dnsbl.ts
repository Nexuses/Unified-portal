import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

export type DnsblCheck = {
  zone: string;
  listed: boolean;
  detail?: string;
};

const DNSBL_ZONES = [
  { zone: "zen.spamhaus.org", label: "Spamhaus ZEN" },
  { zone: "bl.spamcop.net", label: "SpamCop" },
  { zone: "b.barracudacentral.org", label: "Barracuda" },
  { zone: "dnsbl.sorbs.net", label: "SORBS" },
] as const;

const PRIVATE_IP_RE =
  /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|0\.|2(?:2[4-9]|3\d)\.)/;

function reverseIpv4(ip: string) {
  return ip.split(".").reverse().join(".");
}

export function extractSendingIpFromRaw(rawEmail: string): string | null {
  const received = rawEmail.match(/^Received:[\s\S]*?(?=\r?\n[A-Za-z-]+:|\r?\n\r?\n)/gim) ?? [];
  const candidates: string[] = [];

  for (const block of received) {
    const ips = block.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    for (const ip of ips) {
      if (isIP(ip) !== 4) continue;
      if (PRIVATE_IP_RE.test(ip)) continue;
      candidates.push(ip);
    }
  }

  // Prefer the earliest public hop that is not an obvious Amazon/AgentMail edge
  // when multiple exist; first public IP in Received chain is usually the sender.
  return candidates[0] ?? null;
}

export async function checkIpDnsbls(ip: string): Promise<{
  ip: string;
  checks: Array<DnsblCheck & { label: string }>;
  listedCount: number;
}> {
  if (isIP(ip) !== 4) {
    return { ip, checks: [], listedCount: 0 };
  }

  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const reversed = reverseIpv4(ip);

  const checks = await Promise.all(
    DNSBL_ZONES.map(async ({ zone, label }) => {
      const query = `${reversed}.${zone}`;
      try {
        const answers = await resolver.resolve4(query);
        return {
          zone,
          label,
          listed: answers.length > 0,
          detail: answers.join(", "),
        };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "")
            : "";
        // ENOTFOUND / ENODATA = not listed
        if (code === "ENOTFOUND" || code === "ENODATA" || code === "ETIMEOUT") {
          return { zone, label, listed: false };
        }
        return {
          zone,
          label,
          listed: false,
          detail: "Lookup failed",
        };
      }
    }),
  );

  return {
    ip,
    checks,
    listedCount: checks.filter((check) => check.listed).length,
  };
}
