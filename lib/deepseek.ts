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

export async function chatWithDeepSeekResult(input: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add it to your environment to use Automation chat.",
    );
  }

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
  return { content, finishReason: choice?.finish_reason ?? "" };
}
