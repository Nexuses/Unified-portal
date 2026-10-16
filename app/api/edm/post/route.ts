import { NextRequest, NextResponse } from "next/server";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { noteApiUsage, runInApiCredit } from "@/lib/api-credits-server";
import { loadKnowledgeBrand } from "@/lib/edm-brand";
import { stampLogo } from "@/lib/logo-brand";
import { listProjectBuckets, uploadDataImage } from "@/lib/s3-edm";
import {
  generatePostImage,
  listPostImageProviders,
  postImageLabel,
  resolvePostImageProvider,
} from "@/lib/post-image-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

function clip(value: string, limit: number) {
  return value.trim().slice(0, limit);
}

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  return NextResponse.json({ providers: listPostImageProviders() });
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as {
      prompt?: unknown;
      referenceDataUrl?: unknown;
      provider?: unknown;
      upload?: unknown;
      imageUrl?: unknown;
      bucket?: { name?: unknown; region?: unknown };
    } | null;

    if (body?.upload === true) {
      const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      if (!imageUrl.startsWith("data:image/")) {
        return NextResponse.json(
          { error: "Generate a post first, then ask to upload it." },
          { status: 400 },
        );
      }
      const buckets = await listProjectBuckets(session.projectName);
      const requested = typeof body.bucket?.name === "string" ? body.bucket.name.trim() : "";
      const chosen =
        buckets.find((item) => item.name === requested) ??
        (buckets.length === 1 ? buckets[0] : null);
      if (!chosen) {
        if (!buckets.length) {
          return NextResponse.json(
            { error: `No S3 buckets match ${session.projectName}.` },
            { status: 400 },
          );
        }
        return NextResponse.json({ needsBucket: true, buckets });
      }
      const url = await uploadDataImage(chosen, imageUrl);
      return NextResponse.json({ url, bucket: chosen.name });
    }

    const prompt = typeof body?.prompt === "string" ? clip(body.prompt, 2000) : "";
    if (!prompt) {
      return NextResponse.json({ error: "Write a prompt for the post." }, { status: 400 });
    }
    const referenceDataUrl =
      typeof body?.referenceDataUrl === "string" ? body.referenceDataUrl.trim() : "";
    if (referenceDataUrl.length > 2_500_000) {
      return NextResponse.json(
        { error: "That reference image is too large. Try a smaller file." },
        { status: 400 },
      );
    }

    return await runInApiCredit(session.projectId, "post", async () => {
    const brand = await loadKnowledgeBrand(session.projectId, session.projectLogoUrl);
    const branded = [
      `Square social media post for ${session.projectName}.`,
      "Use this brand for colors, product, and claims. Do not invent another company.",
      brand.colors.length
        ? `Brand colors from the branding guidelines and logo. Use only these exact colors: ${brand.colors.join(", ")}.`
        : "",
      brand.logoDataUrl
        ? "Do not draw a logo, wordmark, or company icon. Leave the top-left corner as empty background. The real logo is added afterwards."
        : "",
      brand.guidelines
        ? `Branding guidelines. Follow this design system and vocal tone:\n${clip(brand.guidelines, 4000)}`
        : "",
      brand.text ? `Knowledge base:\n${clip(brand.text, 1200)}` : "",
      referenceDataUrl
        ? "A reference image is attached for layout and composition only. Do not copy its colors, logo, or company."
        : "",
      "No watermarks. No em dash. Keep any words short and readable.",
      `Post request: ${prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const provider = resolvePostImageProvider(body?.provider);
    const generated = await generatePostImage(provider, {
      prompt: branded,
      referenceDataUrl,
    });
    const flatUsd = provider === "gemini" ? 0.03 : provider === "openai" ? 0.04 : 0.05;
    await noteApiUsage({
      projectId: session.projectId,
      feature: "post",
      provider:
        provider === "grok"
          ? "grok"
          : provider === "gemini"
            ? "gemini"
            : provider === "higgsfield"
              ? "higgsfield"
              : "openai",
      model: provider,
      flatUsd,
      kind: "image",
    });
    const imageUrl = brand.logoDataUrl
      ? await stampLogo(generated, brand.logoDataUrl).catch(() => generated)
      : generated;
    return NextResponse.json({
      imageUrl,
      provider,
      providerLabel: postImageLabel(provider),
    });
    });
  } catch (error) {
    console.error("EDM post generation failed:", error);
    if (isApiCreditLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : "Could not generate the post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
