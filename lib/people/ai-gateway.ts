/**
 * Minimal client for Vercel AI Gateway (OpenAI-compatible chat completions).
 * Docs: https://vercel.com/docs/ai-gateway
 */

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
  const { apiKey, baseUrl, model: defaultModel } = getAiGatewayConfig();
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is not configured");
  }

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
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI Gateway returned an empty response");
  }
  return content;
}
