export async function generateEmailImage(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add your ChatGPT API key to enable image generation.",
    );
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2.5-flare",
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
    throw new Error(data?.error?.message || `Image generation failed (${response.status})`);
  }

  const b64 = data?.data?.[0]?.b64_json?.trim();
  if (!b64) {
    throw new Error("ChatGPT returned an empty image");
  }
  return `data:image/jpeg;base64,${b64}`;
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
    return { html, count: 0 };
  }
  const entries = [...groups.entries()];
  const kept = entries.slice(0, 6);
  const dropped = entries.slice(6);

  const images = await Promise.all(
    kept.map(async ([prompt, tokens]) => ({
      tokens,
      src: await generateEmailImage(
        `Email image, no text, no logos, no watermarks. ${prompt}`,
      ),
    })),
  );

  let next = html;
  for (const image of images) {
    for (const token of image.tokens) {
      next = next.replaceAll(token, image.src);
    }
  }
  for (const [, tokens] of dropped) {
    for (const token of tokens) {
      next = next.replaceAll(token, "");
    }
  }

  return { html: next, count: images.length };
}
