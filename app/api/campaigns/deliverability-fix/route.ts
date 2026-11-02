import { NextRequest, NextResponse } from "next/server";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { runInApiCredit } from "@/lib/api-credits-server";
import {
  applyDeterministicDeliverabilityFixes,
  countMissingImageAlts,
} from "@/lib/deliverability-content-fix";
import { chatWithDeepSeekResult } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

type FixFinding = {
  name?: string;
  score?: number;
  description?: string;
  title?: string;
  status?: string;
  detail?: string;
};

function stripFences(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:json|html)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      subject?: string;
      html?: string;
      score?: number;
      spamAssassinRules?: FixFinding[];
      contentIssues?: FixFinding[];
      authenticationNotes?: string[];
      blacklistNotes?: string[];
    } | null;

    const subject = String(body?.subject ?? "");
    const html = String(body?.html ?? "");
    if (!html.trim()) {
      return NextResponse.json(
        { error: "Email HTML is empty." },
        { status: 400 },
      );
    }

    const saRules = (body?.spamAssassinRules ?? [])
      .filter((rule) => Number(rule.score ?? 0) > 0)
      .slice(0, 25)
      .map(
        (rule) =>
          `- ${rule.name ?? "RULE"} (${rule.score}): ${rule.description ?? ""}`,
      )
      .join("\n");

    const contentIssueList = (body?.contentIssues ?? []).filter(
      (item) => item.status === "warning" || item.status === "failure",
    );
    const contentIssues = contentIssueList
      .slice(0, 12)
      .map(
        (item) =>
          `- ${item.title ?? "Content"}: ${item.detail || item.description || ""}`,
      )
      .join("\n");

    const mustFixMissingAlt = contentIssueList.some((item) =>
      /missing alt/i.test(String(item.title ?? "")),
    );
    const missingAltBefore = countMissingImageAlts(html);

    const authNotes = (body?.authenticationNotes ?? []).slice(0, 6).join("\n");
    const blacklistNotes = (body?.blacklistNotes ?? []).slice(0, 6).join("\n");

    return await runInApiCredit(session.projectId, "assistant", async () => {
      const result = await chatWithDeepSeekResult({
        maxTokens: 8000,
        messages: [
          {
            role: "system",
            content: `You are an email deliverability expert. Rewrite the marketing email HTML and subject so it is less likely to fail SpamAssassin / content spam checks, while keeping the same meaning, brand voice, links, merge tags ({{ ... }}), tracking pixels, and overall layout.

Return JSON only:
{"subject":"...","html":"...","summary":"one short sentence of what you changed"}

Rules:
- Preserve valid HTML structure. Return a full email HTML body (or full document if input was a full document).
- Keep all existing href URLs unless they are javascript: or known spam shorteners (bit.ly, tinyurl, t.co, goo.gl, ow.ly) — replace shorteners with a plain descriptive non-shortened placeholder path only if no real URL is known; prefer keeping original non-shortener links.
- Soften spammy wording, urgency, ALL CAPS, excessive exclamation marks, and pushy CTAs.
- MUST fix every Content finding listed below.
- For images missing alt (or empty alt=""): add a short meaningful alt on EVERY such <img>. Never leave alt missing or empty.
- Prefer a healthier text-to-HTML balance (readable text in the body).
- Do not invent unsubscribe links; keep {{ unsubscribe }} if present.
- Do not claim to fix SPF/DKIM/DMARC or IP blacklists in the HTML — those are DNS/server issues. You may only improve content that those checks mention.
- Never use an em dash.
- If nothing content-related can be improved, still return cleaned subject/html with a short summary.`,
          },
          {
            role: "user",
            content: [
              `Current deliverability score: ${body?.score ?? "?"}/10`,
              mustFixMissingAlt || missingAltBefore > 0
                ? `Required: fix ${missingAltBefore || "listed"} image(s) missing alt text.`
                : "",
              "",
              "SpamAssassin rules that hurt the score:",
              saRules || "(none)",
              "",
              "Content findings (MUST fix these in the HTML):",
              contentIssues || "(none)",
              "",
              "Authentication notes (cannot fix in HTML — context only):",
              authNotes || "(none)",
              "",
              "Blacklist notes (cannot fix in HTML — context only):",
              blacklistNotes || "(none)",
              "",
              `Subject:\n${subject || "(empty)"}`,
              "",
              `HTML:\n${html.slice(0, 50000)}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      });

      const raw = stripFences(result.content);
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) {
        throw new Error("AI returned an invalid fix payload");
      }
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        subject?: unknown;
        html?: unknown;
        summary?: unknown;
      };
      let fixedHtml = String(parsed.html ?? "").trim();
      const fixedSubject = String(parsed.subject ?? subject).trim();
      let summary = String(
        parsed.summary ?? "Applied deliverability edits.",
      ).trim();
      if (!fixedHtml) {
        throw new Error("AI returned empty HTML");
      }

      // Always enforce content fixes AI may miss (esp. missing alt).
      const beforeAlts = countMissingImageAlts(fixedHtml);
      fixedHtml = applyDeterministicDeliverabilityFixes(fixedHtml);
      const afterAlts = countMissingImageAlts(fixedHtml);
      if (beforeAlts > 0 && afterAlts === 0) {
        summary = summary
          ? `${summary} Added missing image alt text.`
          : "Added missing image alt text.";
      }

      return NextResponse.json({
        fixedHtml,
        fixedSubject: fixedSubject || subject,
        summary,
      });
    });
  } catch (error) {
    console.error("[deliverability-fix]", error);
    if (isApiCreditLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error && /API_KEY|not set/i.test(error.message)
            ? "AI is not configured on this server."
            : error instanceof Error
              ? error.message
              : "Could not fix the email with AI.",
      },
      { status: 500 },
    );
  }
}
