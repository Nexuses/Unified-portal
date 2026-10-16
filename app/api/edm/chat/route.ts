import { NextRequest, NextResponse } from "next/server";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { runInApiCredit } from "@/lib/api-credits-server";
import { chatWithDeepSeekResult, type ChatMessage } from "@/lib/deepseek";
import { extractEdmResult, htmlIsComplete } from "@/lib/edm-result";
import { loadKnowledgeBrand } from "@/lib/edm-brand";
import { fillGeneratedImages } from "@/lib/openai-images";
import { listProjectBuckets, publishHtmlImages, type EdmBucket } from "@/lib/s3-edm";
import { searchWeb, webResearchConfigured } from "@/lib/web-search-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

const SYSTEM_PROMPT = `You are the EDM assistant for Nexuses. You answer questions and you design HTML emails (EDMs).

Social posts, Instagram, LinkedIn, banners, and creatives are images, not emails. Do not write HTML for them and do not ask which S3 bucket to use. If one reaches you, reply with ANSWER: and one sentence that the post can be downloaded from the chat.

First decide what the latest request needs.

1. A question, research, ideas, subject lines, copy, or advice, with no request to build or change the email:
Answer it directly. Do not make or change an email. Return only:

ANSWER:
your answer

Use the knowledge base, the client name, and the conversation. Write plain text: short paragraphs, or lines starting with "- ". No markdown headings, no bold, no tables. Keep it under 200 words unless the user asks for more. Never use an em dash.

2. The answer needs facts that are not in the knowledge base or the conversation, such as what a company does, its website, news, or market facts:
Return only one line and nothing else:

SEARCH: a short web search query

You will get the web results back, then answer with ANSWER:. Only search once.

3. A request to create, design, write, edit, restyle, or fix an email:
Return exactly this shape and nothing else. No JSON. No markdown fences.

MESSAGE:
one or two sentences about what you made or changed

HTML:
<!DOCTYPE html>
...complete email ending with </html>

Email rules:
- The HTML part is a complete email document: tables, inline CSS, max width 600px, works in Gmail and Outlook.
- Always close every tag, including the body, and end with </html>.
- A preheader may be one short sentence. Do not pad it with word joiners, zero-width spaces, or any invisible characters. Do not copy that padding from a reference.
- Never use an em dash in the HTML. No — character, and no &mdash;. Use a comma, a period, or a hyphen.
- Pasted HTML and reference screenshots are layout only: section order, spacing, image-and-text rhythm, and button shape.
- Never copy colors, fonts, logos, product names, or claims from that reference. Replace them on the first draft.
- Colors, backgrounds, button color, text color, logo, copy, and links always come from the knowledge base brand, even if the user does not ask.
- Brand colors are the hex values taken from the client logo. Use those exact values in the CSS. Do not invent a different palette.
- The header logo must be an img whose src is the client logo URL exactly. Do not generate, redraw, or replace that logo.
- Attachments are not labeled. A screenshot is layout. Text that is a deck or site note is copy. An image the user calls a logo is the logo.
- To place an attached image in the email, use its {{file-N}} token as the img src.
- When the email needs a new photo or illustration, set that img src to exactly {{gen:short visual description}}. No quotes inside the description. At most 6 generated images. Do not generate the logo this way.
- Example: <img src="{{gen:wide photo of a sunlit product on a linen table}}" alt="Product" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
- If no attached image is used as a logo, use the client logo URL when one is given. Do not invent a logo.
- The knowledge base is the project's uploaded documents in Markdown. Use its facts, product names, and tone. Use URLs that appear in it as real destinations (button or footer) when they fit. Do not invent URLs.
- Use merge tags when a name or company fits: {{ contact.FIRSTNAME }}, {{ contact.EMAIL }}, {{ contact.COMPANY }}, {{ unsubscribe }}.
- If current HTML is provided, edit that document. Return the full HTML, not a diff.
- Keep MESSAGE to one or two sentences. Put the email only after HTML:.
- Never say you cannot browse the web. Use SEARCH: instead.`;

