import type { ReactNode } from "react";

export type RowDensity = "compact" | "comfortable" | "spacious";

export type EnterpriseColumnMeta = {
  copyKind?: "id" | "email" | "phone" | "company";
  pinDefault?: "left" | "right";
  noTruncate?: boolean;
  /** Clicking this cell opens the row detail drawer. */
  openDetailOnClick?: boolean;
  /** Which profile to open when the cell is clicked. */
  detailKind?: "person" | "company";
};

export type EnterpriseColumn<T> = {
  id: string;
  header: string;
  accessorFn: (row: T) => string;
  cell?: (row: T, value: string) => ReactNode;
  enableSorting?: boolean;
  enableHiding?: boolean;
  size?: number;
  minSize?: number;
  maxSize?: number;
  meta?: EnterpriseColumnMeta;
};

export type DetailSection = {
  title: string;
  fields: Array<{ label: string; value: string }>;
};

export type BulkActionConfig<T> = {
  enableExport?: boolean;
  getEmail?: (row: T) => string;
  getPhone?: (row: T) => string;
  getCompany?: (row: T) => string;
};

export type SavedTableLayout = {
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  columnSizing: Record<string, number>;
  columnPinning: { left?: string[]; right?: string[] };
  density: RowDensity;
};

export const DENSITY_PADDING: Record<RowDensity, string> = {
  compact: "py-1.5",
  comfortable: "py-3",
  spacious: "py-4",
};

export const DENSITY_ROW_HEIGHT: Record<RowDensity, number> = {
  compact: 36,
  comfortable: 48,
  spacious: 56,
};
