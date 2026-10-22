import { NextRequest, NextResponse } from "next/server";
import { runInApiCredit } from "@/lib/api-credits-server";
import { chatWithDeepSeek, type ChatMessage } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const SYSTEM_PROMPT = `You are the Nexuses Automation setup assistant on the flow canvas.

Reply like a senior marketer: short, specific, and ready to use.
- Prefer 2–5 short sentences. No preamble.
- If the user gives incomplete information, ASK clarifying questions — one missing thing at a time (sender, list/recipients, subject, HTML design, wait gap, Past vs New, open/click audience). Do not invent full multi-email plans.
- When context.missing is present, use it: name the gaps and ask the next question.
- Suggest real subject lines, wait times, and who should get the next email (opened / clicked / either) only when helpful.
- Use merge tags: {{ contact.FIRSTNAME }}, {{ contact.EMAIL }}, {{ contact.COMPANY }}, {{ unsubscribe }}.
- If the user already has steps, talk about THOSE steps.
- Drip = one email to a list. 1-1 = sequenced personal emails. Steps can mix kinds.
- Past-campaign Email 1 targets engagers from a sent campaign; do not tell them to resend that past campaign.
- Setup choices (sender, list, HTML, gaps) are buttons in this chat. Point users to “Continue setup with choices” / “Set up this campaign” instead of Drip/1-1 pages.
- Never invent portal buttons that do not exist.`;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    return await runInApiCredit(session.projectId, "automation", async () => {
    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      history?: unknown;
      context?: {
        kind?: string;
        campaignName?: string;
        status?: string;
        stepCount?: number;
        guidedSetup?: boolean;
        missing?: string[];
        steps?: Array<{
          n?: number;
          kind?: string;
          name?: string;
          campaignStatus?: string;
          start?: string;
          wait?: string;
          who?: string;
          hasSender?: boolean;
          hasAudience?: boolean;
          hasDesign?: boolean;
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
    const missingLines = Array.isArray(body?.context?.missing)
      ? body.context.missing.filter((item) => typeof item === "string").slice(0, 12)
      : [];
    const contextBits = [
      body?.context?.campaignName
        ? `Automation: ${body.context.campaignName}`
        : "",
      body?.context?.status ? `Status: ${body.context.status}` : "",
      typeof body?.context?.stepCount === "number"
        ? `${body.context.stepCount} steps`
        : "",
      body?.context?.guidedSetup ? "Guided setup is active" : "",
      stepLines ? `Canvas: ${stepLines}` : "",
      missingLines.length > 0 ? `Missing: ${missingLines.join("; ")}` : "",
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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to chat with DeepSeek";
    console.error("Automation chat failed:", error);
    const status = message.includes("DEEPSEEK_API_KEY") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
