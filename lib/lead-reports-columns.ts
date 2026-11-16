export const LEAD_REPORT_COLUMN_OPTIONS = [
  { id: "lead", label: "Lead", locked: true },
  { id: "email", label: "Email" },
  { id: "company", label: "Company" },
  { id: "position", label: "Position" },
  { id: "solution", label: "Solution" },
  { id: "stage", label: "Stage" },
  { id: "date", label: "Date" },
] as const;

export type LeadReportColumnId = (typeof LEAD_REPORT_COLUMN_OPTIONS)[number]["id"];

export type LeadReportColumnVisibility = Record<LeadReportColumnId, boolean>;

const ALL_COLUMN_IDS = LEAD_REPORT_COLUMN_OPTIONS.map((column) => column.id);

export function defaultLeadReportColumnVisibility(): LeadReportColumnVisibility {
  return {
    lead: true,
    email: true,
    company: true,
    position: true,
    solution: true,
    stage: true,
    date: true,
  };
}

export function visibilityFromColumnIds(
  columns: readonly string[] | null | undefined,
): LeadReportColumnVisibility {
  const defaults = defaultLeadReportColumnVisibility();
  if (!columns || columns.length === 0) {
    return defaults;
  }
  const allowed = new Set(
    columns.filter((id): id is LeadReportColumnId =>
      (ALL_COLUMN_IDS as readonly string[]).includes(id),
    ),
  );
  const next = { ...defaults };
  for (const id of ALL_COLUMN_IDS) {
    next[id] = id === "lead" ? true : allowed.has(id);
  }
  return next;
}

export function normalizeLeadReportColumns(
  columns: readonly string[] | null | undefined,
): LeadReportColumnId[] {
  const visibility = visibilityFromColumnIds(columns);
  return LEAD_REPORT_COLUMN_OPTIONS.filter((column) => visibility[column.id]).map(
    (column) => column.id,
  );
}

export function columnIdsFromVisibility(
  visibility: LeadReportColumnVisibility,
): LeadReportColumnId[] {
  return LEAD_REPORT_COLUMN_OPTIONS.filter((column) => visibility[column.id]).map(
    (column) => column.id,
  );
}
