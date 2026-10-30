"use client";

import { useMemo, type RefObject } from "react";
import EnterpriseDataTable from "@/app/components/portal/crm/people/table/EnterpriseDataTable";
import {
  buildDataRecordColumns,
  dataRecordDetailSections,
  type DataRecordRow,
} from "@/app/components/portal/crm/people/table/data-record-columns";
import DataRecordProfileDrawer from "@/app/components/portal/crm/people/table/DataRecordProfileDrawer";
import type { ColumnFilterState } from "@/lib/people/column-filters";
import type { DataHeader } from "@/lib/people/data-headers";
import { VIEW_EMPTY_MESSAGES, VIEW_LABELS, type DataView } from "@/lib/people/data-views";
import type { SelectionMenuApplyPayload } from "@/app/components/portal/crm/people/table/SelectionMenu";

interface DataTablePanelProps {
  view: DataView;
  loading: boolean;
  refreshing?: boolean;
  records: DataRecordRow[];
  tableColumns: readonly DataHeader[];
  search: string;
  hasActiveFilters?: boolean;
  selectedIds: Set<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
  onExportSelected?: (ids: string[]) => void | Promise<void>;
  exporting?: boolean;
  onDeleteSelected?: (ids: string[]) => void | Promise<void>;
  deleting?: boolean;
  columnFilters: ColumnFilterState;
  onColumnFiltersChange: (next: ColumnFilterState) => void;
  fillHeight?: boolean;
  storageKey?: string;
  listOptions?: Array<{ id: string; name: string; recordCount: number }>;
  listsLoading?: boolean;
  listActionBusy?: boolean;
  onAddToList?: (listId: string, ids: string[]) => void | Promise<void>;
  onCreateList?: (name: string, ids: string[]) => void | Promise<void>;
  onSaveToList?: () => void;
  saveToListBusy?: boolean;
  totalMatching?: number;
  selectingMatching?: boolean;
  onApplySelectionMenu?: (payload: SelectionMenuApplyPayload) => void | Promise<void>;
  /** Center the bulk selection bar over this element (content column, not sidebar). */
  contentAnchorRef?: RefObject<HTMLElement | null>;
}

export default function DataTablePanel({
  view,
  loading,
  refreshing = false,
  records,
  tableColumns,
  search,
  hasActiveFilters = false,
  selectedIds,
  onSelectedIdsChange,
  onExportSelected,
  exporting = false,
  onDeleteSelected,
  deleting = false,
  columnFilters,
  onColumnFiltersChange,
  fillHeight = false,
  storageKey,
  listOptions,
  listsLoading = false,
  listActionBusy = false,
  onAddToList,
  onCreateList,
  onSaveToList,
  saveToListBusy = false,
  totalMatching = 0,
  selectingMatching = false,
  onApplySelectionMenu,
  contentAnchorRef,
}: DataTablePanelProps) {
  const columns = useMemo(
    () => buildDataRecordColumns(tableColumns),
    [tableColumns]
  );

  const emptyMessage = search
    ? `No ${VIEW_LABELS[view].toLowerCase()} match your search.`
    : hasActiveFilters
      ? `No ${VIEW_LABELS[view].toLowerCase()} match your filters.`
      : VIEW_EMPTY_MESSAGES[view];

  return (
    <EnterpriseDataTable
      data={records}
      columns={columns}
      storageKey={storageKey ?? `data-browser-${view}`}
      loading={loading}
      refreshing={refreshing}
      emptyMessage={emptyMessage}
      selectedIds={selectedIds}
      onSelectedIdsChange={onSelectedIdsChange}
      onExportSelected={onExportSelected}
      exporting={exporting}
      enableRowExport={Boolean(onExportSelected)}
      enableColumnFilters
      onDeleteSelected={onDeleteSelected}
      deleting={deleting}
      columnFilters={columnFilters}
      onColumnFiltersChange={onColumnFiltersChange}
      columnFilterMode="server"
      bulkActions={{
        enableExport: Boolean(onExportSelected),
        getEmail: (row) => row.email ?? "",
        getPhone: (row) => row.personal_phone || row.company_phone || "",
        getCompany: (row) => row.company_name ?? "",
      }}
      getDetailTitle={(row) => {
        const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
        return name || row.company_name || row.id;
      }}
      getDetailSubtitle={(row) =>
        [row.title, row.company_name].filter(Boolean).join(" · ")
      }
      getDetailSections={dataRecordDetailSections}
      renderDetail={({
        row,
        kind,
        onClose,
        onExport,
        exporting: detailExporting,
        openPerson,
        openCompany,
      }) => (
        <DataRecordProfileDrawer
          open
          row={row}
          kind={
            kind === "company" || (!row.first_name && !row.last_name && row.company_name)
              ? "company"
              : kind
          }
          onClose={onClose}
          onExport={onExport}
          exporting={detailExporting}
          onOpenPerson={openPerson}
          onOpenCompany={openCompany}
        />
      )}
      fillHeight={fillHeight}
      listOptions={listOptions}
      listsLoading={listsLoading}
      listActionBusy={listActionBusy}
      onAddToList={onAddToList}
      onCreateList={onCreateList}
      onSaveToList={onSaveToList}
      saveToListBusy={saveToListBusy}
      contentAnchorRef={contentAnchorRef}
      selectionMenu={
        onApplySelectionMenu
          ? {
              totalMatching,
              entityLabel: VIEW_LABELS[view].toLowerCase(),
              showMaxPerCompany: view === "people",
              selecting: selectingMatching,
              onApply: onApplySelectionMenu,
            }
          : undefined
      }
    />
  );
}
