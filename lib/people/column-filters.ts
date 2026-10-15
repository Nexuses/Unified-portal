import { DATA_HEADERS, type DataHeader } from "@/lib/people/data-headers";

export type ColumnFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "starts_with"
  | "is_empty"
  | "is_not_empty";

export type ColumnFilterLogic = "and" | "or";

export type ColumnFilterRule = {
  id: string;
  columnId: string;
  operator: ColumnFilterOperator;
  value: string;
};

export type ColumnFilterState = {
  logic: ColumnFilterLogic;
  rules: ColumnFilterRule[];
};

export const EMPTY_COLUMN_FILTER_STATE: ColumnFilterState = {
  logic: "and",
  rules: [],
};

export const COLUMN_FILTER_OPERATORS: Array<{
  value: ColumnFilterOperator;
  label: string;
  needsValue: boolean;
}> = [
  { value: "contains", label: "Contains", needsValue: true },
  { value: "not_contains", label: "Does not contain", needsValue: true },
  { value: "equals", label: "Equals", needsValue: true },
  { value: "starts_with", label: "Starts with", needsValue: true },
  { value: "is_empty", label: "Is empty", needsValue: false },
  { value: "is_not_empty", label: "Is not empty", needsValue: false },
];

const DATA_HEADER_SET = new Set<string>(DATA_HEADERS);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createColumnFilterRule(
  columnId: string,
  operator: ColumnFilterOperator = "contains",
  value = ""
): ColumnFilterRule {
  return {
    id: `${columnId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    columnId,
    operator,
    value,
  };
}

export function isColumnFilterStateEmpty(state: ColumnFilterState | null | undefined) {
  return !state || state.rules.length === 0;
}

export function operatorNeedsValue(operator: ColumnFilterOperator) {
  return COLUMN_FILTER_OPERATORS.find((entry) => entry.value === operator)?.needsValue ?? true;
}

export function isValidDataField(columnId: string): columnId is DataHeader {
  return DATA_HEADER_SET.has(columnId);
}

export function parseColumnFilterState(raw: string | null): ColumnFilterState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const logic = parsed.logic === "or" ? "or" : "and";
    const rulesRaw = Array.isArray(parsed.rules) ? parsed.rules : [];
    const rules: ColumnFilterRule[] = [];

    for (const entry of rulesRaw) {
      if (!entry || typeof entry !== "object") continue;
      const rule = entry as Record<string, unknown>;
      const columnId = typeof rule.columnId === "string" ? rule.columnId.trim() : "";
      const operator = rule.operator as ColumnFilterOperator;
      const value = typeof rule.value === "string" ? rule.value : "";
      const id =
        typeof rule.id === "string" && rule.id
          ? rule.id
          : createColumnFilterRule(columnId, operator, value).id;

      if (!columnId) continue;
      if (!COLUMN_FILTER_OPERATORS.some((op) => op.value === operator)) continue;
      if (operatorNeedsValue(operator) && !value.trim()) continue;

      rules.push({ id, columnId, operator, value });
    }

    if (rules.length === 0) return null;
    return { logic, rules };
  } catch {
    return null;
  }
}

function ruleToMongoQuery(rule: ColumnFilterRule): Record<string, unknown> | null {
  if (!isValidDataField(rule.columnId)) return null;
  const field = rule.columnId;
  const value = rule.value.trim();

  switch (rule.operator) {
    case "contains":
      if (!value) return null;
      return { [field]: { $regex: escapeRegex(value), $options: "i" } };
    case "not_contains":
      if (!value) return null;
      return { [field]: { $not: { $regex: escapeRegex(value), $options: "i" } } };
    case "equals":
      if (!value) return null;
      return { [field]: { $regex: `^${escapeRegex(value)}$`, $options: "i" } };
    case "starts_with":
      if (!value) return null;
      return { [field]: { $regex: `^${escapeRegex(value)}`, $options: "i" } };
    case "is_empty":
      return {
        $or: [
          { [field]: { $exists: false } },
          { [field]: null },
          { [field]: "" },
        ],
      };
    case "is_not_empty":
      return {
        $and: [
          { [field]: { $exists: true } },
          { [field]: { $nin: [null, ""] } },
        ],
      };
    default:
      return null;
  }
}

/** Additive Mongo clause — AND with existing sidebar filters. */
export function buildColumnFiltersQuery(
  state: ColumnFilterState | null | undefined
): Record<string, unknown> {
  if (!state || state.rules.length === 0) return {};

  const queries = state.rules
    .map((rule) => ruleToMongoQuery(rule))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  if (queries.length === 0) return {};
  if (queries.length === 1) return queries[0];
  return state.logic === "or" ? { $or: queries } : { $and: queries };
}

export function matchesColumnFilterRule(
  cellValue: string,
  rule: ColumnFilterRule
): boolean {
  const value = cellValue ?? "";
  const needle = rule.value.trim().toLowerCase();
  const haystack = value.toLowerCase();

  switch (rule.operator) {
    case "contains":
      return needle ? haystack.includes(needle) : true;
    case "not_contains":
      return needle ? !haystack.includes(needle) : true;
    case "equals":
      return needle ? haystack === needle : true;
    case "starts_with":
      return needle ? haystack.startsWith(needle) : true;
    case "is_empty":
      return value.trim().length === 0;
    case "is_not_empty":
      return value.trim().length > 0;
    default:
      return true;
  }
}

export function matchesColumnFilters(
  getCellValue: (columnId: string) => string,
  state: ColumnFilterState | null | undefined
): boolean {
  if (!state || state.rules.length === 0) return true;
  const results = state.rules.map((rule) =>
    matchesColumnFilterRule(getCellValue(rule.columnId), rule)
  );
  return state.logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

export function columnFilterRuleLabel(
  rule: ColumnFilterRule,
  columnHeader?: string
): string {
  const col = columnHeader || rule.columnId;
  const op =
    COLUMN_FILTER_OPERATORS.find((entry) => entry.value === rule.operator)?.label ??
    rule.operator;
  if (!operatorNeedsValue(rule.operator)) {
    return `${col} ${op.toLowerCase()}`;
  }
  return `${col} ${op.toLowerCase()} "${rule.value}"`;
}
