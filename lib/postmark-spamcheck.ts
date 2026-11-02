export type PostmarkSpamRule = {
  score: string | number;
  name?: string;
  description?: string;
};

export type PostmarkSpamCheckResult = {
  success: boolean;
  score: number;
  report?: string;
  rules: Array<{
    score: number;
    name: string;
    description: string;
  }>;
  message?: string;
};

type PostmarkResponse = {
  success?: boolean;
  score?: string | number;
  report?: string;
  rules?: PostmarkSpamRule[];
  message?: unknown;
  error?: unknown;
};

function toNumber(value: string | number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPostmarkError(value: unknown, status: number) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // fall through
    }
  }
  return `Postmark SpamAssassin check failed (${status})`;
}

export async function runPostmarkSpamCheck(
  rawEmail: string,
): Promise<PostmarkSpamCheckResult> {
  // Very large MIME can make Postmark reject the request.
  const maxBytes = 900_000;
  const email =
    rawEmail.length > maxBytes
      ? rawEmail.slice(0, maxBytes)
      : rawEmail;

  const response = await fetch("https://spamcheck.postmarkapp.com/filter", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      options: "long",
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as PostmarkResponse | null;
  if (!response.ok || !data) {
    throw new Error(
      formatPostmarkError(data?.message ?? data?.error ?? data, response.status),
    );
  }

  if (data.success === false) {
    throw new Error(
      formatPostmarkError(
        data.message ?? data.error,
        response.status,
      ) || "Postmark SpamAssassin check failed",
    );
  }

  const rules = (data.rules ?? []).map((rule) => ({
    score: toNumber(rule.score),
    name: String(rule.name ?? "").trim() || "RULE",
    description: String(rule.description ?? "").trim(),
  }));

  return {
    success: true,
    score: toNumber(data.score),
    report: data.report,
    rules,
  };
}
