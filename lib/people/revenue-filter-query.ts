import type { RevenueFilter } from "@/lib/people/data-browser/types";
import {
  parseRevenueBounds,
  parseUserRevenueAmount,
  rangesOverlap,
} from "@/app/components/portal/crm/people/revenue-options";

export type RevenueFilterPayload = RevenueFilter;

function buildKnownRevenueQuery() {
  return { annual_revenue: { $exists: true, $regex: /\S/ } };
}

function buildUnknownRevenueQuery() {
  return {
    $or: [
      { annual_revenue: { $exists: false } },
      { annual_revenue: "" },
      { annual_revenue: { $regex: /^\s*$/ } },
    ],
  };
}

export function revenueValuesMatchingBetween(
  values: string[],
  min: string,
  max: string
): string[] {
  const userMin = min.trim() ? parseUserRevenueAmount(min.trim()) : null;
  const userMax = max.trim() ? parseUserRevenueAmount(max.trim()) : null;
  if (userMin === null && userMax === null) return [];

  const effectiveMin = userMin ?? 0;
  const effectiveMax = userMax ?? Number.POSITIVE_INFINITY;

  return values.filter((value) => {
    const bounds = parseRevenueBounds(value);
    if (!bounds) return false;
    return rangesOverlap(bounds.min, bounds.max, effectiveMin, effectiveMax);
  });
}

function buildBetweenRevenueQuery(min: string, max: string, distinctValues: string[]) {
  const matching = revenueValuesMatchingBetween(distinctValues, min, max);
  if (matching.length === 0) {
    return { annual_revenue: { $in: ["__no_match__"] } };
  }
  return { annual_revenue: { $in: matching } };
}

export function buildRevenueFilterQuery(filter: RevenueFilter, distinctRevenueValues: string[]) {
  const andFilters: Record<string, unknown>[] = [];

  if (filter.mode === "is_known") {
    andFilters.push(buildKnownRevenueQuery());
  } else if (filter.mode === "is_unknown") {
    andFilters.push(buildUnknownRevenueQuery());
  } else if (filter.min.trim() || filter.max.trim()) {
    andFilters.push(buildBetweenRevenueQuery(filter.min, filter.max, distinctRevenueValues));
  }

  if (andFilters.length === 0) return {};
  return andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
}

export function recordMatchesRevenueFilter(value: string, filter: RevenueFilter): boolean {
  const trimmed = value.trim();

  if (filter.mode === "is_known") {
    return trimmed.length > 0;
  }
  if (filter.mode === "is_unknown") {
    return trimmed.length === 0;
  }

  if (!filter.min.trim() && !filter.max.trim()) {
    return true;
  }

  const bounds = parseRevenueBounds(trimmed);
  if (!bounds) return false;

  const userMin = filter.min.trim() ? parseUserRevenueAmount(filter.min) : null;
  const userMax = filter.max.trim() ? parseUserRevenueAmount(filter.max) : null;
  const effectiveMin = userMin ?? 0;
  const effectiveMax = userMax ?? Number.POSITIVE_INFINITY;
  return rangesOverlap(bounds.min, bounds.max, effectiveMin, effectiveMax);
}
