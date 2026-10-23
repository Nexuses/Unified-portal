import { guardApiCredit, noteApiUsage } from "@/lib/api-credits-server";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function geminiKey() {
  return env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
}

async function generateWithOpenAi(prompt: string) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const model = env("OPENAI_IMAGE_MODEL") || "gpt-image-2.5-flare";
  await guardApiCredit();
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: prompt.slice(0, 3200),
      size: "1536x1024",
      quality: "low",
      output_format: "jpeg",
      output_compression: 70,
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    data?: Array<{ b64_json?: string }>;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI image failed (${response.status})`);
  }

  const b64 = data?.data?.[0]?.b64_json?.trim();
  if (!b64) {
    throw new Error("OpenAI returned an empty image");
  }
  await noteApiUsage({
    provider: "openai",
    model,
    flatUsd: 0.02,
    kind: "image",
  });
  return `data:image/jpeg;base64,${b64}`;
}

async function generateWithGrok(prompt: string) {
  const apiKey = env("XAI_API_KEY");
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not set");
  }
  const model = env("XAI_IMAGE_MODEL") || "grok-imagine-image";
  await guardApiCredit();
  const response = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: prompt.slice(0, 3000),
      n: 1,
      response_format: "b64_json",
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    data?: Array<{ b64_json?: string; url?: string }>;
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Grok image failed (${response.status})`);
  }
  const image = data?.data?.[0];
  if (image?.b64_json?.trim()) {
    await noteApiUsage({ provider: "xai", model, flatUsd: 0.02, kind: "image" });
    return `data:image/jpeg;base64,${image.b64_json.trim()}`;
  }
  if (image?.url?.trim()) {
    await noteApiUsage({ provider: "xai", model, flatUsd: 0.02, kind: "image" });
    return image.url.trim();
  }
  throw new Error("Grok returned an empty image");
}

async function generateWithGemini(prompt: string) {
  const apiKey = geminiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const model = env("GEMINI_IMAGE_MODEL") || "gemini-2.5-flash-image";
  await guardApiCredit();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt.slice(0, 6000) }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "16:9" },
        },
      }),
    },
  );
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
      };
    }>;
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini image failed (${response.status})`);
  }
  const image = data?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)
    ?.inlineData;
  if (!image?.data) {
    throw new Error("Gemini returned no image");
  }
  await noteApiUsage({ provider: "gemini", model, flatUsd: 0.03, kind: "image" });
  return `data:${image.mimeType || "image/png"};base64,${image.data}`;
}

/**
 * Email body images for `{{gen:…}}` placeholders.
 * Order: OpenAI → Grok → Gemini (chat HTML still uses Claude → DeepSeek → OpenAI).
 */
export async function generateEmailImage(prompt: string) {
  const errors: string[] = [];
  const attempts: Array<{ name: string; run: () => Promise<string> }> = [];
  if (env("OPENAI_API_KEY")) {
    attempts.push({ name: "OpenAI", run: () => generateWithOpenAi(prompt) });
  }
  if (env("XAI_API_KEY")) {
    attempts.push({ name: "Grok", run: () => generateWithGrok(prompt) });
  }
  if (geminiKey()) {
    attempts.push({ name: "Gemini", run: () => generateWithGemini(prompt) });
  }
  if (!attempts.length) {
    throw new Error(
      "No image AI is configured. Add OPENAI_API_KEY (or XAI_API_KEY / GEMINI_API_KEY) for email images.",
    );
  }

  for (const attempt of attempts) {
    try {
      return await attempt.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.name}: ${message}`);
      console.warn(`[edm-image] ${attempt.name} failed: ${message}`);
    }
  }

  throw new Error(
    `Email image generation failed (HTML chat still uses Claude first). ${errors.join(" · ")}`,
  );
}

export async function fillGeneratedImages(html: string) {
  const groups = new Map<string, string[]>();
  for (const match of html.matchAll(/\{\{gen:([^}]{1,500})\}\}/g)) {
    const prompt = match[1].trim();
    if (!prompt) continue;
    const tokens = groups.get(prompt) ?? [];
    tokens.push(match[0]);
    groups.set(prompt, tokens);
  }
  if (!groups.size) {
    return { html, count: 0, note: "" };
  }
  const entries = [...groups.entries()];
  const kept = entries.slice(0, 6);
  const dropped = entries.slice(6);

  const results = await Promise.all(
    kept.map(async ([prompt, tokens]) => {
      try {
        const src = await generateEmailImage(
          `Email image, no text, no logos, no watermarks. ${prompt}`,
        );
        return { tokens, src, error: "" };
      } catch (error) {
        return {
          tokens,
          src: "",
          error: error instanceof Error ? error.message : "Image generation failed",
        };
      }
    }),
  );

  let next = html;
  let count = 0;
  const failures: string[] = [];
  for (const image of results) {
    if (image.src) {
      count += 1;
      for (const token of image.tokens) {
        next = next.replaceAll(token, image.src);
      }
    } else {
      if (image.error) failures.push(image.error);
      for (const token of image.tokens) {
        next = next.replaceAll(token, "");
      }
    }
  }
  for (const [, tokens] of dropped) {
    for (const token of tokens) {
      next = next.replaceAll(token, "");
    }
  }

  let note = "";
  if (count > 0) {
    note = `Generated ${count} image${count === 1 ? "" : "s"}.`;
  }
  if (failures.length) {
    const detail = failures[0];
    note = note
      ? `${note} Some images were skipped: ${detail}`
      : `Email HTML was created, but images were skipped: ${detail}`;
  }

  return { html: next, count, note };
}
