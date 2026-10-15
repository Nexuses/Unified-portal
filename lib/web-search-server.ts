export type WebSource = { title: string; url: string };

type Provider = {
  name: "grok" | "openai";
  url: string;
  key: string;
  model: string;
  tools: Array<{ type: string }>;
};

type ResponsesPayload = {
  output_text?: string;
  citations?: unknown[];
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string }>;
    }>;
  }>;
  error?: { message?: string } | string;
};

/** Grok (web + X search) when XAI_API_KEY is set, otherwise OpenAI web search. */
function webProviders(): Provider[] {
  const list: Provider[] = [];
  const xai = process.env.XAI_API_KEY?.trim();
  if (xai) {
    list.push({
      name: "grok",
      url: "https://api.x.ai/v1/responses",
      key: xai,
      model: process.env.XAI_RESEARCH_MODEL?.trim() || "grok-4.7",
      tools: [{ type: "web_search" }, { type: "x_search" }],
    });
  }
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) {
    list.push({
      name: "openai",
      url: "https://api.openai.com/v1/responses",
      key: openai,
      model: process.env.OPENAI_WEB_SEARCH_MODEL?.trim() || "gpt-5-mini",
      tools: [{ type: "web_search" }],
    });
  }
  return list;
}

export function webResearchConfigured() {
  return webProviders().length > 0;
}

export function assertWebResearchConfigured() {
  if (!webResearchConfigured()) {
    throw new Error("Web research needs XAI_API_KEY or OPENAI_API_KEY on the server.");
  }
}

function dedupeSources(sources: WebSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function callProvider(
  provider: Provider,
  system: string,
  user: string,
  timeoutMs: number,
) {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: provider.tools,
      ...(provider.name === "openai" ? { reasoning: { effort: "low" } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await response.json().catch(() => null)) as ResponsesPayload | null;
  if (!response.ok || !data) {
    const message = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(message || `${provider.name} web search failed (${response.status})`);
  }

  let text = data.output_text ?? "";
  const sources: WebSource[] = [];
  for (const item of data.output ?? []) {
    for (const part of item.content ?? []) {
      if (!data.output_text && part.type === "output_text" && part.text) text += part.text;
      for (const note of part.annotations ?? []) {
        if (note.url) sources.push({ title: note.title || note.url, url: note.url });
      }
    }
  }
  for (const citation of data.citations ?? []) {
    if (typeof citation === "string") sources.push({ title: citation, url: citation });
  }
  if (!text.trim()) {
    throw new Error(`${provider.name} web search returned no answer`);
  }
  return { text, sources: dedupeSources(sources), provider: provider.name };
}

/** Runs a prompt with live web search; tries Grok first, then OpenAI. */
export async function researchWithWeb(input: {
  system: string;
  user: string;
  timeoutMs?: number;
}) {
  assertWebResearchConfigured();
  let lastError: unknown;
  for (const provider of webProviders()) {
    try {
      return await callProvider(provider, input.system, input.user, input.timeoutMs ?? 90_000);
    } catch (error) {
      lastError = error;
      console.warn(
        `[web-search] ${provider.name} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Web search failed");
}

/** Short factual answer with sources, for the portal assistant. */
export async function searchWeb(query: string) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await researchWithWeb({
    system: `You are a research assistant. Today is ${today}. Search the web and answer the question with facts you found, in under 180 words. Give official websites and exact URLs when asked. If sources disagree or nothing reliable is found, say so. Never guess.`,
    user: query,
    timeoutMs: 75_000,
  });
  return {
    answer: result.text.trim(),
    sources: result.sources.slice(0, 8),
    searchedWith: result.provider === "grok" ? "Grok" : "OpenAI web search",
  };
}
