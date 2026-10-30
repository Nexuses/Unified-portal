"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Columns3,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  MoreHorizontal,
  Pin,
  PinOff,
  Rows3,
  SearchX,
} from "lucide-react";
import {
  EMPTY_COLUMN_FILTER_STATE,
  createColumnFilterRule,
  matchesColumnFilters,
  type ColumnFilterRule,
  type ColumnFilterState,
} from "@/lib/people/column-filters";
import BulkToolbar from "./BulkToolbar";
import ColumnFiltersBar, { ColumnFilterEditor } from "./ColumnFiltersBar";
import RecordDrawer from "./RecordDrawer";
import SelectionMenu, {
  type SelectionMenuApplyPayload,
} from "./SelectionMenu";
import {
  clearTableLayout,
  defaultDensity,
  loadTableLayout,
  saveTableLayout,
} from "./layout-storage";
import {
  DENSITY_PADDING,
  DENSITY_ROW_HEIGHT,
  type BulkActionConfig,
  type DetailSection,
  type EnterpriseColumn,
  type RowDensity,
} from "./types";

async function copyText(value: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // ignore
  }
}

type ContextMenuState = {
  x: number;
  y: number;
  rowId: string;
  cellValue: string;
  rowValues: string;
};

type EnterpriseDataTableProps<T extends { id: string }> = {
  data: T[];
  columns: EnterpriseColumn<T>[];
  storageKey: string;
  loading?: boolean;
  /** Soft refresh — keep showing current rows instead of a blank loading state */
  refreshing?: boolean;
  emptyMessage?: string;
  selectedIds: Set<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
  onExportSelected?: (ids: string[]) => void | Promise<void>;
  exporting?: boolean;
  onDeleteSelected?: (ids: string[]) => void | Promise<void>;
  deleting?: boolean;
  bulkActions?: BulkActionConfig<T>;
  getDetailTitle?: (row: T) => string;
  getDetailSubtitle?: (row: T) => string;
  getDetailSections?: (row: T) => DetailSection[];
  /** When provided, replaces the default sections drawer (e.g. Apollo-style profiles). */
  renderDetail?: (args: {
    row: T;
    kind: "person" | "company";
    onClose: () => void;
    onExport?: () => void;
    exporting?: boolean;
    openPerson: (row: T) => void;
    openCompany: (row: T) => void;
  }) => ReactNode;
  enableRowExport?: boolean;
  rowExportLabel?: string;
  canRowExport?: (row: T) => boolean;
  toolbarSlot?: ReactNode;
  enableColumnFilters?: boolean;
  columnFilters?: ColumnFilterState;
  onColumnFiltersChange?: (next: ColumnFilterState) => void;
  /** "server" = parent already filtered data. "client" = filter in-table. Default: server if onColumnFiltersChange provided, else client */
  columnFilterMode?: "server" | "client";
  /** Fill parent height and scroll internally (used next to filter sidebar). */
  fillHeight?: boolean;
  listOptions?: Array<{ id: string; name: string; recordCount: number }>;
  listsLoading?: boolean;
  listActionBusy?: boolean;
  onAddToList?: (listId: string, ids: string[]) => void | Promise<void>;
  onCreateList?: (name: string, ids: string[]) => void | Promise<void>;
  onSaveToList?: () => void;
  saveToListBusy?: boolean;
  selectionMenu?: {
    totalMatching: number;
    entityLabel: string;
    showMaxPerCompany?: boolean;
    selecting?: boolean;
    onApply: (payload: SelectionMenuApplyPayload) => void | Promise<void>;
  };
  /** Center the bulk selection bar over this element (content column). Falls back to the table root. */
  contentAnchorRef?: RefObject<HTMLElement | null>;
};

