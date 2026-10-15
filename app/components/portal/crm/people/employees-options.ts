export type EmployeeRange = {
  id: string;
  label: string;
  min: number;
  max: number | null;
};

export const EMPLOYEE_RANGES: EmployeeRange[] = [
  { id: "1-10", label: "1-10", min: 1, max: 10 },
  { id: "11-20", label: "11-20", min: 11, max: 20 },
  { id: "21-50", label: "21-50", min: 21, max: 50 },
  { id: "51-100", label: "51-100", min: 51, max: 100 },
  { id: "101-200", label: "101-200", min: 101, max: 200 },
  { id: "201-500", label: "201-500", min: 201, max: 500 },
  { id: "501-1000", label: "501-1000", min: 501, max: 1000 },
  { id: "1001-2000", label: "1001-2000", min: 1001, max: 2000 },
  { id: "2001-5000", label: "2001-5000", min: 2001, max: 5000 },
  { id: "5001-10000", label: "5001-10000", min: 5001, max: 10000 },
  { id: "10001+", label: "10001+", min: 10001, max: null },
];

export function getEmployeeRangeById(id: string): EmployeeRange | undefined {
  return EMPLOYEE_RANGES.find((range) => range.id === id);
}

export function formatEmployeeCount(count: number): string {
  if (count >= 1000) {
    const thousands = count / 1000;
    if (thousands >= 10) {
      return `${Math.round(thousands)}K`;
    }
    const formatted = thousands.toFixed(1);
    return `${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted}K`;
  }
  return String(count);
}
