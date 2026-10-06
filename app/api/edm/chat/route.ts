import { NextRequest, NextResponse } from "next/server";
import { chatWithDeepSeekResult, type ChatMessage } from "@/lib/deepseek";
import { extractEdmResult, htmlIsComplete } from "@/lib/edm-result";
import { loadKnowledgeBrand } from "@/lib/edm-brand";
import { fillGeneratedImages } from "@/lib/openai-images";
import { listProjectBuckets, publishHtmlImages } from "@/lib/s3-edm";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

const SYSTEM_PROMPT = `You design HTML emails (EDMs) for Nexuses.

Return exactly this shape and nothing else. No JSON. No markdown fences.

MESSAGE:
one or two sentences about what you made or changed

HTML:
<!DOCTYPE html>
...complete email ending with </html>

Rules:
- The HTML part is a complete email document: tables, inline CSS, max width 600px, works in Gmail and Outlook.
- Always close every tag, including the body, and end with </html>.
- A preheader may be one short sentence. Do not pad it with word joiners, zero-width spaces, or any invisible characters. Do not copy that padding from a reference.
- Never use an em dash in the HTML. No — character, and no &mdash;. Use a comma, a period, or a hyphen.
- Pasted HTML and reference screenshots are layout only: section order, spacing, image-and-text rhythm, and button shape.
- Never copy colors, fonts, logos, product names, or claims from that reference. Replace them on the first draft.
- Colors, backgrounds, button color, text color, logo, copy, and links always come from the knowledge base brand, even if the user does not ask.
- Use the knowledge base brand colors as the actual CSS hex values. Use its copy, not the reference company's copy.
- Attachments are not labeled. A screenshot is layout. Text that is a deck or site note is copy. An image the user calls a logo is the logo.
- To place an attached image in the email, use its {{file-N}} token as the img src.
- When the email needs a new photo or illustration, set that img src to exactly {{gen:short visual description}}. No quotes inside the description. At most 6 generated images. Do not generate the logo this way.
- Example: <img src="{{gen:wide photo of a sunlit product on a linen table}}" alt="Product" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
- If no attached image is used as a logo, use the client logo URL when one is given. Do not invent a logo.
- Use each knowledge base name and link as a real destination in the email when it fits (button or footer). Do not invent URLs.
- Use merge tags when a name or company fits: {{ contact.FIRSTNAME }}, {{ contact.EMAIL }}, {{ contact.COMPANY }}, {{ unsubscribe }}.
- If current HTML is provided, edit that document. Return the full HTML, not a diff.
- Keep MESSAGE to one or two sentences. Put the email only after HTML:.`;

function stripEmDashes(html: string) {
  return html.replace(/&mdash;|&#8212;|&#x2014;/gi, "-").replace(/\u2014/g, "-");
}

function stripInvisiblePadding(html: string) {
  return html.replace(/(?:[\u034F\u200B-\u200D\u2060\uFEFF\u00AD]\s*){4,}/g, "");
}

function continuationTail(html: string) {
  const visible = stripInvisiblePadding(html);
  return visible.slice(-1800);
}

function looksLikeMarkup(value: string) {
  return /<\/?[a-z][^>]*>/i.test(value);
}

function clip(value: string, limit: number) {
  return value.trim().slice(0, limit);
}

function imageDataUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(trimmed)) return "";
  if (trimmed.length > 2_500_000) {
    throw new Error("That image is too large. Try a smaller file.");
  }
  return trimmed;
}