export default function EnterpriseDataTable<T extends { id: string }>({
  data,
  columns,
  storageKey,
  loading = false,
  refreshing = false,
  emptyMessage = "No records found.",
  selectedIds,
  onSelectedIdsChange,
  onExportSelected,
  exporting = false,
  onDeleteSelected,
  deleting = false,
  bulkActions,
  getDetailTitle,
  getDetailSubtitle,
  getDetailSections,
  renderDetail,
  enableRowExport = false,
  rowExportLabel = "Export this record",
  canRowExport,
  toolbarSlot,
  enableColumnFilters = false,
  columnFilters,
  onColumnFiltersChange,
  columnFilterMode,
  fillHeight = false,
  listOptions,
  listsLoading = false,
  listActionBusy = false,
  onAddToList,
  onCreateList,
  onSaveToList,
  saveToListBusy = false,
  selectionMenu,
  contentAnchorRef,
}: EnterpriseDataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => [
    "select",
    ...columns.map((c) => c.id),
  ]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: ["select"],
    right: [],
  });
  const [density, setDensity] = useState<RowDensity>(defaultDensity);
  const [layoutReady, setLayoutReady] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [columnMenuPos, setColumnMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [headerMenuId, setHeaderMenuId] = useState<string | null>(null);
  const [filterEditorColumnId, setFilterEditorColumnId] = useState<string | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailState, setDetailState] = useState<{
    id: string;
    kind: "person" | "company";
    row?: T;
  } | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [copiedFlash, setCopiedFlash] = useState("");
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [internalColumnFilters, setInternalColumnFilters] =
    useState<ColumnFilterState>(EMPTY_COLUMN_FILTER_STATE);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const columnMenuPanelRef = useRef<HTMLDivElement>(null);
  const columnMenuButtonRef = useRef<HTMLButtonElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const selectionAnchorRef = useRef<HTMLInputElement>(null);
  const tableRootRef = useRef<HTMLDivElement>(null);

  const filterState = columnFilters ?? internalColumnFilters;

  const setFilterState = useCallback(
    (next: ColumnFilterState) => {
      onColumnFiltersChange?.(next);
      if (columnFilters === undefined) {
        setInternalColumnFilters(next);
      }
    },
    [columnFilters, onColumnFiltersChange]
  );

  const resolvedFilterMode =
    columnFilterMode ?? (onColumnFiltersChange ? "server" : "client");

  const columnLabels = useMemo(() => {
    const map: Record<string, string> = {};
    columns.forEach((column) => {
      map[column.id] = column.header;
    });
    return map;
  }, [columns]);

  const accessorById = useMemo(() => {
    const map = new Map<string, (row: T) => string>();
    columns.forEach((column) => {
      map.set(column.id, column.accessorFn);
    });
    return map;
  }, [columns]);

  const tableData = useMemo(() => {
    if (!enableColumnFilters || resolvedFilterMode === "server") {
      return data;
    }
    return data.filter((row) =>
      matchesColumnFilters((columnId) => {
        const accessor = accessorById.get(columnId);
        return accessor ? String(accessor(row) ?? "") : "";
      }, filterState)
    );
  }, [
    enableColumnFilters,
    resolvedFilterMode,
    data,
    accessorById,
    filterState,
  ]);

  useEffect(() => {
    const saved = loadTableLayout(storageKey);
    if (saved) {
      if (saved.columnVisibility) setColumnVisibility(saved.columnVisibility);
      if (saved.columnOrder?.length) setColumnOrder(saved.columnOrder);
      if (saved.columnSizing) setColumnSizing(saved.columnSizing);
      if (saved.columnPinning) setColumnPinning(saved.columnPinning);
      if (saved.density) setDensity(saved.density);
    }
    setLayoutReady(true);
  }, [storageKey]);

  const rowById = useMemo(() => {
    const map = new Map<string, T>();
    data.forEach((row) => map.set(row.id, row));
    return map;
  }, [data]);

  const detailRow = detailState
    ? detailState.row ?? rowById.get(detailState.id) ?? null
    : null;

  useEffect(() => {
    if (!layoutReady) return;
    saveTableLayout(storageKey, {
      columnOrder,
      columnVisibility,
      columnSizing,
      columnPinning,
      density,
    });
  }, [
    layoutReady,
    storageKey,
    columnOrder,
    columnVisibility,
    columnSizing,
    columnPinning,
    density,
  ]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        !target.closest("[data-header-menu]") &&
        !target.closest("[data-header-menu-trigger]")
      ) {
        setHeaderMenuId(null);
      }
      if (!target.closest("[data-column-filter-editor]")) {
        setFilterEditorColumnId(null);
      }
      const inTrigger = columnMenuRef.current?.contains(target);
      const inPanel = columnMenuPanelRef.current?.contains(target);
      if (!inTrigger && !inPanel) {
        setShowColumnMenu(false);
      }
      if (!target.closest("[data-context-menu]")) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useLayoutEffect(() => {
    if (!showColumnMenu) {
      setColumnMenuPos(null);
      return;
    }

    function updatePosition() {
      const button = columnMenuButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 224; // w-56
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - menuWidth - 8
      );
      setColumnMenuPos({
        top: rect.bottom + 4,
        left,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showColumnMenu]);

  const flashCopied = useCallback((label: string) => {
    setCopiedFlash(label);
    window.setTimeout(() => setCopiedFlash(""), 1500);
  }, []);

  const upsertColumnFilter = useCallback(
    (rule: ColumnFilterRule) => {
      setFilterState({
        ...filterState,
        rules: [
          ...filterState.rules.filter((r) => r.columnId !== rule.columnId),
          rule.id
            ? rule
            : createColumnFilterRule(rule.columnId, rule.operator, rule.value),
        ],
      });
    },
    [filterState, setFilterState]
  );

  const columnDefs = useMemo<ColumnDef<T, string>[]>(() => {
    const selectCol: ColumnDef<T, string> = {
      id: "select",
      size: 44,
      minSize: 44,
      maxSize: 44,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      header: ({ table }) => {
        const rows = table.getRowModel().rows;
        const allSelected =
          rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
        const someSelected = rows.some((row) => selectedIds.has(row.id));

        if (!selectionMenu) {
          return (
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={() => {
                const next = new Set(selectedIds);
                if (allSelected) {
                  rows.forEach((row) => next.delete(row.id));
                } else {
                  rows.forEach((row) => next.add(row.id));
                }
                onSelectedIdsChange(next);
              }}
              aria-label="Select all rows on page"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          );
        }

        return (
          <div className="relative flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <input
              ref={(el) => {
                selectionAnchorRef.current = el;
                if (el) {
                  el.indeterminate =
                    !selectionMenuOpen && someSelected && !allSelected;
                }
              }}
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelectionMenuOpen((open) => !open)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Open selection options"
              aria-haspopup="dialog"
              aria-expanded={selectionMenuOpen}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
        );
      },
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => {
            const next = new Set(selectedIds);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            onSelectedIdsChange(next);
          }}
          aria-label={`Select row ${row.id}`}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          onClick={(e) => e.stopPropagation()}
        />
      ),
    };

    const dataCols: ColumnDef<T, string>[] = columns.map((column) => ({
      id: column.id,
      accessorFn: column.accessorFn,
      header: column.header,
      size: column.size ?? 160,
      minSize: column.minSize ?? 80,
      maxSize: column.maxSize ?? 480,
      enableSorting: column.enableSorting !== false,
      enableHiding: column.enableHiding !== false,
      cell: ({ row, getValue }) => {
        const value = String(getValue() ?? "");
        if (column.cell) return column.cell(row.original, value);
        return value || "—";
      },
      meta: column.meta,
    }));

    return [selectCol, ...dataCols];
  }, [
    columns,
    onSelectedIdsChange,
    selectedIds,
    selectionMenu,
    selectionMenuOpen,
  ]);

  const table = useReactTable({
    data: tableData,
    columns: columnDefs,
    state: {
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
      columnPinning,
    },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    onColumnPinningChange: setColumnPinning,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    defaultColumn: {
      minSize: 60,
      maxSize: 800,
      size: 160,
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => DENSITY_ROW_HEIGHT[density],
    overscan: 16,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const selectedRows = useMemo(
    () => data.filter((row) => selectedIds.has(row.id)),
    [data, selectedIds]
  );

  function resetLayout() {
    clearTableLayout(storageKey);
    setColumnVisibility({});
    setColumnOrder(["select", ...columns.map((c) => c.id)]);
    setColumnSizing({});
    setColumnPinning({ left: ["select"], right: [] });
    setDensity(defaultDensity());
    setSorting([]);
  }

  function getPinStyles(
    columnId: string,
    options?: { backgroundColor?: string; isHeader?: boolean }
  ): CSSProperties {
    const column = table.getColumn(columnId);
    if (!column) return {};
    const pinned = column.getIsPinned();
    if (!pinned) return {};

    const isLeft = pinned === "left";
    const backgroundColor =
      options?.backgroundColor ??
      (options?.isHeader ? "rgb(248 250 252)" : "rgb(255 255 255)");
    const isEdge =
      (isLeft && column.getIsLastColumn("left")) ||
      (pinned === "right" && column.getIsFirstColumn("right"));

    return {
      position: "sticky",
      left: isLeft ? `${column.getStart("left")}px` : undefined,
      right: pinned === "right" ? `${column.getAfter("right")}px` : undefined,
      zIndex: options?.isHeader ? 40 : 21,
      backgroundColor,
      backgroundClip: "padding-box",
      boxShadow: isEdge
        ? isLeft
          ? "inset -1px 0 0 rgb(226 232 240), 2px 0 6px -2px rgba(15, 23, 42, 0.1)"
          : "inset 1px 0 0 rgb(226 232 240), -2px 0 6px -2px rgba(15, 23, 42, 0.1)"
        : isLeft
          ? "inset -1px 0 0 rgb(226 232 240)"
          : "inset 1px 0 0 rgb(226 232 240)",
    };
  }

  const padY = DENSITY_PADDING[density];
  const colSpan = Math.max(table.getVisibleLeafColumns().length, 1);

  return (
    <div
      ref={tableRootRef}
      className={`relative min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ${
        fillHeight ? "flex h-full flex-1 flex-col" : "flex-1"
      }`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-linear-to-b from-slate-50/70 to-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" ref={columnMenuRef}>
            <button
              ref={columnMenuButtonRef}
              type="button"
              onClick={() => setShowColumnMenu((v) => !v)}
              aria-expanded={showColumnMenu}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </button>
            {showColumnMenu && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={columnMenuPanelRef}
                    role="menu"
                    aria-label="Toggle columns"
                    data-column-menu
                    className="fixed z-[200] max-h-72 w-56 overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-xl"
                    style={{
                      top: columnMenuPos?.top ?? 0,
                      left: columnMenuPos?.left ?? 0,
                      visibility: columnMenuPos ? "visible" : "hidden",
                    }}
                  >
                    {table
                      .getAllLeafColumns()
                      .filter((col) => col.id !== "select")
                      .map((col) => (
                        <label
                          key={col.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={col.getIsVisible()}
                            onChange={col.getToggleVisibilityHandler()}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                          />
                          {typeof col.columnDef.header === "string"
                            ? col.columnDef.header
                            : col.id}
                        </label>
                      ))}
                  </div>,
                  document.body
                )
              : null}
          </div>

          <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200/70">
            {(["compact", "comfortable", "spacious"] as RowDensity[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDensity(option)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                  density === option
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={resetLayout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Rows3 className="h-3.5 w-3.5" />
            Reset layout
          </button>
        </div>
        <div className="flex items-center gap-2">
          {copiedFlash ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3.5 w-3.5" />
              {copiedFlash}
            </span>
          ) : null}
          {toolbarSlot}
        </div>
      </div>

      {enableColumnFilters && filterState.rules.length > 0 ? (
        <ColumnFiltersBar
          state={filterState}
          columnLabels={columnLabels}
          onChange={setFilterState}
        />
      ) : null}

      {loading && data.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center gap-3 p-10 text-center text-sm text-slate-500 ${
            fillHeight ? "min-h-0 flex-1" : ""
          }`}
        >
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600" />
          Loading...
        </div>
      ) : data.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center gap-3 p-10 text-center text-sm text-slate-500 ${
            fillHeight ? "min-h-0 flex-1" : ""
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/70">
            <SearchX className="h-5 w-5" />
          </span>
          {emptyMessage}
        </div>
      ) : (
        <div
          ref={scrollParentRef}
          className={`${
            fillHeight
              ? "min-h-0 flex-1 overflow-auto"
              : "max-h-[calc(100vh-16rem)] overflow-auto"
          } ${refreshing ? "pointer-events-none opacity-60 transition-opacity" : "opacity-100 transition-opacity"}`}
        >
          <table
            className="w-full table-fixed text-left text-sm"
            style={{ width: table.getTotalSize() }}
          >
            <thead className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const isSelect = header.column.id === "select";
                    const columnHeader =
                      typeof header.column.columnDef.header === "string"
                        ? header.column.columnDef.header
                        : header.column.id;
                    const existingFilter = filterState.rules.find(
                      (rule) => rule.columnId === header.column.id
                    );
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className={`relative border-r border-slate-100 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${padY} ${
                          header.column.getIsPinned() ? "" : "bg-slate-50"
                        }`}
                        style={{
                          width: header.getSize(),
                          minWidth: header.getSize(),
                          maxWidth: header.getSize(),
                          backgroundColor: "rgb(248 250 252)",
                          ...getPinStyles(header.column.id, {
                            isHeader: true,
                            backgroundColor: "rgb(248 250 252)",
                          }),
                          zIndex: header.column.getIsPinned() ? 40 : 30,
                        }}
                        onDragOver={(e) => {
                          if (!isSelect && dragColId) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (
                            !dragColId ||
                            dragColId === header.column.id ||
                            isSelect
                          ) {
                            setDragColId(null);
                            return;
                          }
                          const order = [...columnOrder];
                          const from = order.indexOf(dragColId);
                          const to = order.indexOf(header.column.id);
                          if (from === -1 || to === -1) return;
                          order.splice(from, 1);
                          order.splice(to, 0, dragColId);
                          setColumnOrder(order);
                          setDragColId(null);
                        }}
                      >
                        <div className="flex items-center gap-1">
                          {!isSelect ? (
                            <span
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                setDragColId(header.column.id);
                              }}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (
                                  !dragColId ||
                                  dragColId === header.column.id
                                ) {
                                  setDragColId(null);
                                  return;
                                }
                                const order = [...columnOrder];
                                const from = order.indexOf(dragColId);
                                const to = order.indexOf(header.column.id);
                                if (from === -1 || to === -1) return;
                                order.splice(from, 1);
                                order.splice(to, 0, dragColId);
                                setColumnOrder(order);
                                setDragColId(null);
                              }}
                              className="cursor-grab touch-none text-slate-300 active:cursor-grabbing"
                              title="Drag to reorder column"
                            >
                              <GripVertical className="h-3.5 w-3.5 shrink-0" />
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={`flex min-w-0 flex-1 items-center gap-1 text-left ${
                              canSort ? "hover:text-slate-900" : ""
                            }`}
                            onClick={
                              canSort
                                ? header.column.getToggleSortingHandler()
                                : undefined
                            }
                          >
                            <span className="truncate">
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                            </span>
                            {canSort ? (
                              sorted === "asc" ? (
                                <ArrowUp className="h-3 w-3 shrink-0" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="h-3 w-3 shrink-0" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                              )
                            ) : null}
                          </button>
                          {!isSelect ? (
                            <div className="relative">
                              <button
                                type="button"
                                data-header-menu-trigger
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilterEditorColumnId(null);
                                  setHeaderMenuId((id) =>
                                    id === header.column.id ? null : header.column.id
                                  );
                                }}
                                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                aria-label="Column options"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                              {headerMenuId === header.column.id ? (
                                <div
                                  data-header-menu
                                  className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                                >
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      header.column.toggleSorting(false);
                                      setHeaderMenuId(null);
                                    }}
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                    Sort ascending
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      header.column.toggleSorting(true);
                                      setHeaderMenuId(null);
                                    }}
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                    Sort descending
                                  </button>
                                  {enableColumnFilters ? (
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                      onClick={() => {
                                        setHeaderMenuId(null);
                                        setFilterEditorColumnId(header.column.id);
                                      }}
                                    >
                                      <Filter className="h-3.5 w-3.5" />
                                      Filter…
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      header.column.pin("left");
                                      setHeaderMenuId(null);
                                    }}
                                  >
                                    <Pin className="h-3.5 w-3.5" />
                                    Pin left
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      header.column.pin("right");
                                      setHeaderMenuId(null);
                                    }}
                                  >
                                    <Pin className="h-3.5 w-3.5" />
                                    Pin right
                                  </button>
                                  {header.column.getIsPinned() ? (
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                      onClick={() => {
                                        header.column.pin(false);
                                        setHeaderMenuId(null);
                                      }}
                                    >
                                      <PinOff className="h-3.5 w-3.5" />
                                      Unpin
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      header.column.resetSize();
                                      setHeaderMenuId(null);
                                    }}
                                  >
                                    Auto width
                                  </button>
                                  {header.column.getCanHide() ? (
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                      onClick={() => {
                                        header.column.toggleVisibility(false);
                                        setHeaderMenuId(null);
                                      }}
                                    >
                                      <EyeOff className="h-3.5 w-3.5" />
                                      Hide column
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {enableColumnFilters &&
                              filterEditorColumnId === header.column.id ? (
                                <ColumnFilterEditor
                                  columnId={header.column.id}
                                  columnHeader={columnHeader}
                                  existing={existingFilter ?? null}
                                  onApply={upsertColumnFilter}
                                  onClose={() => setFilterEditorColumnId(null)}
                                />
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {header.column.getCanResize() ? (
                          <div
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              header.getResizeHandler()(e);
                            }}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              header.getResizeHandler()(e);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              header.column.resetSize();
                            }}
                            className={`absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-blue-400 ${
                              header.column.getIsResizing()
                                ? "bg-blue-500"
                                : "bg-transparent"
                            }`}
                            title="Drag to resize"
                          />
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paddingTop > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={colSpan}
                    style={{ height: paddingTop, padding: 0, border: 0 }}
                  />
                </tr>
              ) : null}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const selected = selectedIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className="[--row-bg:rgb(255_255_255)] hover:[--row-bg:rgb(248_250_252)]"
                    style={{ height: DENSITY_ROW_HEIGHT[density] }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const cellValues = row
                        .getVisibleCells()
                        .filter((cell) => cell.column.id !== "select")
                        .map((cell) => String(cell.getValue() ?? ""))
                        .join("\t");
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        rowId: row.id,
                        cellValue: "",
                        rowValues: cellValues,
                      });
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const value = String(cell.getValue() ?? "");
                      const cellMeta = cell.column.columnDef.meta as
                        | {
                            noTruncate?: boolean;
                            openDetailOnClick?: boolean;
                            detailKind?: "person" | "company";
                          }
                        | undefined;
                      const noTruncate = Boolean(cellMeta?.noTruncate);
                      const openDetailOnClick = Boolean(
                        cellMeta?.openDetailOnClick
                      );
                      const detailKind = cellMeta?.detailKind ?? "person";
                      return (
                        <td
                          key={cell.id}
                          className={`border-r border-slate-50 px-3 text-slate-700 transition-colors duration-100 ${padY} ${
                            noTruncate ? "overflow-hidden" : "truncate"
                          } ${
                            openDetailOnClick
                              ? "cursor-pointer"
                              : ""
                          }`}
                          style={{
                            width: cell.column.getSize(),
                            minWidth: cell.column.getSize(),
                            maxWidth: cell.column.getSize(),
                            backgroundColor: selected
                              ? "rgb(238 242 255)"
                              : "var(--row-bg)",
                            ...getPinStyles(cell.column.id, {
                              backgroundColor: selected
                                ? "rgb(238 242 255)"
                                : "var(--row-bg)",
                            }),
                          }}
                          title={noTruncate ? undefined : value}
                          onClick={
                            openDetailOnClick
                              ? (e) => {
                                  e.stopPropagation();
                                  setDetailState({ id: row.id, kind: detailKind });
                                }
                              : undefined
                          }
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const cellValues = row
                              .getVisibleCells()
                              .filter((c) => c.column.id !== "select")
                              .map((c) => String(c.getValue() ?? ""))
                              .join("\t");
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              rowId: row.id,
                              cellValue: value,
                              rowValues: cellValues,
                            });
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {paddingBottom > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={colSpan}
                    style={{ height: paddingBottom, padding: 0, border: 0 }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {table.getAllLeafColumns().some((col) => !col.getIsVisible() && col.id !== "select") ? (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2">
          <button
            type="button"
            onClick={() => setShowColumnMenu(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <Eye className="h-3.5 w-3.5" />
            Show hidden columns
          </button>
        </div>
      ) : null}

      <BulkToolbar
        selectedCount={selectedIds.size}
        enableExport={Boolean(bulkActions?.enableExport && onExportSelected)}
        exporting={exporting}
        onExport={
          onExportSelected
            ? () => void onExportSelected(Array.from(selectedIds))
            : undefined
        }
        enableDelete={Boolean(onDeleteSelected)}
        deleting={deleting}
        onDelete={
          onDeleteSelected
            ? () => void onDeleteSelected(Array.from(selectedIds))
            : undefined
        }
        onCopyIds={() => {
          void copyText(Array.from(selectedIds).join("\n")).then(() =>
            flashCopied("IDs copied")
          );
        }}
        onCopyEmails={
          bulkActions?.getEmail
            ? () => {
                const values = selectedRows
                  .map((row) => bulkActions.getEmail?.(row) ?? "")
                  .filter(Boolean);
                void copyText(values.join("\n")).then(() => flashCopied("Emails copied"));
              }
            : undefined
        }
        onCopyPhones={
          bulkActions?.getPhone
            ? () => {
                const values = selectedRows
                  .map((row) => bulkActions.getPhone?.(row) ?? "")
                  .filter(Boolean);
                void copyText(values.join("\n")).then(() => flashCopied("Phones copied"));
              }
            : undefined
        }
        onCopyCompanies={
          bulkActions?.getCompany
            ? () => {
                const values = selectedRows
                  .map((row) => bulkActions.getCompany?.(row) ?? "")
                  .filter(Boolean);
                void copyText(values.join("\n")).then(() =>
                  flashCopied("Companies copied")
                );
              }
            : undefined
        }
        onClear={() => onSelectedIdsChange(new Set())}
        lists={listOptions}
        listsLoading={listsLoading}
        listActionBusy={listActionBusy}
        onAddToList={
          onAddToList
            ? (listId) => void onAddToList(listId, Array.from(selectedIds))
            : undefined
        }
        onCreateList={
          onCreateList
            ? (name) => void onCreateList(name, Array.from(selectedIds))
            : undefined
        }
        onSaveToList={onSaveToList}
        saveToListBusy={saveToListBusy}
        contentAnchorRef={contentAnchorRef ?? tableRootRef}
      />

      {contextMenu ? (
        <div
          data-context-menu
          className="fixed z-50 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.cellValue ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                void copyText(contextMenu.cellValue).then(() => flashCopied("Cell copied"));
                setContextMenu(null);
              }}
            >
              Copy cell value
            </button>
          ) : null}
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              void copyText(contextMenu.rowValues).then(() => flashCopied("Row copied"));
              setContextMenu(null);
            }}
          >
            Copy entire row
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              const ctxRow = rowById.get(contextMenu.rowId);
              const looksLikeCompany =
                Boolean(ctxRow) &&
                !(ctxRow as { first_name?: string }).first_name &&
                !(ctxRow as { last_name?: string }).last_name &&
                Boolean((ctxRow as { company_name?: string }).company_name);
              setDetailState({
                id: contextMenu.rowId,
                kind: looksLikeCompany ? "company" : "person",
              });
              setContextMenu(null);
            }}
          >
            View details
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              const next = new Set(selectedIds);
              next.add(contextMenu.rowId);
              onSelectedIdsChange(new Set([contextMenu.rowId]));
              setContextMenu(null);
            }}
          >
            Select only this contact
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              const next = new Set(selectedIds);
              next.add(contextMenu.rowId);
              onSelectedIdsChange(next);
              setContextMenu(null);
            }}
          >
            Add to selection
          </button>
          {onDeleteSelected ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50"
              disabled={deleting}
              onClick={() => {
                const id = contextMenu.rowId;
                setContextMenu(null);
                void onDeleteSelected([id]);
              }}
            >
              Delete contact
            </button>
          ) : null}
        </div>
      ) : null}

      {detailRow && renderDetail ? (
        renderDetail({
          row: detailRow,
          kind: detailState?.kind ?? "person",
          onClose: () => setDetailState(null),
          onExport:
            enableRowExport &&
            onExportSelected &&
            (canRowExport ? canRowExport(detailRow) : true)
              ? () => void onExportSelected([detailRow.id])
              : undefined,
          exporting,
          openPerson: (nextRow) =>
            setDetailState({ id: nextRow.id, kind: "person", row: nextRow }),
          openCompany: (nextRow) =>
            setDetailState({ id: nextRow.id, kind: "company", row: nextRow }),
        })
      ) : (
        <RecordDrawer
          open={Boolean(detailRow)}
          title={
            detailRow && getDetailTitle
              ? getDetailTitle(detailRow)
              : detailRow
                ? detailRow.id
                : ""
          }
          subtitle={
            detailRow && getDetailSubtitle ? getDetailSubtitle(detailRow) : undefined
          }
          sections={
            detailRow && getDetailSections ? getDetailSections(detailRow) : []
          }
          onClose={() => setDetailState(null)}
          onExport={
            enableRowExport &&
            detailRow &&
            onExportSelected &&
            (canRowExport ? canRowExport(detailRow) : true)
              ? () => void onExportSelected([detailRow.id])
              : undefined
          }
          exporting={exporting}
          exportButtonLabel={rowExportLabel}
        />
      )}

      {selectionMenu ? (
        <SelectionMenu
          open={selectionMenuOpen}
          onClose={() => setSelectionMenuOpen(false)}
          anchorRef={selectionAnchorRef}
          entityLabel={selectionMenu.entityLabel}
          pageCount={table.getRowModel().rows.length}
          totalCount={selectionMenu.totalMatching}
          selecting={selectionMenu.selecting}
          showMaxPerCompany={selectionMenu.showMaxPerCompany}
          onApply={async (payload) => {
            if (payload.mode === "page") {
              const next = new Set(selectedIds);
              table.getRowModel().rows.forEach((row) => next.add(row.id));
              onSelectedIdsChange(next);
              setSelectionMenuOpen(false);
              return;
            }
            await selectionMenu.onApply(payload);
            setSelectionMenuOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
