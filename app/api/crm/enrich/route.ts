import { NextRequest, NextResponse } from "next/server";
import {
  searchEnrichPeople,
  type EnrichSearchFilters,
} from "@/lib/datatool";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const filters: EnrichSearchFilters = {
      titles: asStringArray(body.titles),
      managementLevels: asStringArray(body.managementLevels),
      employeeSizes: asStringArray(body.employeeSizes),
      industryKeywords: asStringArray(body.industryKeywords),
      revenueRanges: asStringArray(body.revenueRanges),
      technologies: asStringArray(body.technologies),
      personLocations: asStringArray(body.personLocations),
      companyLocations: asStringArray(body.companyLocations),
    };

    const hasFilter = Object.values(filters).some(
      (value) => Array.isArray(value) && value.length > 0,
    );

    if (!hasFilter) {
      return NextResponse.json(
        { error: "Select at least one filter before searching." },
        { status: 400 },
      );
    }

    const page = Math.max(1, Number(body.page ?? 1) || 1);
    const limit = Math.min(1000, Math.max(1, Number(body.limit ?? 200) || 200));
    const result = await searchEnrichPeople(filters, { page, limit });

    return NextResponse.json({
      page: result.page,
      limit: result.limit,
      total: result.total,
      matched: result.matched,
      scanned: result.scanned,
      q: result.q,
      records: result.records,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search Data Tool";
    const status = /DATATOOL_API_KEY|not set/i.test(message) ? 503 : 500;
    console.error("CRM enrich search failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
