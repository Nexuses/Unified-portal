import { NextRequest, NextResponse } from "next/server";
import { chatWithDeepSeek, type ChatMessage } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const SYSTEM_PROMPT = `You are the Unified Portal Automation assistant.
Help users design email drip and 1-1 campaign sequences for the Nexuses portal.
Be concrete: suggest subjects, HTML-friendly email copy, delays, and follow-ups on opens/clicks.
Use merge tags like {{ contact.FIRSTNAME }}, {{ contact.EMAIL }}, {{ contact.COMPANY }}, {{ unsubscribe }}.
When proposing a sequence, use a clear numbered list of steps.
Keep answers practical and ready to paste into the Automation canvas.`;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      history?: unknown;
      context?: {
        kind?: string;
        campaignName?: string;
        stepCount?: number;
      };
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
      .slice(-12)
      .map((item) => ({
        role: item.role as "user" | "assistant",
        content: item.content.slice(0, 4000),
      }));

    const contextBits = [
      body?.context?.kind ? `Campaign kind: ${body.context.kind}` : "",
      body?.context?.campaignName
        ? `Campaign name: ${body.context.campaignName}`
        : "",
      typeof body?.context?.stepCount === "number"
        ? `Current steps on canvas: ${body.context.stepCount}`
        : "",
    ]
      .filter(Boolean)
      .join(". ");

    const reply = await chatWithDeepSeek({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(contextBits
          ? ([
              {
                role: "system",
                content: `Current automation context: ${contextBits}`,
              },
            ] as ChatMessage[])
          : []),
        ...prior,
        { role: "user", content: message.slice(0, 4000) },
      ],
    });

    return NextResponse.json({ reply });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to chat with DeepSeek";
    console.error("Automation chat failed:", error);
    const status = message.includes("DEEPSEEK_API_KEY") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
