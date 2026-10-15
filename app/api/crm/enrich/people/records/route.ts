import { NextRequest, NextResponse } from "next/server";
import { getEnrichPeopleRecordsByIds } from "@/lib/people/enrich-people-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Full records for the selected ids (used for Save to list and CSV export). */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    const records = await getEnrichPeopleRecordsByIds(ids);
    return NextResponse.json({ records });
  } catch (error) {
    console.error("[enrich/people/records] failed", error);
    const message = error instanceof Error ? error.message : "Failed to load records";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
