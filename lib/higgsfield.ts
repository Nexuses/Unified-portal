const HIGGSFIELD_API = "https://api.higgsfield.ai";

type HiggsfieldStatus = {
  status?: string;
  request_id?: string;
  error?: string | null;
  detail?: string;
  images?: Array<{ url?: string }>;
};

function credentials() {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (id && secret) return `${id}:${secret}`;
  const combined = process.env.HIGGSFIELD_API_KEY?.trim();
  if (combined?.includes(":")) return combined;
  throw new Error(
    "Higgsfield API key is not set. Add HF_API_KEY_ID and HF_API_KEY_SECRET to the environment.",
  );
}

async function higgsfield(path: string, init: RequestInit = {}) {
  const response = await fetch(`${HIGGSFIELD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Key ${credentials()}`,
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as
    | (HiggsfieldStatus & {
        public_url?: string;
        upload_url?: string;
        upload_headers?: Record<string, string>;
      })
    | null;
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `Higgsfield request failed (${response.status})`);
  }
  return data;
}

function imageBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error("The reference needs to be an image.");
  }
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 8_000_000) {
    throw new Error("That reference image is too large.");
  }
  return { contentType, bytes };
}

async function uploadReference(dataUrl: string) {
  const { contentType, bytes } = imageBytes(dataUrl);
  const upload = await higgsfield("/files/generate-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType }),
  });
  if (!upload?.upload_url || !upload.public_url) {
    throw new Error("Higgsfield did not return an upload URL.");
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(upload.upload_headers ?? {})) {
    if (typeof value === "string") headers.set(key, value);
  }
  if (!headers.has("Content-Type")) headers.set("Content-Type", contentType);
  const put = await fetch(upload.upload_url, {
    method: "PUT",
    headers,
    body: new Uint8Array(bytes),
  });
  if (!put.ok) {
    throw new Error("Could not upload the reference image.");
  }
  return upload.public_url;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateBrandedPost(input: { prompt: string; referenceDataUrl?: string }) {
  const reference = input.referenceDataUrl?.trim()
    ? await uploadReference(input.referenceDataUrl)
    : "";
  const body = reference
    ? {
        image_url: reference,
        prompt: input.prompt,
        aspect_ratio: "1:1",
        resolution: "720p",
        batch_size: 1,
        enhance_prompt: true,
      }
    : {
        prompt: input.prompt,
        aspect_ratio: "1:1",
        resolution: "720p",
        batch_size: 1,
        enhance_prompt: true,
      };
  const queued = await higgsfield(
    reference ? "/higgsfield-ai/soul/v2/image-to-image" : "/higgsfield-ai/soul/standard",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const ready = queued?.images?.find((item) => item.url?.trim())?.url?.trim();
  if (queued?.status === "completed" && ready) return ready;
  const requestId = queued?.request_id?.trim();
  if (!requestId) {
    throw new Error("Higgsfield did not start the post.");
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(attempt === 0 ? 1500 : 2500);
    const status = await higgsfield(`/requests/${requestId}/status`);
    if (status?.status === "completed") {
      const url = status.images?.find((item) => item.url?.trim())?.url?.trim();
      if (!url) throw new Error("Higgsfield finished without an image.");
      return url;
    }
    if (status?.status === "failed" || status?.status === "nsfw" || status?.status === "canceled") {
      throw new Error(status.error || "Higgsfield could not generate that post.");
    }
  }
  throw new Error("The post is still generating. Try again in a moment.");
}
