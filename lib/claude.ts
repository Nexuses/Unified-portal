import { guardApiCredit, noteApiUsage } from "@/lib/api-credits-server";

/**
 * Claude (Anthropic Messages API) — preferred AI provider.
 *
 * Set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in the environment. The model
 * defaults to claude-sonnet-5-5 and can be overridden with ANTHROPIC_MODEL
 * (or CLAUDE_MODEL). When Claude is not configured, callers automatically
 * fall back to the existing OpenAI / DeepSeek providers.
 */

export type ClaudeTextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function claudeApiKey() {
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim() ||
    ""
  );
}

export function claudeConfigured() {
  return Boolean(claudeApiKey());
}

export function claudeModel(model?: string) {
  return (
    model?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    process.env.CLAUDE_MODEL?.trim() ||
    "claude-sonnet-5-5"
  );
}

type AnthropicResponse = {
  error?: { message?: string } | null;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** Plain-text chat completion via Claude. Throws when Claude is unavailable. */
export async function chatWithClaude(input: {
  messages: ClaudeTextMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ content: string; model: string }> {
  const apiKey = claudeApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const model = claudeModel(input.model);

  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages = input.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));
  if (messages.length === 0) {
    throw new Error("Claude needs at least one user message");
  }

  await guardApiCredit();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(system ? { system } : {}),
      // Note: temperature is intentionally not sent — current Claude
      // models reject it ("`temperature` is deprecated for this model"),
      // which silently forced every Claude call to fall back.
      messages,
    }),
  });

  const data = (await response.json().catch(() => null)) as AnthropicResponse | null;
  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Claude request failed (${response.status})`,
    );
  }
  const content = (data?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  if (!content) {
    throw new Error("Claude returned an empty response");
  }
  await noteApiUsage({
    provider: "claude",
    model,
    inputTokens: Number(data?.usage?.input_tokens) || 0,
    outputTokens: Number(data?.usage?.output_tokens) || 0,
  });
  return { content, model };
}
