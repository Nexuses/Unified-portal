import type { BoatAiUsageRow } from "@/lib/boat";

/** USD per million tokens — approximate list prices for estimation. */
const MODEL_RATES: Array<{
  match: RegExp;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}> = [
  {
    match: /opus/i,
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  {
    match: /haiku/i,
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
  {
    match: /sonnet|claude/i,
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
];

const DEFAULT_RATE = MODEL_RATES[2];

function rateForModel(model: string) {
  return MODEL_RATES.find((item) => item.match.test(model)) ?? DEFAULT_RATE;
}

function tokensToUsd(tokens: number, usdPerMillion: number) {
  return (Math.max(0, tokens) / 1_000_000) * usdPerMillion;
}

/** Estimate Anthropic token $ from Boat-reported usage rows (Claude billed separately). */
export function estimateClaudeCostUsd(rows: BoatAiUsageRow[]) {
  let total = 0;
  for (const row of rows) {
    const rate = rateForModel(row.model || row.credential);
    total += tokensToUsd(row.inputTokens, rate.input);
    total += tokensToUsd(row.outputTokens, rate.output);
    total += tokensToUsd(row.cacheReadTokens, rate.cacheRead);
    total += tokensToUsd(row.cacheWriteTokens, rate.cacheWrite);
  }
  return total;
}

export function formatUsd(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatTokenCount(value: number) {
  const n = Math.max(0, Math.floor(value) || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export type BoatUsageSummary = {
  sandboxId: string;
  days: number;
  since: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated Anthropic token spend from reported tokens */
  claudeEstimatedUsd: number;
  /** Boat AI proxy fee */
  boatProxyUsd: number;
  /** Boat machine time fee */
  boatMachineUsd: number;
  totalEstimatedUsd: number;
  models: string[];
  proxied: boolean;
  blocked: boolean;
};
