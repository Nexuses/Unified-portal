import { generateBrandedPost } from "@/lib/higgsfield";

export const POST_IMAGE_PROVIDERS = ["openai", "higgsfield", "grok", "gemini"] as const;
export type PostImageProvider = (typeof POST_IMAGE_PROVIDERS)[number];

const LABELS: Record<PostImageProvider, string> = {
  openai: "ChatGPT Image",
  higgsfield: "Higgsfield",
  grok: "Grok Imagine",
  gemini: "Gemini",
};

const MISSING_KEY: Record<PostImageProvider, string> = {
  openai: "OPENAI_API_KEY",
  higgsfield: "HF_API_KEY_ID and HF_API_KEY_SECRET",
  grok: "XAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function geminiKey() {
  return env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
}

function configured(provider: PostImageProvider) {
  if (provider === "openai") return Boolean(env("OPENAI_API_KEY"));
  if (provider === "higgsfield") {
    return Boolean(
      (env("HF_API_KEY_ID") && env("HF_API_KEY_SECRET")) || env("HIGGSFIELD_API_KEY").includes(":"),
    );
  }
  if (provider === "grok") return Boolean(env("XAI_API_KEY"));
  return Boolean(geminiKey());
}

export function listPostImageProviders() {
  return POST_IMAGE_PROVIDERS.map((id) => ({
    id,
    label: LABELS[id],
    configured: configured(id),
    referenceImages: id !== "grok",
  }));
}

export function postImageLabel(provider: PostImageProvider) {
  return LABELS[provider];
}

export function resolvePostImageProvider(value: unknown): PostImageProvider {
  const asked = POST_IMAGE_PROVIDERS.find((id) => id === value);
  if (asked) {
    if (!configured(asked)) {
      throw new Error(`${LABELS[asked]} is not set up. Add ${MISSING_KEY[asked]} to the environment.`);
    }
    return asked;
  }
  const fallback = POST_IMAGE_PROVIDERS.find(configured);
  if (!fallback) throw new Error("No image AI is set up. Add OPENAI_API_KEY to the environment.");
  return fallback;
}

function splitDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("The reference needs to be an image.");
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return { mimeType, base64: match[2].replace(/\s/g, "") };
}

async function readJson<T>(response: Response, name: string) {
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } | string })
    | null;
  if (!response.ok) {
    const error = data?.error;
    const message = typeof error === "string" ? error : error?.message;
    throw new Error(message || `${name} image request failed (${response.status})`);
  }
  return data;
}

async function openAiPost(prompt: string, referenceDataUrl: string) {
  const apiKey = env("OPENAI_API_KEY");
  const model = env("OPENAI_IMAGE_MODEL") || "gpt-image-2.5-flare";
  let response: Response;
  if (referenceDataUrl) {
    const { mimeType, base64 } = splitDataUrl(referenceDataUrl);
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt.slice(0, 3200));
    form.set("size", "1024x1024");
    form.set("quality", "medium");
    form.set("output_format", "jpeg");
    form.set("output_compression", "80");
    form.append(
      "image[]",
      new Blob([Buffer.from(base64, "base64")], { type: mimeType }),
      `reference.${mimeType.split("/")[1]}`,
    );
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: prompt.slice(0, 3200),
        size: "1024x1024",
        quality: "medium",
        output_format: "jpeg",
        output_compression: 80,
      }),
    });
  }
  const data = await readJson<{ data?: Array<{ b64_json?: string }> }>(response, "ChatGPT");
  const b64 = data?.data?.[0]?.b64_json?.trim();
  if (!b64) throw new Error("ChatGPT returned an empty image.");
  return `data:image/jpeg;base64,${b64}`;
}

async function grokPost(prompt: string) {
  const response = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("XAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env("XAI_IMAGE_MODEL") || "grok-imagine-image",
      prompt: prompt.slice(0, 3000),
      n: 1,
      response_format: "b64_json",
    }),
  });
  const data = await readJson<{ data?: Array<{ b64_json?: string; url?: string }> }>(
    response,
    "Grok",
  );
  const image = data?.data?.[0];
  if (image?.b64_json?.trim()) return `data:image/jpeg;base64,${image.b64_json.trim()}`;
  if (image?.url?.trim()) return image.url.trim();
  throw new Error("Grok returned an empty image.");
}

async function geminiPost(prompt: string, referenceDataUrl: string) {
  const model = env("GEMINI_IMAGE_MODEL") || "gemini-2.5-flash-image";
  const parts: Array<Record<string, unknown>> = [{ text: prompt.slice(0, 6000) }];
  if (referenceDataUrl) {
    const { mimeType, base64 } = splitDataUrl(referenceDataUrl);
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": geminiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1" },
        },
      }),
    },
  );
  const data = await readJson<{
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  }>(response, "Gemini");
  const image = data?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)
    ?.inlineData;
  if (!image?.data) throw new Error("Gemini returned no image. Try a different prompt.");
  return `data:${image.mimeType || "image/png"};base64,${image.data}`;
}

export async function generatePostImage(
  provider: PostImageProvider,
  input: { prompt: string; referenceDataUrl?: string },
) {
  const reference = input.referenceDataUrl?.trim() || "";
  if (provider === "higgsfield") {
    return generateBrandedPost({ prompt: input.prompt, referenceDataUrl: reference });
  }
  if (provider === "grok") return grokPost(input.prompt);
  if (provider === "gemini") return geminiPost(input.prompt, reference);
  return openAiPost(input.prompt, reference);
}
