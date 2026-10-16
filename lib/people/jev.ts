import { guardApiCredit, noteApiUsage, readTokenUsage } from "@/lib/api-credits-server";

/**
 * Thin client for the Jev System One decisions API (TypeSafe AI).
 * Not OpenAI-compatible — uses state + typed questions, not chat completions.
 *
 * Hosts share the same request/response shape but not keys:
 * - Vercel AI Gateway (vck_… key): https://ai-gateway.vercel.sh/typesafe/v1, model "typesafe-ai/jev".
 *   Jev is a restricted model, so the team needs purchased AI Gateway credits.
 * - jev-agent.com (jv_live_… key): https://jev-agent.com/api/v1, model "jev-latest".
 */

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
};

export type JevNoulAnswer = {
  type: "noul";
  noul: number;
};

export type JevScoreAnswer = {
  type: "score";
  score: number;
  confidence?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
};

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer;

export type JevQuestion =
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

export type JevSystemOneResponse = {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const AI_GATEWAY_JEV_BASE_URL = "https://ai-gateway.vercel.sh/typesafe/v1";
const AI_GATEWAY_JEV_MODEL = "typesafe-ai/jev";
const JEV_AGENT_BASE_URL = "https://jev-agent.com/api/v1";
const JEV_AGENT_MODEL = "jev-latest";

export function getJevConfig() {
  const apiKey =
    process.env.JEV_API_KEY ||
    process.env.JEV_AGENT_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    "";
  const isJevAgentKey = apiKey.startsWith("jv_");
  const baseUrl = (
    process.env.JEV_BASE_URL ||
    (isJevAgentKey ? JEV_AGENT_BASE_URL : AI_GATEWAY_JEV_BASE_URL)
  ).replace(/\/$/, "");
  const model =
    process.env.JEV_MODEL ||
    (baseUrl.includes("ai-gateway.vercel.sh") ? AI_GATEWAY_JEV_MODEL : JEV_AGENT_MODEL);
  const confidenceMin = Number(process.env.JEV_CONFIDENCE_MIN ?? "0.85");
  return {
    apiKey,
    baseUrl,
    model,
    confidenceMin: Number.isFinite(confidenceMin) ? confidenceMin : 0.85,
  };
}

export async function callJevSystemOne(args: {
  state: unknown;
  questions: Record<string, JevQuestion>;
  model?: string;
  signal?: AbortSignal;
}): Promise<JevSystemOneResponse> {
  const { apiKey, baseUrl, model: defaultModel } = getJevConfig();
  if (!apiKey) {
    throw new Error("JEV_API_KEY or AI_GATEWAY_API_KEY is not configured");
  }

  const response = await fetch(`${baseUrl}/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model || defaultModel,
      state: args.state,
      questions: args.questions,
    }),
    signal: args.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Jev request failed (${response.status})${
        errorText ? `: ${errorText.slice(0, 200)}` : ""
      }`
    );
  }

  const payload = (await response.json()) as JevSystemOneResponse;
  if (!payload?.answers || typeof payload.answers !== "object") {
    throw new Error("Jev returned an empty response");
  }
  return payload;
  const model = args.model || defaultModel;
  const tokens = readTokenUsage(payload.usage);
  await noteApiUsage({
    provider: "openai",
    model,
    ...tokens,
    ...(tokens.inputTokens + tokens.outputTokens > 0
      ? {}
      : { flatUsd: 0.01, kind: "chat" as const }),
  });
}

export function asChoice(
  answer: JevAnswer | undefined,
  fallback = ""
): { choice: string; confidence: number } {
  if (answer && answer.type === "choice" && typeof answer.choice === "string") {
    return {
      choice: answer.choice,
      confidence:
        typeof answer.confidence === "number" ? answer.confidence : 0,
    };
  }
  return { choice: fallback, confidence: 0 };
}