function answerOnly(raw: string) {
  const text = raw.replace(/```(?:\w+)?/g, "").trim();
  if (/^\s*HTML:/im.test(text) || /<!DOCTYPE|<html/i.test(text)) return null;
  return text
    .replace(/^\s*(?:ANSWER|MESSAGE):\s*/i, "")
    .replace(/\u2014/g, ", ")
    .trim()
    .slice(0, 6000);
}

function searchQuery(raw: string) {
  const match = raw.trim().match(/^SEARCH:\s*(.+)$/im);
  return match && !/HTML:/i.test(raw) ? match[1].trim().slice(0, 200) : "";
}

function needsImageUpload(html: string, imageTokens: string[]) {
  return (
    html.includes("{{gen:") ||
    /\bsrc=["']data:image\//i.test(html) ||
    imageTokens.some((token) => html.includes(token))
  );
}

function stripEmDashes(html: string) {
  return html.replace(/&mdash;|&#8212;|&#x2014;/gi, "-").replace(/\u2014/g, "-");
}

function ensureClientLogo(html: string, logoUrl: string) {
  const url = logoUrl.trim();
  if (!html || !url || html.includes(url)) return html;
  const safe = url.replace(/"/g, "%22");
  const existing = html.match(
    /<img\b[^>]*(?:alt=["'][^"']*logo[^"']*["']|src=["'][^"']*logo[^"']*["'])[^>]*>/i,
  );
  if (existing) {
    const next = /src=["'][^"']*["']/i.test(existing[0])
      ? existing[0].replace(/src=["'][^"']*["']/i, `src="${safe}"`)
      : existing[0].replace(/<img\b/i, `<img src="${safe}"`);
    return html.replace(existing[0], next);
  }
  const img = `<img src="${safe}" alt="Logo" width="160" style="display:block;width:160px;max-width:180px;height:auto;border:0;" />`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>\n${img}`);
  }
  return html;
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
    return await runInApiCredit(session.projectId, "edm", async () => {
    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      history?: unknown;
      links?: unknown;
      referenceHtml?: unknown;
      attachments?: unknown;
      currentHtml?: unknown;
      bucket?: { name?: unknown; region?: unknown };
      finalizeHtml?: unknown;
    } | null;

    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const finalizeHtml =
      typeof body?.finalizeHtml === "string" ? body.finalizeHtml.trim().slice(0, 200_000) : "";
    if (!message && !finalizeHtml) {
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
    const bucketName = typeof body?.bucket?.name === "string" ? body.bucket.name.trim() : "";
    const imageTokens = attachments.flatMap((file, index) =>
      file.dataUrl ? [`{{file-${index}}}`] : [],
    );

    async function finishEmail(html: string, bucket: EdmBucket) {
      let output = html;
      let note = "";
      attachments.forEach((file, index) => {
        if (file.dataUrl) output = output.replaceAll(`{{file-${index}}}`, file.dataUrl);
      });
      try {
        const generated = await fillGeneratedImages(output);
        output = generated.html;
        if (generated.count) {
          note = `Generated ${generated.count} image${generated.count === 1 ? "" : "s"}.`;
        }
      } catch (error) {
        note = error instanceof Error ? error.message : "Image generation failed";
      }
      if (/data:image\//.test(output)) output = await publishHtmlImages(output, bucket);
      return { html: stripEmDashes(output), note };
    }

    const projectName = session.projectName;
    async function pickBucket() {
      const allowed = await listProjectBuckets(projectName);
      return { allowed, chosen: allowed.find((item) => item.name === bucketName) ?? null };
    }

    if (finalizeHtml) {
      const { chosen } = await pickBucket();
      if (!chosen) {
        return NextResponse.json(
          { error: "Choose one of this project's S3 buckets before generating images." },
          { status: 400 },
        );
      }
      const done = await finishEmail(finalizeHtml, chosen);
      return NextResponse.json({ message: done.note, html: done.html });
    }

    const currentHtml =
      typeof body?.currentHtml === "string" ? clip(body.currentHtml, 50_000) : "";
    const brand = await loadKnowledgeBrand(session.projectId, session.projectLogoUrl);

    const context = [
      `Client: ${session.projectName}`,
      brand.text
        ? `Knowledge base brand. This controls the logo, colors, copy, and links. Do not wait for the user to ask:\n${brand.text}`
        : "Client logo URL: none",
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

    let firstReply = first;
    const query = searchQuery(first.content);
    if (query) {
      let findings = "Web search is not available. Answer from what you know and say the facts may be out of date.";
      if (webResearchConfigured()) {
        try {
          const found = await searchWeb(query);
          const sources = found.sources
            .slice(0, 3)
            .map((source) => source.url)
            .join(" · ");
          findings = `Web results for "${query}" (${found.searchedWith}):\n${found.answer}${sources ? `\n\nSources: ${sources}` : ""}`;
        } catch (error) {
          findings = `Web search failed: ${error instanceof Error ? error.message : "unknown error"}. Answer from what you know and say so.`;
        }
      }
      firstReply = await chatWithDeepSeekResult({
        maxTokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...prior,
          { role: "user", content: `${context}\n\nRequest:\n${message}` },
          { role: "assistant", content: `SEARCH: ${query}` },
          {
            role: "user",
            content: `${findings}\n\nNow complete the original request. Do not search again. If it was a question, reply with ANSWER: and end with one "Sources:" line of up to 3 links separated by " · ".`,
          },
        ],
      });
    }

    const answer = answerOnly(firstReply.content);
    if (answer !== null) {
      return NextResponse.json({ message: answer || "I could not find an answer to that.", html: "" });
    }

    const result = extractEdmResult(firstReply.content);
    result.html = stripInvisiblePadding(result.html);
    let finishReason = firstReply.finishReason;
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

    if (result.html) result.html = ensureClientLogo(result.html, brand.logoUrl);

    if (result.html && needsImageUpload(result.html, imageTokens)) {
      const { allowed, chosen } = await pickBucket();
      if (!chosen) {
        if (!allowed.length) {
          return NextResponse.json(
            { error: `No S3 buckets match ${session.projectName}. Images need a bucket to upload to.` },
            { status: 400 },
          );
        }
        return NextResponse.json({
          message: result.message,
          html: result.html,
          needsBucket: true,
          buckets: allowed,
          projectName: session.projectName,
        });
      }
      const done = await finishEmail(result.html, chosen);
      result.html = done.html;
      if (done.note) result.message = `${result.message} ${done.note}`;
    }
    if (result.html) result.html = stripEmDashes(result.html);
    return NextResponse.json(result);
    });
  } catch (error) {
    console.error("EDM chat failed:", error);
    if (isApiCreditLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
