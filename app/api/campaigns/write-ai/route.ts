import { NextRequest, NextResponse } from "next/server";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { runInApiCredit } from "@/lib/api-credits-server";
import { chatWithDeepSeek } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 90;

const SYSTEM_PROMPT = `You write email body copy for B2B outreach and newsletters in the Nexuses portal.

Rules:
- Return only the email body as plain text. No subject line. No HTML tags. No markdown fences.
- Short paragraphs separated by a blank line. Keep it under 220 words unless the user asks for more.
- Friendly, clear, professional. Never use an em dash.
- You may use merge tags when a name or company fits: {{ contact.FIRSTNAME }}, {{ contact.LASTNAME }}, {{ contact.EMAIL }}, {{ contact.COMPANY }}, {{ unsubscribe }}.
- Do not invent fake URLs. Do not wrap the whole reply in quotes.
- If the user brief is vague, write a solid first draft they can edit.`;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      prompt?: string;
      campaignName?: string;
    } | null;
    const prompt = String(body?.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json(
        { error: "Describe what the email should say." },
        { status: 400 },
      );
    }
    if (prompt.length > 4000) {
      return NextResponse.json(
        { error: "Keep the brief under 4000 characters." },
        { status: 400 },
      );
    }

    const campaignName = String(body?.campaignName ?? "").trim();
    const userPrompt = [
      campaignName ? `Campaign name: ${campaignName}` : "",
      `Project: ${session.projectName}`,
      "",
      "Write the email body from this brief:",
      prompt,
    ]
      .filter(Boolean)
      .join("\n");

    return await runInApiCredit(session.projectId, "assistant", async () => {
      const raw = await chatWithDeepSeek({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        maxTokens: 1200,
      });
      const text = raw
        .replace(/^```[a-z]*\n?|```$/gi, "")
        .replace(/^Subject:\s*.+\n+/i, "")
        .replace(/\u2014/g, ", ")
        .trim();
      if (!text) {
        throw new Error("AI returned an empty draft");
      }
      return NextResponse.json({ text });
    });
  } catch (error) {
    console.error("Write with AI failed:", error);
    if (isApiCreditLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error && /API_KEY|not set/i.test(error.message)
            ? "AI is not configured on this server."
            : "Could not write the email. Try again.",
      },
      { status: 500 },
    );
  }
}
