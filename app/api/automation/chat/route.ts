import { NextRequest, NextResponse } from "next/server";
import { chatWithDeepSeek, type ChatMessage } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const SYSTEM_PROMPT = `You are the Nexuses Automation assistant on the flow canvas.

Reply like a senior marketer: short, specific, and ready to use.
- 4–8 sentences or a tight numbered list. No preamble.
- Suggest real subject lines, wait times, and who should get the next email (opened / clicked / either).
- Use merge tags: {{ contact.FIRSTNAME }}, {{ contact.EMAIL }}, {{ contact.COMPANY }}, {{ unsubscribe }}.
- If the user already has steps, talk about THOSE steps. Say what is missing (campaign, wait, design).
- Drip = one email to a list. 1-1 = sequenced personal emails. Steps can mix kinds.
- Past-campaign Email 1 is already sent; do not tell them to resend it.
- Never invent portal buttons that do not exist. Next actions are: create/edit in Drip or 1-1, add a step, Start/Schedule.`;

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
        status?: string;
        stepCount?: number;
        steps?: Array<{
          n?: number;
          kind?: string;
          name?: string;
          campaignStatus?: string;
          start?: string;
          wait?: string;
          who?: string;
        }>;
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

    const stepLines = Array.isArray(body?.context?.steps)
      ? body.context.steps
          .slice(0, 8)
          .map((step) => {
            const n = typeof step?.n === "number" ? step.n : "?";
            return `Email ${n}: ${step?.kind || "drip"} · ${step?.name || "untitled"} · ${step?.campaignStatus || "none"} · ${step?.wait || ""} · ${step?.who || ""}`;
          })
          .join(" | ")
      : "";
    const contextBits = [
      body?.context?.campaignName
        ? `Automation: ${body.context.campaignName}`
        : "",
      body?.context?.status ? `Status: ${body.context.status}` : "",
      typeof body?.context?.stepCount === "number"
        ? `${body.context.stepCount} steps`
        : "",
      stepLines ? `Canvas: ${stepLines}` : "",
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
