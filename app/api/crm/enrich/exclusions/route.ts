import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { EnrichSearchFilters } from "@/lib/datatool";
import { countEnrichExclusions } from "@/lib/datatool-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
    const maxResults = Math.min(1000, Math.max(1, Number(body.maxResults ?? 1000) || 1000));
    const counts = await countEnrichExclusions(
      filters,
      new ObjectId(session.projectId),
      maxResults,
    );
    return NextResponse.json(counts);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to count exclusions";
    console.error("CRM enrich exclusion count failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
