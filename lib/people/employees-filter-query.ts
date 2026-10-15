import {
  EMPLOYEE_RANGES,
  getEmployeeRangeById,
  type EmployeeRange,
} from "@/app/components/portal/crm/people/employees-options";
import type { EmployeesFilter } from "@/lib/people/data-browser/types";

export type EmployeesFilterPayload = EmployeesFilter;

function employeeNumericCountExpr() {
  return {
    $convert: {
      input: {
        $replaceAll: {
          input: { $ifNull: ["$employees", ""] },
          find: ",",
          replacement: "",
        },
      },
      to: "int",
      onError: 0,
      onNull: 0,
    },
  };
}

function employeeRangeMaxExpr() {
  const cleaned = {
    $replaceAll: {
      input: { $ifNull: ["$employees", ""] },
      find: ",",
      replacement: "",
    },
  };

  return {
    $let: {
      vars: { cleaned },
      in: {
        $cond: [
          {
            $regexMatch: {
              input: "$$cleaned",
              regex: "^\\d+\\s*-\\s*\\d+$",
            },
          },
          {
            $convert: {
              input: {
                $trim: {
                  input: {
                    $arrayElemAt: [{ $split: ["$$cleaned", "-"] }, 1],
                  },
                },
              },
              to: "int",
              onError: 0,
              onNull: 0,
            },
          },
          employeeNumericCountExpr(),
        ],
      },
    },
  };
}

function buildRangeBounds(min: number, max: number | null) {
  const employeeCount = employeeRangeMaxExpr();
  const bounds: Record<string, unknown>[] = [{ $gte: [employeeCount, min] }];
  if (max !== null) {
    bounds.push({ $lte: [employeeCount, max] });
  }
  return bounds.length === 1 ? bounds[0] : { $and: bounds };
}

function buildExactRangeLabelQuery(range: EmployeeRange) {
  const label = range.label.replace("+", "\\+");
  return {
    employees: { $regex: `^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, $options: "i" },
  };
}

export function buildEmployeeRangeQuery(range: EmployeeRange) {
  return {
    $or: [{ $expr: buildRangeBounds(range.min, range.max) }, buildExactRangeLabelQuery(range)],
  };
}

function buildPredefinedRangesQuery(rangeIds: string[]) {
  const queries = rangeIds
    .map((id) => getEmployeeRangeById(id))
    .filter((range): range is EmployeeRange => Boolean(range))
    .map((range) => buildEmployeeRangeQuery(range));

  if (queries.length === 0) return null;
  return queries.length === 1 ? queries[0] : { $or: queries };
}

function buildCustomRangeQuery(min: string, max: string) {
  const minValue = min.trim() ? Number(min.trim()) : null;
  const maxValue = max.trim() ? Number(max.trim()) : null;

  if (minValue === null && maxValue === null) return null;
  if (minValue !== null && Number.isNaN(minValue)) return null;
  if (maxValue !== null && Number.isNaN(maxValue)) return null;

  const employeeCount = employeeRangeMaxExpr();
  const bounds: Record<string, unknown>[] = [];

  if (minValue !== null) {
    bounds.push({ $gte: [employeeCount, minValue] });
  }
  if (maxValue !== null) {
    bounds.push({ $lte: [employeeCount, maxValue] });
  }

  if (bounds.length === 0) return null;
  return { $expr: bounds.length === 1 ? bounds[0] : { $and: bounds } };
}

export function buildEmployeesFilterQuery(filter: EmployeesFilter) {
  if (filter.mode === "custom") {
    const customQuery = buildCustomRangeQuery(filter.customMin, filter.customMax);
    return customQuery ?? {};
  }

  const predefinedQuery = buildPredefinedRangesQuery(filter.predefinedRanges);
  return predefinedQuery ?? {};
}

export { EMPLOYEE_RANGES };
