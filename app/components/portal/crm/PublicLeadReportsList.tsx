"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicReportHeader } from "@/app/components/portal/PublicReportHeader";
import { downloadCsv } from "@/lib/csv";
import {
  LEAD_REPORT_COLUMN_OPTIONS,
  visibilityFromColumnIds,
  type LeadReportColumnId,
} from "@/lib/lead-reports-columns";

type PublicLeadItem = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyName?: string;
  position?: string;
  solutions?: string[];
  leadStage?: string;
  leadStageLabel?: string;
  leadProject?: string;
  leadOwner?: string;
  leadReportAt?: string;
  lists?: Array<{ id: string; name: string }>;
};

type Bundle = {
  projectName: string;
  projectLogoUrl?: string;
  columns: LeadReportColumnId[];
  items: PublicLeadItem[];
  total: number;
  expiresAt?: string;
  error?: string;
};

function displayName(item: PublicLeadItem) {
  const name = `${item.firstName || ""} ${item.lastName || ""}`.trim();
  return name || item.email || "Unknown";
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function cellValue(item: PublicLeadItem, columnId: LeadReportColumnId) {
  switch (columnId) {
    case "lead":
      return displayName(item);
    case "email":
      return item.email || "";
    case "company":
      return item.companyName || "";
    case "position":
      return item.position || "";
    case "solution":
      return (item.solutions || []).join(", ");
    case "stage":
      return item.leadStageLabel || item.leadStage || "";
    case "date":
      return formatDate(item.leadReportAt);
    default:
      return "";
  }
}

export default function PublicLeadReportsList({
  initial,
}: {
  token?: string;
  initial: Bundle;
}) {
  const [bundle, setBundle] = useState(initial);

  useEffect(() => {
    setBundle(initial);
  }, [initial]);

  const visible = useMemo(
    () => visibilityFromColumnIds(bundle.columns),
    [bundle.columns],
  );
  const activeColumns = useMemo(
    () => LEAD_REPORT_COLUMN_OPTIONS.filter((column) => visible[column.id]),
    [visible],
  );

  function exportCsv() {
    if (!bundle.items.length || activeColumns.length === 0) return;
    downloadCsv(
      `lead-reports-${new Date().toISOString().slice(0, 10)}.csv`,
      activeColumns.map((column) => column.label),
      bundle.items.map((item) =>
        activeColumns.map((column) => cellValue(item, column.id)),
      ),
    );
  }

  const description = [
    `${bundle.total.toLocaleString()} lead${bundle.total === 1 ? "" : "s"}`,
    bundle.expiresAt ? `Link expires ${formatDate(bundle.expiresAt)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PublicReportHeader
        clientName={bundle.projectName}
        clientLogoUrl={bundle.projectLogoUrl}
        title="Lead reports"
        description={description}
      />
      <div className="public-lr-shell">
        <div className="public-lr-toolbar">
          <button
            type="button"
            className="btn-soft"
            disabled={bundle.items.length === 0}
            onClick={exportCsv}
          >
            Export CSV
          </button>
        </div>

        <div className="data-table-wrap lr-reports-table-wrap public-lr-table-wrap">
          <table className="data-table contacts-table lr-reports-table">
            <thead>
              <tr>
                {activeColumns.map((column) => (
                  <th key={column.id} className={`lr-col-${column.id}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bundle.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(activeColumns.length, 1)}
                    className="crm-empty lr-reports-empty-cell"
                  >
                    No lead reports in this share.
                  </td>
                </tr>
              ) : (
                bundle.items.map((item) => (
                  <tr key={item.id}>
                    {activeColumns.map((column) => {
                      const value = cellValue(item, column.id);
                      return (
                        <td key={column.id} className={`lr-col-${column.id}`}>
                          <span
                            className={`lr-cell-text${column.id === "date" ? " lr-date-text" : ""}`}
                            title={value || undefined}
                          >
                            {column.id === "lead" ? (
                              <strong>{value || "—"}</strong>
                            ) : (
                              value || "—"
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
