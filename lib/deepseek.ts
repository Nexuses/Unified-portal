export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatWithDeepSeek(input: {
  messages: ChatMessage[];
  model?: string;
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
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  } | null;

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `DeepSeek request failed (${response.status})`,
    );
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek returned an empty response");
  }
  return content;
}
