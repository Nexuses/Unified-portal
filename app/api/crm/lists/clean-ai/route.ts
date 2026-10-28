import { NextRequest, NextResponse } from "next/server";
import { isApiCreditLimitError } from "@/lib/api-credits";
import { runInApiCredit } from "@/lib/api-credits-server";
import {
  cleanContactFields,
  type CleanableContact,
} from "@/lib/crm-contact-clean";
import { chatWithDeepSeek } from "@/lib/deepseek";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CONTACTS = 80;

const SYSTEM_PROMPT = `You clean CRM contact fields for email outreach imports.

For each contact, return cleaned:
- firstName: given name only (no titles like CA, Mr, Dr, Prof). Never a lone initial when a surname exists — use the surname as firstName instead (e.g. "N Tiwari" → firstName "Tiwari", lastName "").
- lastName: family name only
- companyName: English / Latin script only. Remove Arabic or other non-English script mixed into the same value.
- position: primary short job title only (e.g. "CFO" from "CFO, Board Member, Advisor…")

Rules:
- Do not invent emails or change identity beyond formatting.
- Do not add honorifics.
- Keep empty fields empty.
- Return ONLY a JSON array of objects with keys: id, firstName, lastName, companyName, position.
- Same ids as input, same array length.`;

function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("AI did not return a contact list");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

function normalizeIncoming(rows: unknown): CleanableContact[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .slice(0, MAX_CONTACTS)
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? "").trim(),
        firstName: String(item.firstName ?? "").trim(),
        lastName: String(item.lastName ?? "").trim(),
        companyName: String(item.companyName ?? "").trim(),
        position: String(item.position ?? "").trim(),
      };
    })
    .filter((row) => row.id);
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      contacts?: unknown;
    } | null;
    const incoming = normalizeIncoming(body?.contacts);
    if (incoming.length === 0) {
      return NextResponse.json(
        { error: "No contacts to clean." },
        { status: 400 },
      );
    }

    // Free rule pass first so AI only polishes leftovers.
    const ruled = incoming.map((row) => {
      const cleaned = cleanContactFields(row);
      return {
        id: row.id,
        firstName: cleaned.firstName,
        lastName: cleaned.lastName,
        companyName: cleaned.companyName,
        position: cleaned.position,
      };
    });

    try {
      const contacts = await runInApiCredit(
        session.projectId,
        "crm",
        async () => {
          const raw = await chatWithDeepSeek({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: JSON.stringify(ruled),
              },
            ],
            maxTokens: 4096,
          });
          const parsed = extractJsonArray(raw);
          if (!Array.isArray(parsed)) {
            throw new Error("AI returned invalid contact data");
          }
          const byId = new Map<string, CleanableContact>();
          for (const row of parsed) {
            if (!row || typeof row !== "object") {
              continue;
            }
            const item = row as Record<string, unknown>;
            const id = String(item.id ?? "").trim();
            if (!id) {
              continue;
            }
            const cleaned = cleanContactFields({
              firstName: String(item.firstName ?? ""),
              lastName: String(item.lastName ?? ""),
              companyName: String(item.companyName ?? ""),
              position: String(item.position ?? ""),
            });
            byId.set(id, {
              id,
              firstName: cleaned.firstName,
              lastName: cleaned.lastName,
              companyName: cleaned.companyName,
              position: cleaned.position,
            });
          }
          return ruled.map((row) => byId.get(row.id) ?? row);
        },
      );

      return NextResponse.json({ contacts, cleaned: contacts.length });
    } catch (error) {
      if (isApiCreditLimitError(error)) {
        return NextResponse.json(
          { error: error.message, code: "api_credit_limit" },
          { status: 402 },
        );
      }
      // If the model fails, still return the free rule-based clean.
      console.error("CRM clean-ai model failed, returning rule clean:", error);
      return NextResponse.json({
        contacts: ruled,
        cleaned: ruled.length,
        fallback: "rules",
      });
    }
  } catch (error) {
    console.error("Failed to clean CRM contacts:", error);
    return NextResponse.json(
      { error: "Failed to clean contacts" },
      { status: 500 },
    );
  }
}
