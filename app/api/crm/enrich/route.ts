import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { EnrichSearchFilters } from "@/lib/datatool";
import { searchEnrichPeople } from "@/lib/datatool-server";
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
    const result = await searchEnrichPeople(filters, {
      page,
      limit,
      exclude: {
        projectId: new ObjectId(session.projectId),
        unsubscribed: body.excludeUnsubscribed === true,
        existing: body.excludeExisting === true,
      },
    });

    const maxResults = Math.min(
      1000,
      Math.max(1, Number(body.maxResults ?? 1000) || 1000),
    );
    const allowedOnPage = Math.max(0, maxResults - (page - 1) * limit);
    const records = result.records.slice(0, allowedOnPage);

    return NextResponse.json({
      page: result.page,
      limit: result.limit,
      total: Math.min(result.total, maxResults),
      available: result.total,
      matched: records.length,
      scanned: result.scanned,
      removedUnsubscribed: result.removedUnsubscribed,
      removedExisting: result.removedExisting,
      records,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search the Enrich database";
    const status = /not set/i.test(message) ? 503 : 500;
    console.error("CRM enrich search failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
