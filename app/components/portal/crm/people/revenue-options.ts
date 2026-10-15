export type RevenueFilterMode = "is_between" | "is_known" | "is_unknown";

const MULTIPLIERS: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
};

/** Common Apollo-style revenue presets shown when focusing min/max inputs. */
export const REVENUE_AMOUNT_SUGGESTIONS = [
  "0",
  "0.5M",
  "1M",
  "5M",
  "10M",
  "25M",
  "50M",
  "100M",
  "250M",
  "500M",
  "1B",
  "5B",
  "10B",
] as const;

/** Strip currency symbols/prefixes so stored $ and ₹ values both parse. */
function stripCurrencyPrefix(value: string): string {
  return value
    .trim()
    .replace(/^(₹|rs\.?|inr|\$)\s*/i, "")
    .replace(/,/g, "");
}

function parseAmount(raw: string, suffix = ""): number | null {
  const value = Number(raw.replace(/,/g, ""));
  if (Number.isNaN(value)) return null;
  const multiplier = MULTIPLIERS[suffix.toUpperCase()] ?? 1;
  return value * multiplier;
}

export function parseUserRevenueAmount(input: string): number | null {
  const trimmed = stripCurrencyPrefix(input);
  if (!trimmed) return null;

  const suffixMatch = trimmed.match(/^([\d.]+)\s*([KMB])?$/i);
  if (suffixMatch) {
    return parseAmount(suffixMatch[1], suffixMatch[2] ?? "");
  }

  return null;
}

export function parseRevenueBounds(value: string): { min: number; max: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const plusMatch = trimmed.match(/^(?:₹|rs\.?|inr|\$)?\s*([\d,.]+)\s*([KMB])?\+$/i);
  if (plusMatch) {
    const min = parseAmount(plusMatch[1], plusMatch[2] ?? "");
    if (min === null) return null;
    return { min, max: Number.POSITIVE_INFINITY };
  }

  const rangeMatch = trimmed.match(
    /^(?:₹|rs\.?|inr|\$)?\s*([\d,.]+)\s*([KMB])?\s*-\s*(?:₹|rs\.?|inr|\$)?\s*([\d,.]+)\s*([KMB])?$/i
  );
  if (rangeMatch) {
    const min = parseAmount(rangeMatch[1], rangeMatch[2] ?? "");
    const max = parseAmount(rangeMatch[3], rangeMatch[4] ?? "");
    if (min === null || max === null) return null;
    return { min, max };
  }

  const plain = Number(stripCurrencyPrefix(trimmed));
  if (!Number.isNaN(plain) && /^(?:₹|rs\.?|inr|\$)?\s*[\d,.]+$/i.test(trimmed)) {
    return { min: plain, max: plain };
  }

  return null;
}

export function rangesOverlap(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number
): boolean {
  return leftMin <= rightMax && rightMin <= leftMax;
}

export function formatRevenueAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  if (amount >= 1_000_000_000) {
    const billions = amount / 1_000_000_000;
    const formatted = billions.toFixed(1);
    return `$${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted}B`;
  }
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    const formatted = millions.toFixed(1);
    return `$${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted}M`;
  }
  if (amount >= 1_000) {
    const thousands = amount / 1_000;
    const formatted = thousands.toFixed(1);
    return `$${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted}K`;
  }
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatRevenueInputLabel(input: string): string {
  const amount = parseUserRevenueAmount(input);
  return amount === null ? input : formatRevenueAmount(amount);
}

export function formatStoredRevenue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const bounds = parseRevenueBounds(trimmed);
  if (!bounds) {
    // Fallback: convert any rupee markers to dollars when bounds couldn't be parsed
    return trimmed
      .replace(/₹/g, "$")
      .replace(/\bRs\.?\s*/gi, "$")
      .replace(/\bINR\s*/gi, "$");
  }

  if (!Number.isFinite(bounds.max) || bounds.max === Number.POSITIVE_INFINITY) {
    return `${formatRevenueAmount(bounds.min)}+`;
  }
  if (bounds.min === bounds.max) {
    return formatRevenueAmount(bounds.min);
  }
  return `${formatRevenueAmount(bounds.min)} – ${formatRevenueAmount(bounds.max)}`;
}

export function sanitizeRevenueInput(value: string): string {
  return value.replace(/[^\d.kmb₹$rsINR,\s-]/gi, "").replace(/\s+/g, "");
}

export function filterRevenueSuggestions(query: string): string[] {
  const trimmed = stripCurrencyPrefix(query).toLowerCase();
  if (!trimmed) return [...REVENUE_AMOUNT_SUGGESTIONS];
  return REVENUE_AMOUNT_SUGGESTIONS.filter((option) =>
    option.toLowerCase().includes(trimmed)
  );
}