export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;

    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      history?: unknown;
      links?: unknown;
      referenceHtml?: unknown;
      attachments?: unknown;
      currentHtml?: unknown;
      bucket?: { name?: unknown; region?: unknown };
    } | null;

    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const history = Array.isArray(body?.history) ? body.history : [];
    const prior: ChatMessage[] = history
      .filter(
        (item): item is { role: string; content: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { content?: unknown }).content === "string" &&
          ((item as { role?: unknown }).role === "user" ||
            (item as { role?: unknown }).role === "assistant"),
      )
      .slice(-8)
      .map((item) => ({
        role: item.role as "user" | "assistant",
        content: item.content.slice(0, 1500),
      }));

    const referenceHtml =
      typeof body?.referenceHtml === "string" ? clip(body.referenceHtml, 20_000) : "";
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments
          .filter((item) => item && typeof item === "object")
          .slice(0, 6)
          .map((item) => {
            const record = item as { name?: unknown; text?: unknown; dataUrl?: unknown };
            return {
              name: typeof record.name === "string" ? clip(record.name, 180) : "file",
              text: typeof record.text === "string" ? clip(record.text, 12_000) : "",
              dataUrl: imageDataUrl(record.dataUrl),
            };
          })
      : [];
    const currentHtml =
      typeof body?.currentHtml === "string" ? clip(body.currentHtml, 50_000) : "";
    const brand = await loadKnowledgeBrand(session.projectId);

    const context = [
      `Client: ${session.projectName}`,
      session.projectLogoUrl
        ? `Client logo URL (use this src in the header): ${session.projectLogoUrl}`
        : "Client logo URL: none",
      brand
        ? `Knowledge base brand. This controls color, copy, and links. Do not wait for the user to ask:\n${brand}`
        : "",
      referenceHtml
        ? `Layout reference only. Copy the structure, not the colors or the company:\n${referenceHtml}`
        : "",
      attachments.length
        ? attachments
            .map((file, index) =>
              file.dataUrl
                ? `Attached image ${index + 1}: ${file.name}. To show it in the email, use src {{file-${index}}}.`
                : file.text
                  ? /<!doctype|<html|<table/i.test(file.text)
                    ? `Attached layout reference only (ignore its colors and brand): ${file.name}\n${file.text}`
                    : `Attached knowledge copy: ${file.name}\n${file.text}`
                  : "",
            )
            .filter(Boolean)
            .join("\n\n")
        : "",
      currentHtml ? `Current HTML to edit:\n${currentHtml}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const images = attachments
      .map((file, index) =>
        file.dataUrl ? { url: file.dataUrl, note: `Image {{file-${index}}} is ${file.name}.` } : null,
      )
      .filter((item): item is { url: string; note: string } => Boolean(item));

    const requestText = `${context}\n\n${images.map((item) => item.note).join("\n")}\n\nRequest:\n${message}`;
    const model = images.length ? "deepseek-v4-flash-vision-exp" : undefined;
    const first = await chatWithDeepSeekResult({
      maxTokens: 8192,
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...prior,
        {
          role: "user",
          content: images.length
            ? [
                { type: "text", text: requestText },
                ...images.map((item) => ({
                  type: "image_url" as const,
                  image_url: { url: item.url, detail: "high" as const },
                })),
              ]
            : requestText,
        },
      ],
    });

    const result = extractEdmResult(first.content);
    result.html = stripInvisiblePadding(result.html);
    let finishReason = first.finishReason;
    for (let attempt = 0; attempt < 2 && result.html && !htmlIsComplete(result.html); attempt += 1) {
      const rest = await chatWithDeepSeekResult({
        maxTokens: 8192,
        model,
        messages: [
          {
            role: "system",
            content:
              "The email HTML was cut off. Continue from the exact cutoff. Output only the remaining HTML tags and finish with </html>. Do not repeat earlier markup, do not add commentary, and do not use an em dash. If you cannot see the markup, output nothing.",
          },
          { role: "user", content: continuationTail(result.html) },
        ],
      });
      finishReason = rest.finishReason;
      const continued = extractEdmResult(`HTML:\n${rest.content}`);
      const addition = (continued.html || rest.content.replace(/```(?:html)?/gi, "").trim()).trim();
      if (!looksLikeMarkup(addition)) break;
      if (/<!DOCTYPE html/i.test(addition) && htmlIsComplete(addition)) {
        result.html = addition;
        break;
      }
      result.html += addition;
      result.html = stripInvisiblePadding(result.html);
      if (finishReason && finishReason !== "length" && htmlIsComplete(result.html)) break;
    }

    attachments.forEach((file, index) => {
      if (!file.dataUrl) return;
      result.html = result.html.replaceAll(`{{file-${index}}}`, file.dataUrl);
    });
    if (result.html) {
      try {
        const generated = await fillGeneratedImages(result.html);
        result.html = generated.html;
        if (generated.count) {
          result.message = `${result.message} Generated ${generated.count} image${generated.count === 1 ? "" : "s"}.`;
        }
      } catch (error) {
        const note = error instanceof Error ? error.message : "Image generation failed";
        result.message = `${result.message} ${note}`;
      }
    }
    if (result.html && /data:image\//.test(result.html)) {
      const bucketName = typeof body?.bucket?.name === "string" ? body.bucket.name.trim() : "";
      const allowed = await listProjectBuckets(session.projectName);
      const chosen = allowed.find((item) => item.name === bucketName);
      if (!chosen) {
        return NextResponse.json(
          { error: "Choose one of this project's S3 buckets before generating images." },
          { status: 400 },
        );
      }
      result.html = await publishHtmlImages(result.html, chosen);
    }
    if (result.html) result.html = stripEmDashes(result.html);
    return NextResponse.json(result);
  } catch (error) {
    console.error("EDM chat failed:", error);
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
