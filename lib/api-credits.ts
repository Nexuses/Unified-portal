/** Where an API call was spent. Shown in the header breakdown. */
export type ApiFeature =
  | "assistant"
  | "edm"
  | "personalise"
  | "post"
  | "pitch"
  | "enrich"
  | "automation"
  | "kanban"
  | "lookup"
  | "email";

export const API_FEATURE_LABELS: Record<ApiFeature, string> = {
  assistant: "Assistant",
  edm: "EDM generator",
  personalise: "Personalise",
  post: "Social post",
  pitch: "Pitch research",
  enrich: "Enrich AI",
  automation: "Automation",
  kanban: "Kanban chat",
  lookup: "Domain lookup",
  email: "Email API",
};

/**
 * Only these features count against the API credit limit.
 * Email sends (SendGrid / Resend / SMTP), domain lookup, Personalise,
 * social-post, pitch, Enrich, Automation and Kanban calls must never
 * deduct from this credit.
 */
export const BILLABLE_API_FEATURES = ["assistant", "edm"] as const;

export function isBillableApiFeature(
  feature: string | undefined | null,
): feature is (typeof BILLABLE_API_FEATURES)[number] {
  return feature === "assistant" || feature === "edm";
}

/** Starting dollar cap for a project until an admin changes it. */
export const DEFAULT_API_CREDIT_LIMIT_USD = 5;

export type ApiCreditItem = {
  feature: ApiFeature;
  label: string;
  calls: number;
  costUsd: number;
};

export type ApiCreditEntry = {
  feature: ApiFeature;
  label: string;
  provider: string;
  model: string;
  costUsd: number;
  createdAt: string;
};

export type ApiCreditStatus = {
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  items: ApiCreditItem[];
  recent: ApiCreditEntry[];
};

export function normalizeApiCreditLimit(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_API_CREDIT_LIMIT_USD;
  }
  return Math.min(Math.round(n * 100) / 100, 100_000);
}

export function formatApiCreditUsd(usd: number) {
  const amount = Number.isFinite(usd) ? usd : 0;
  if (amount !== 0 && Math.abs(amount) < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

/**
 * List-price estimates in USD per 1,000,000 tokens. Real invoices can differ.
 * A call with no token counts uses a small flat amount so it still shows up.
 */
const TOKEN_RATES: Record<string, { input: number; output: number }> = {
  claude: { input: 3, output: 15 },
  openai: { input: 0.25, output: 2 },
  deepseek: { input: 0.14, output: 0.28 },
  grok: { input: 0.2, output: 0.5 },
  gemini: { input: 0.1, output: 0.4 },
};

export function estimateApiCostUsd(input: {
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Extra fixed cost, such as an image or a web-search tool call. */
  flatUsd?: number;
  kind?: "chat" | "image" | "search";
}) {
  const rate = TOKEN_RATES[input.provider] ?? { input: 0.5, output: 1.5 };
  const inputTokens = Math.max(0, input.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.outputTokens ?? 0);
  let usd =
    (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  if (input.flatUsd && input.flatUsd > 0) {
    usd += input.flatUsd;
  }
  if (usd <= 0) {
    usd = input.kind === "image" ? 0.04 : input.kind === "search" ? 0.01 : 0.002;
  }
  return usd;
}

export class ApiCreditLimitError extends Error {
  constructor(limitUsd: number) {
    super(
      `This project has used its ${formatApiCreditUsd(limitUsd)} API credit. Ask an admin to raise the limit.`,
    );
    this.name = "ApiCreditLimitError";
  }
}

export function isApiCreditLimitError(error: unknown): error is ApiCreditLimitError {
  return error instanceof ApiCreditLimitError;
}
