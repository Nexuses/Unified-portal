/**
 * Minimal client for Vercel AI Gateway (OpenAI-compatible chat completions).
 * Docs: https://vercel.com/docs/ai-gateway
 */

import { guardApiCredit, noteApiUsage, readTokenUsage } from "@/lib/api-credits-server";
import { chatWithClaude, claudeConfigured } from "@/lib/claude";

export type AiGatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function getAiGatewayConfig() {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (gatewayKey) {
    const baseUrl = (
      process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1"
    ).replace(/\/$/, "");
    const model = process.env.AI_GATEWAY_MODEL || "openai/gpt-4.1-mini";
    return { apiKey: gatewayKey, baseUrl, model };
  }
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    baseUrl: "https://api.openai.com/v1",
    model: process.env.ENRICH_AI_FILTER_MODEL?.trim() || "gpt-4.1-mini",
  };
}

export async function callAiGatewayJson(args: {
  messages: AiGatewayMessage[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<string> {
  // Claude first for JSON work; fall back to the gateway/OpenAI below.
  if (claudeConfigured() && !args.model) {
    try {
      const result = await chatWithClaude({
        messages: args.messages.map((message) => ({
          role: message.role,
          content:
            message.role === "system"
              ? `${message.content}\n\nReturn JSON only.`
              : message.content,
        })),
        temperature: args.temperature ?? 0.1,
        maxTokens: 4096,
      });
      return result.content;
    } catch (error) {
      console.warn(
        `[ai-gateway] Claude failed, switching provider: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const { apiKey, baseUrl, model: defaultModel } = getAiGatewayConfig();
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is not configured");
  }

  await guardApiCredit();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model || defaultModel,
      temperature: args.temperature ?? 0.1,
      response_format: { type: "json_object" },
      messages: args.messages,
    }),
    signal: args.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `AI Gateway request failed (${response.status})${
        errorText ? `: ${errorText.slice(0, 200)}` : ""
      }`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI Gateway returned an empty response");
  }
  const model = args.model || defaultModel;
  const tokens = readTokenUsage(payload.usage);
  await noteApiUsage({
    provider: model.startsWith("deepseek") ? "deepseek" : "openai",
    model,
    ...tokens,
  });
  return content;
}
