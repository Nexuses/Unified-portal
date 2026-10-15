import { NextRequest, NextResponse } from "next/server";
import { FILTER_SUGGEST_FIELDS, type FilterSuggestField } from "@/lib/people/filter-suggest-fields";
import { suggestFilterValues } from "@/lib/people/filter-suggest";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const maxDuration = 15;

function isSuggestField(value: string): value is FilterSuggestField {
  return value in FILTER_SUGGEST_FIELDS;
}

export async function GET(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) {
    return session;
  }

  const { searchParams } = request.nextUrl;
  const field = (searchParams.get("field") || "").trim();
  const query = (searchParams.get("q") || "").trim();

  if (!isSuggestField(field)) {
    return NextResponse.json({ error: "Invalid suggest field" }, { status: 400 });
  }
  if (query.length < 2) {
    return NextResponse.json({ options: [] });
  }

  try {
    const options = await suggestFilterValues(field, query, "people");
    return NextResponse.json({ options });
  } catch (error) {
    console.error("[enrich/people/suggest] failed", error);
    return NextResponse.json({ options: [] });
  }
}
