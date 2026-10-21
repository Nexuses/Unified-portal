import { guardApiCredit, noteApiUsage, readTokenUsage } from "@/lib/api-credits-server";
import { chatWithClaude, claudeConfigured } from "@/lib/claude";

export type ChatContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "low" | "high" | "original" | "auto" };
    };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export async function chatWithDeepSeek(input: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}) {
  const result = await chatWithDeepSeekResult(input);
  return result.content;
}

function hasImageParts(messages: ChatMessage[]) {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
}

function toTextMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
  }));
}

async function chatWithOpenAi(input: {
  messages: ChatMessage[];
  maxTokens?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const model = process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-5-mini";
  await guardApiCredit();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      max_completion_tokens: input.maxTokens ?? 4096,
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  const tokens = readTokenUsage(data?.usage);
  await noteApiUsage({ provider: "openai", model, ...tokens });
  return { content, finishReason: choice?.finish_reason ?? "" };
}

async function chatWithDeepSeekOnly(input: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  await guardApiCredit();
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || "deepseek-chat",
      messages: input.messages,
      temperature: 0.35,
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `DeepSeek request failed (${response.status})`,
    );
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek returned an empty response");
  }
  const tokens = readTokenUsage(data?.usage);
  await noteApiUsage({
    provider: "deepseek",
    model: input.model || "deepseek-chat",
    ...tokens,
  });
  return { content, finishReason: choice?.finish_reason ?? "" };
}

/**
 * Preferred order: Claude → DeepSeek → OpenAI.
 * Claude is skipped when it cannot do the job here (not configured, an
 * explicit DeepSeek model was requested, or the request carries images),
 * and any Claude failure falls through to the next provider.
 */
export async function chatWithDeepSeekResult(input: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}) {
  const errors: string[] = [];

  if (!input.model && !hasImageParts(input.messages) && claudeConfigured()) {
    try {
      const result = await chatWithClaude({
        messages: toTextMessages(input.messages),
        maxTokens: input.maxTokens,
        temperature: 0.35,
      });
      return { content: result.content, finishReason: "stop" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Claude: ${message}`);
      console.warn(`[ai] Claude failed, switching provider: ${message}`);
    }
  }

  try {
    return await chatWithDeepSeekOnly(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`DeepSeek: ${message}`);
    console.warn(`[ai] DeepSeek failed, switching provider: ${message}`);
  }

  try {
    return await chatWithOpenAi(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`OpenAI: ${message}`);
  }

  throw new Error(
    errors.length > 0
      ? `All AI providers failed. ${errors.join(" · ")}`
      : "Set ANTHROPIC_API_KEY, DEEPSEEK_API_KEY or OPENAI_API_KEY to use AI chat.",
  );
}
