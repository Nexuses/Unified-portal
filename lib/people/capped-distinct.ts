import { DataRecord } from "@/lib/people/models/DataRecord";

/** Hard caps keep responses under MongoDB's 16MB distinct/BSON limits. */
export const FACET_VALUE_LIMIT = 2_000;
export const CORPUS_VALUE_LIMIT = 5_000;
export const SAMPLE_SCAN_LIMIT = 15_000;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pushUnique(
  value: unknown,
  seen: Set<string>,
  results: string[],
  limit: number
) {
  if (results.length >= limit) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      pushUnique(entry, seen, results, limit);
      if (results.length >= limit) return;
    }
  }
}

/**
 * Collect unique string values for a field without using Mongo `distinct()`,
 * which fails with "distinct too big, 16mb cap" on large people datasets.
 *
 * Strategy: scan a bounded number of matching docs and de-duplicate inside
 * Mongo, so at most `limit` values cross the wire instead of `scanLimit` docs.
 */
export async function cappedFieldValues(
  field: string,
  filter: Record<string, unknown>,
  limit = FACET_VALUE_LIMIT,
  scanLimit = SAMPLE_SCAN_LIMIT
): Promise<string[]> {
  const rows = await DataRecord.aggregate<{ value: string }>([
    { $match: { ...filter, [field]: { $exists: true, $nin: [null, ""] } } },
    { $limit: scanLimit },
    { $project: { _id: 0, value: `$${field}` } },
    { $unwind: "$value" },
    { $match: { value: { $type: "string" } } },
    { $project: { value: { $trim: { input: "$value" } } } },
    { $match: { value: { $ne: "" } } },
    { $group: { _id: { $toLower: "$value" }, value: { $first: "$value" } } },
    { $limit: limit },
    { $project: { _id: 0, value: 1 } },
  ]).option({ maxTimeMS: 12_000 });

  return rows.map((row) => row.value);
}

/**
 * Load values that match active filter terms (for synonym expansion).
 * Falls back to a capped sample when no terms are provided.
 */
export async function cappedFieldValuesForTerms(
  field: string,
  filter: Record<string, unknown>,
  terms: string[],
  limit = CORPUS_VALUE_LIMIT
): Promise<string[]> {
  const cleaned = terms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 25);

  if (cleaned.length === 0) {
    return cappedFieldValues(field, filter, Math.min(limit, FACET_VALUE_LIMIT));
  }

  const seen = new Set<string>();
  const results: string[] = [];
  const termFilter = {
    ...filter,
    $or: cleaned.map((term) => ({
      [field]: { $regex: escapeRegex(term), $options: "i" },
    })),
  };

  const rows = await DataRecord.find(termFilter)
    .select({ [field]: 1, _id: 0 })
    .limit(Math.min(limit * 3, 15_000))
    .maxTimeMS(12_000)
    .lean<Array<Record<string, unknown>>>();

  for (const row of rows) {
    pushUnique(row[field], seen, results, limit);
    if (results.length >= limit) break;
  }

  // Ensure static-friendly coverage even if term scan is sparse
  if (results.length < Math.min(200, limit)) {
    const sample = await cappedFieldValues(field, filter, Math.min(500, limit));
    for (const value of sample) {
      pushUnique(value, seen, results, limit);
      if (results.length >= limit) break;
    }
  }

  return results;
}

export function toFacetRows(values: string[]): Array<{ _id: string }> {
  return values.map((value) => ({ _id: value }));
}
