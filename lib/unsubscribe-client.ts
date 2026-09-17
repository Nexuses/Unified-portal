export type SuppressionKind = "email" | "domain";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function normalizeSuppressionEmail(value: string) {
  const email = value.trim().toLowerCase().replace(/^mailto:/i, "");
  return EMAIL_RE.test(email) ? email : "";
}

export function normalizeSuppressionDomain(value: string) {
  let raw = value.trim().toLowerCase();
  if (!raw) {
    return "";
  }
  raw = raw.replace(/^https?:\/\//, "");
  if (raw.startsWith("@")) {
    raw = raw.slice(1);
  }
  if (raw.includes("@")) {
    raw = raw.slice(raw.lastIndexOf("@") + 1);
  }
  raw = raw.split("/")[0]?.split("?")[0]?.split(":")[0] ?? "";
  raw = raw.replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN_RE.test(raw) ? raw : "";
}

export function extractBulkSuppressionValues(text: string, kind: SuppressionKind) {
  const tokens = text
    .replace(/^\uFEFF/, "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const values = new Set<string>();
  for (const token of tokens) {
    const next =
      kind === "email"
        ? normalizeSuppressionEmail(token)
        : normalizeSuppressionDomain(token);
    if (next) {
      values.add(next);
    }
  }
  return [...values];
}
