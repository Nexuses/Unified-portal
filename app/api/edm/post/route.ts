import { NextRequest, NextResponse } from "next/server";
import { loadKnowledgeBrand } from "@/lib/edm-brand";
import { generateBrandedPost } from "@/lib/higgsfield";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

function clip(value: string, limit: number) {
  return value.trim().slice(0, limit);
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;

    const body = (await request.json().catch(() => null)) as {
      prompt?: unknown;
      referenceDataUrl?: unknown;
    } | null;
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

    const brand = await loadKnowledgeBrand(session.projectId);
    const branded = [
      `Square social media post for ${session.projectName}.`,
      "Use this brand for colors, product, and claims. Do not invent another company.",
      session.projectLogoUrl
        ? `The client logo is already known. Do not replace it with a different logo. Logo URL: ${session.projectLogoUrl}`
        : "",
      brand ? `Knowledge base brand:\n${clip(brand, 1400)}` : "",
      referenceDataUrl
        ? "A reference image is attached for layout and composition only. Do not copy its colors, logo, or company."
        : "",
      "No watermarks. No em dash. Keep any words short and readable.",
      `Post request: ${prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const imageUrl = await generateBrandedPost({
      prompt: branded,
      referenceDataUrl,
    });
    return NextResponse.json({ imageUrl });
  } catch (error) {
    console.error("EDM post generation failed:", error);
    const message = error instanceof Error ? error.message : "Could not generate the post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
