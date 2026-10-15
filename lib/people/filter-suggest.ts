import { recordTypeFilter, type DataView } from "@/lib/people/data-views";
import {
  FILTER_SUGGEST_FIELDS,
  type FilterSuggestField,
} from "@/lib/people/filter-suggest-fields";
import { DataRecord } from "@/lib/people/models/DataRecord";

export { FILTER_SUGGEST_FIELDS, type FilterSuggestField };

const EXTRA_FIELDS: Partial<Record<FilterSuggestField, string[]>> = {
  contactLocation: ["company_address", "company_country"],
  accountHq: ["company_address"],
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueTrimmed(values: unknown[], limit: number) {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(trimmed);
    if (results.length >= limit) break;
  }

  return results;
}

export async function suggestFilterValues(
  field: FilterSuggestField,
  query: string,
  view: DataView,
  limit = 30
): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const primary = FILTER_SUGGEST_FIELDS[field];
  const extras = EXTRA_FIELDS[field] ?? [];
  const fields = [primary, ...extras];
  const regex = { $regex: escapeRegex(trimmed), $options: "i" };

  const rows = await DataRecord.find({
    ...recordTypeFilter(view),
    $or: fields.map((name) => ({ [name]: regex })),
  })
    .select(Object.fromEntries(fields.map((name) => [name, 1])))
    .limit(Math.max(limit * 4, 80))
    .maxTimeMS(2500)
    .lean<Array<Record<string, string>>>();

  const ranked: string[] = [];
  const rest: string[] = [];
  const needle = trimmed.toLowerCase();

  for (const row of rows) {
    for (const name of fields) {
      const value = row[name];
      if (typeof value !== "string" || !value.trim()) continue;
      if (value.toLowerCase().startsWith(needle)) {
        ranked.push(value);
      } else if (value.toLowerCase().includes(needle)) {
        rest.push(value);
      }
    }
  }

  return uniqueTrimmed([...ranked, ...rest], limit);
}
