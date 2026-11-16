"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Contact } from "@/lib/crm";
import { downloadCsv } from "@/lib/csv";
import {
  LEAD_REPORT_COLUMN_OPTIONS,
  columnIdsFromVisibility,
  defaultLeadReportColumnVisibility,
  type LeadReportColumnId,
  type LeadReportColumnVisibility,
} from "@/lib/lead-reports-columns";
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  getLeadStatusLabel,
  normalizeLeadStatus,
  scoreForLeadStatus,
  starsForLeadStatus,
} from "@/lib/lead-status";
import { portalContactRoute } from "@/lib/portal-nav";
import LeadReportSolutionCell from "./LeadReportSolutionCell";
import LeadReportStageCell from "./LeadReportStageCell";

function formatLeadDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type LeadReportListRef = {
  id: string;
  name: string;
};

type LeadReportItem = Contact & {
  leadStage?: string;
  leadStageLabel?: string;
  leadProject?: string;
  leadOwner?: string;
  position?: string;
  solutions?: string[];
  leadReportAt?: string;
  unsubscribed?: boolean;
  lists?: LeadReportListRef[];
  listNames?: string[];
};

type ListResponse = {
  items: LeadReportItem[];
  solutions?: string[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const PAGE_SIZE = 50;
const COLUMNS_STORAGE_KEY = "portal.leadReports.visibleColumns.v2";

function loadColumnVisibility(): LeadReportColumnVisibility {
  const defaults = defaultLeadReportColumnVisibility();
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw =
      window.localStorage.getItem(COLUMNS_STORAGE_KEY) ||
      window.localStorage.getItem("portal.leadReports.visibleColumns.v1");
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = { ...defaults };
    for (const key of Object.keys(defaults) as LeadReportColumnId[]) {
      if (typeof parsed[key] === "boolean") {
        next[key] = parsed[key] as boolean;
      }
    }
    next.lead = true;
    return next;
  } catch {
    return defaults;
  }
}

function displayName(contact: Contact) {
  const name = `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
  return name || contact.email || "Unknown";
}

function parseAttrSolutions(raw: unknown) {
  return String(raw ?? "")
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function leadReportSolutions(item: LeadReportItem): string[] {
  return item.solutions && item.solutions.length > 0
    ? item.solutions
    : parseAttrSolutions(item.attributes?.leadReportSolutions);
}

const CSV_HEADERS = [
  "Lead",
  "Email",
  "Company",
  "Position",
  "Solution",
  "Stage",
  "Date",
  "Project",
  "Owner",
] as const;

function leadReportCsvRow(item: LeadReportItem): string[] {
  const name = displayName(item);
  const position =
    item.position ||
    item.attributes?.position ||
    item.attributes?.title ||
    "";
  const solutions = leadReportSolutions(item);
  const stage =
    item.leadStageLabel ||
    (item.leadStage ? getLeadStatusLabel(normalizeLeadStatus(item.leadStage)) : "");
  const reportAt = item.leadReportAt || item.createdAt || item.updatedAt;
  return [
    name,
    item.email || "",
    item.companyName || "",
    position,
    solutions.join(", "),
    stage,
    formatLeadDate(reportAt),
    item.leadProject || item.attributes?.leadReportProject || "",
    item.leadOwner || item.attributes?.leadReportOwner || "",
  ];
}

export default function PortalLeadReportsPage() {
  const router = useRouter();
  const [items, setItems] = useState<LeadReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [stage, setStage] = useState("");
  const [solution, setSolution] = useState("");
  const [solutionOptions, setSolutionOptions] = useState<string[]>([]);
  const [savingStageId, setSavingStageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [savingSolutionId, setSavingSolutionId] = useState<string | null>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnMenuPos, setColumnMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<LeadReportColumnVisibility>(
    defaultLeadReportColumnVisibility,
  );
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setVisibleColumns(loadColumnVisibility());
  }, []);

  useLayoutEffect(() => {
    if (!columnMenuOpen) {
      setColumnMenuPos(null);
      return;
    }
    function placeMenu() {
      const button = columnMenuButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 220;
      const left = Math.max(
        12,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
      );
      setColumnMenuPos({
        top: rect.bottom + 6,
        left,
      });
    }
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [columnMenuOpen]);

  useEffect(() => {
    if (!columnMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      const inTrigger = columnMenuRef.current?.contains(target);
      const inPanel = columnMenuPanelRef.current?.contains(target);
      if (!inTrigger && !inPanel) setColumnMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setColumnMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [columnMenuOpen]);

  function toggleColumn(columnId: LeadReportColumnId) {
    const option = LEAD_REPORT_COLUMN_OPTIONS.find((column) => column.id === columnId);
    if (option && "locked" in option && option.locked) return;
    setVisibleColumns((current) => {
      const next = { ...current, [columnId]: !current[columnId], lead: true };
      try {
        window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }

  const visibleColumnIds = useMemo(
    () => columnIdsFromVisibility(visibleColumns),
    [visibleColumns],
  );

  const tableColSpan = Math.max(1, visibleColumnIds.length);

  const tableMinWidth = useMemo(() => {
    const widths: Record<LeadReportColumnId, number> = {
      lead: 160,
      email: 180,
      company: 140,
      position: 140,
      solution: 140,
      stage: 160,
      date: 124,
    };
    return visibleColumnIds.reduce((sum, id) => sum + widths[id], 0);
  }, [visibleColumnIds]);

  function leadReportHref(contactId: string) {
    return portalContactRoute(contactId, "/portal/crm/lead-reports", {
      view: "lead-report",
    });
  }

  function openLeadReportRow(
    contactId: string,
    event?: ReactMouseEvent | ReactKeyboardEvent,
  ) {
    const target = event?.target as HTMLElement | null | undefined;
    if (
      target?.closest(
        "a,button,input,textarea,select,label,.lr-notion-select,[role='listbox'],[role='option'],[role='menu']",
      )
    ) {
      return;
    }
    router.push(leadReportHref(contactId));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, stage, solution]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedQ) params.set("q", debouncedQ);
      if (stage) params.set("stage", stage);
      if (solution) params.set("solution", solution);
      const response = await fetch(`/api/crm/lead-reports?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as ListResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to load lead reports");
      }
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setSolutionOptions(data.solutions || []);
      setTotal(data.total || 0);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load lead reports");
      setItems([]);
      setTotal(0);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [page, debouncedQ, stage, solution]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!createOpen) return;
    const term = searchQ.trim();
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const params = new URLSearchParams({
            page: "1",
            pageSize: "12",
            q: term,
            searchField: "all",
          });
          const response = await fetch(`/api/crm/contacts?${params}`, {
            cache: "no-store",
          });
          const data = (await response.json()) as {
            items?: Contact[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(data.error || "Search failed");
          }
          setSearchResults(data.items || []);
        } catch {
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [createOpen, searchQ]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  );

  async function openLeadReport(contactId: string) {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/crm/lead-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const data = (await response.json()) as LeadReportItem & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not open lead report");
      }
      setCreateOpen(false);
      router.push(
        portalContactRoute(data.id || contactId, "/portal/crm/lead-reports", {
          view: "lead-report",
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open lead report");
    } finally {
      setCreating(false);
    }
  }

  async function saveRowStage(item: LeadReportItem, nextLabel: string) {
    if (savingStageId) return;
    setSavingStageId(item.id);
    setError("");
    const previousStage = item.leadStageLabel || item.leadStage || "";
    const label = nextLabel.trim();
    setItems((current) =>
      current.map((row) =>
        row.id === item.id
          ? {
              ...row,
              leadStage: label,
              leadStageLabel: label,
            }
          : row,
      ),
    );
    try {
      const score = label ? scoreForLeadStatus(label) : undefined;
      const stars = label ? starsForLeadStatus(label) : undefined;
      const response = await fetch(
        `/api/crm/contacts/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: {
              leadStage: label,
              ...(score !== undefined ? { score } : {}),
              ...(stars !== undefined
                ? { qualification: { overallScore: stars } }
                : {}),
            },
          }),
        },
      );
      const data = (await response.json()) as LeadReportItem & {
        error?: string;
        profile?: { leadStage?: string };
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not save stage");
      }
      const savedStage =
        data.profile?.leadStage || data.leadStageLabel || data.leadStage || label;
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                leadStage: savedStage,
                leadStageLabel: savedStage,
              }
            : row,
        ),
      );
    } catch (err) {
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                leadStage: previousStage,
                leadStageLabel: previousStage,
              }
            : row,
        ),
      );
      setError(err instanceof Error ? err.message : "Could not save stage");
    } finally {
      setSavingStageId(null);
    }
  }

  function addSolutionOption(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSolutionOptions((current) => {
      if (current.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
        return current;
      }
      return [...current, trimmed].sort((a, b) => a.localeCompare(b));
    });
  }

  async function removeSolutionOption(name: string) {
    const trimmed = name.trim();
    if (!trimmed || savingSolutionId) return;
    setError("");
    const previousOptions = solutionOptions;
    setSolutionOptions((current) =>
      current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
    );
    setItems((current) =>
      current.map((row) => {
        const rowSolutions = leadReportSolutions(row);
        if (
          !rowSolutions.some(
            (item) => item.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          return row;
        }
        return {
          ...row,
          solutions: undefined,
          attributes: {
            ...(row.attributes || {}),
            leadReportSolutions: "",
          },
        };
      }),
    );
    try {
      const response = await fetch("/api/crm/lead-reports/solutions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solution: trimmed }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Could not remove solution option");
      }
    } catch (err) {
      setSolutionOptions(previousOptions);
      setError(
        err instanceof Error ? err.message : "Could not remove solution option",
      );
      void load();
    }
  }

  async function saveRowSolution(item: LeadReportItem, next: string) {
    if (savingSolutionId) return;
    setSavingSolutionId(item.id);
    setError("");
    const previous = leadReportSolutions(item);
    const previousAttr = item.attributes?.leadReportSolutions;
    const name = next.trim();
    // Optimistic update so the cell responds immediately.
    setItems((current) =>
      current.map((row) =>
        row.id === item.id
          ? {
              ...row,
              solutions: name ? [name] : undefined,
              attributes: {
                ...(row.attributes || {}),
                leadReportSolutions: name,
              },
            }
          : row,
      ),
    );
    try {
      const response = await fetch("/api/crm/lead-reports/solutions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: item.id, solution: name }),
      });
      const data = (await response.json()) as {
        item?: LeadReportItem;
        solution?: string;
        error?: string;
      };
      if (!response.ok || !data.item) {
        throw new Error(data.error || "Could not save solution");
      }
      const saved = data.item;
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                ...saved,
                solutions:
                  data.solution && data.solution.length > 0
                    ? [data.solution]
                    : undefined,
              }
            : row,
        ),
      );
      if (data.solution) {
        setSolutionOptions((current) => {
          const names = new Set(current);
          names.add(data.solution as string);
          return [...names].sort((a, b) => a.localeCompare(b));
        });
      }
    } catch (err) {
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                solutions: previous.length > 0 ? previous : undefined,
                attributes: {
                  ...(row.attributes || {}),
                  leadReportSolutions: previousAttr,
                },
              }
            : row,
        ),
      );
      setError(
        err instanceof Error ? err.message : "Could not save solution",
      );
    } finally {
      setSavingSolutionId(null);
    }
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const collected: LeadReportItem[] = [];
      let pageIndex = 1;
      let totalPages = 1;
      do {
        const params = new URLSearchParams({
          page: String(pageIndex),
          pageSize: "100",
        });
        if (debouncedQ) params.set("q", debouncedQ);
        if (stage) params.set("stage", stage);
        if (solution) params.set("solution", solution);
        const response = await fetch(`/api/crm/lead-reports?${params}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as ListResponse & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Failed to export lead reports");
        }
        collected.push(...(data.items || []));
        totalPages = Math.max(1, data.totalPages || 1);
        pageIndex += 1;
      } while (pageIndex <= totalPages && pageIndex <= 50);

      if (collected.length === 0) {
        throw new Error("No lead reports to export for the current filters.");
      }

      downloadCsv(
        `lead-reports-${new Date().toISOString().slice(0, 10)}.csv`,
        [...CSV_HEADERS],
        collected.map(leadReportCsvRow),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export lead reports",
      );
    } finally {
      setExporting(false);
    }
  }

  async function sharePublicLink() {
    if (shareBusy) return;
    setShareBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/lead-reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: visibleColumnIds }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Failed to create public URL");
      }
      setShareUrl(data.url);
      try {
        await navigator.clipboard.writeText(data.url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2400);
      } catch {
        /* banner still shows the URL for manual copy */
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create public URL",
      );
    } finally {
      setShareBusy(false);
    }
  }

  const hasActiveFilters = Boolean(debouncedQ || stage || solution);
  const hasFilterChips = Boolean(stage || solution);
  const stageFilterLabel = stage
    ? LEAD_STATUS_LABELS[normalizeLeadStatus(stage)] || stage
    : "";

  return (
    <div className="crm-page lr-db-page">
      <div className="crm-page-head">
        <div>
          <h2>Lead Reports</h2>
          <p className="desc">
            Project pipeline lead reports — open a migrated report or create one from a
            CRM contact.
          </p>
        </div>
        <div className="lr-page-actions">
          <button
            type="button"
            className="btn-soft"
            disabled={exporting || loading || total === 0}
            onClick={() => void exportCsv()}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <button
            type="button"
            className="btn-soft"
            disabled={shareBusy}
            onClick={() => void sharePublicLink()}
          >
            {shareCopied
              ? "Public URL copied"
              : shareBusy
                ? "Creating…"
                : "Share public link"}
          </button>
          <button type="button" className="btn-dark" onClick={() => setCreateOpen(true)}>
            Create lead report
          </button>
        </div>
      </div>

      {shareUrl ? (
        <div className="an-share-banner">
          <span>Share all lead reports with a client:</span>
          <input
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}

      <div className="lr-db-count-row">
        <span className="lr-db-count">
          {loading
            ? "…"
            : hasActiveFilters
              ? `${total.toLocaleString()} result${total === 1 ? "" : "s"}`
              : `${total.toLocaleString()} lead report${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="lr-db-toolbar">
        <div className="lr-db-filter-row">
          <label className="lr-db-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search by name, email, company…"
              aria-label="Search lead reports"
            />
          </label>

          <label className={`lr-db-filter${stage ? " is-on" : ""}`}>
            <span className="lr-db-filter-key">Stage</span>
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              aria-label="Filter by stage"
            >
              <option value="">All</option>
              {LEAD_STATUS_ORDER.map((key) => (
                <option key={key} value={key}>
                  {LEAD_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className={`lr-db-filter${solution ? " is-on" : ""}`}>
            <span className="lr-db-filter-key">Solution</span>
            <select
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
              aria-label="Filter by solution"
            >
              <option value="">All</option>
              {solutionOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          {hasFilterChips ? (
            <button
              type="button"
              className="lr-db-clear"
              onClick={() => {
                setPage(1);
                setStage("");
                setSolution("");
              }}
            >
              Clear filters
            </button>
          ) : null}

          {hasFilterChips ? (
            <div className="lr-db-active-filters" aria-label="Active filters">
              {stage ? (
                <span className="lr-db-chip">
                  Stage: <strong>{stageFilterLabel}</strong>
                  <button
                    type="button"
                    aria-label="Clear stage filter"
                    onClick={() => {
                      setPage(1);
                      setStage("");
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : null}
              {solution ? (
                <span className="lr-db-chip">
                  Solution: <strong>{solution}</strong>
                  <button
                    type="button"
                    aria-label="Clear solution filter"
                    onClick={() => {
                      setPage(1);
                      setSolution("");
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="lr-db-toolbar-spacer" />

          <div className="lr-columns-wrap" ref={columnMenuRef}>
            <button
              ref={columnMenuButtonRef}
              type="button"
              className={`lr-db-props-btn${columnMenuOpen ? " is-open" : ""}`}
              aria-label="Choose columns"
              title="Properties"
              aria-expanded={columnMenuOpen}
              onClick={() => setColumnMenuOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M4 6h16M4 12h10M4 18h13" />
              </svg>
            </button>
            {columnMenuOpen && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={columnMenuPanelRef}
                    className="lists-columns-menu-portal lr-columns-menu-portal lr-db-props-menu"
                    role="menu"
                    aria-label="Visible columns"
                    style={{
                      top: columnMenuPos?.top ?? 0,
                      left: columnMenuPos?.left ?? 0,
                      visibility: columnMenuPos ? "visible" : "hidden",
                    }}
                  >
                    <div className="lr-db-props-menu-title">Properties</div>
                    {LEAD_REPORT_COLUMN_OPTIONS.map((column) => {
                      const locked = "locked" in column && column.locked;
                      return (
                        <label
                          key={column.id}
                          className={`lists-columns-option${locked ? " is-locked" : ""}`}
                          role="menuitemcheckbox"
                          aria-checked={visibleColumns[column.id]}
                        >
                          <input
                            type="checkbox"
                            checked={visibleColumns[column.id]}
                            disabled={locked}
                            onChange={() => toggleColumn(column.id)}
                          />
                          <span>{column.label}</span>
                        </label>
                      );
                    })}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}

      <div className="lr-db-table-wrap lr-reports-table-wrap">
        <table
          className="lr-db-table lr-reports-table"
          style={{ minWidth: tableMinWidth }}
        >
          <thead>
            <tr>
              {visibleColumns.lead ? <th className="lr-col-lead">Lead</th> : null}
              {visibleColumns.email ? (
                <th className="lr-col-email">Email</th>
              ) : null}
              {visibleColumns.company ? (
                <th className="lr-col-company">Company</th>
              ) : null}
              {visibleColumns.position ? (
                <th className="lr-col-position">Position</th>
              ) : null}
              {visibleColumns.solution ? (
                <th className="lr-col-solution">Solution</th>
              ) : null}
              {visibleColumns.stage ? (
                <th className="lr-col-stage">Stage</th>
              ) : null}
              {visibleColumns.date ? <th className="lr-col-date">Date</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr className="lr-reports-loading-row">
                <td
                  colSpan={tableColSpan}
                  className="crm-empty lr-reports-loading-cell"
                >
                  <div className="lr-loader" role="status" aria-live="polite">
                    <span className="lr-loader-spinner" aria-hidden="true" />
                    <span>Loading lead reports…</span>
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr className="lr-reports-empty-row">
                <td
                  colSpan={tableColSpan}
                  className="crm-empty lr-reports-empty-cell"
                >
                  {hasActiveFilters
                    ? "No lead reports match this search."
                    : "No lead reports in this project yet. Create one from a CRM contact, or run the migration for historical reports."}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const position =
                  item.position ||
                  item.attributes?.position ||
                  item.attributes?.title ||
                  "";
                const solutions = leadReportSolutions(item);
                const reportAt =
                  item.leadReportAt || item.createdAt || item.updatedAt;
                const dateLabel = formatLeadDate(reportAt);
                return (
                  <tr
                    key={item.id}
                    className="lr-db-row-link"
                    tabIndex={0}
                    role="link"
                    aria-label={`Open lead report for ${displayName(item)}`}
                    onClick={(event) => openLeadReportRow(item.id, event)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openLeadReportRow(item.id, event);
                      }
                    }}
                  >
                    {visibleColumns.lead ? (
                      <td className="lr-col-lead">
                        <Link
                          className="lr-cell-text lr-lead-link"
                          href={leadReportHref(item.id)}
                          title={`Open lead report for ${displayName(item)}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <strong>{displayName(item)}</strong>
                        </Link>
                      </td>
                    ) : null}
                    {visibleColumns.email ? (
                      <td className="lr-col-email">
                        <span className="lr-cell-text" title={item.email}>
                          {item.email}
                        </span>
                      </td>
                    ) : null}
                    {visibleColumns.company ? (
                      <td className="lr-col-company">
                        <span
                          className="lr-cell-text"
                          title={item.companyName || undefined}
                        >
                          {item.companyName || (
                            <span className="contact-empty-dash">—</span>
                          )}
                        </span>
                      </td>
                    ) : null}
                    {visibleColumns.position ? (
                      <td className="lr-col-position">
                        <span
                          className="lr-cell-text"
                          title={position || undefined}
                        >
                          {position || (
                            <span className="contact-empty-dash">—</span>
                          )}
                        </span>
                      </td>
                    ) : null}
                    {visibleColumns.solution ? (
                      <td
                        className="lr-col-solution"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <LeadReportSolutionCell
                          value={solutions[0] ?? ""}
                          options={solutionOptions}
                          saving={savingSolutionId === item.id}
                          onSave={(next) => void saveRowSolution(item, next)}
                          onAddOption={addSolutionOption}
                          onRemoveOption={(name) =>
                            void removeSolutionOption(name)
                          }
                        />
                      </td>
                    ) : null}
                    {visibleColumns.stage ? (
                      <td
                        className="lr-col-stage"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <LeadReportStageCell
                          value={item.leadStageLabel || item.leadStage || ""}
                          saving={savingStageId === item.id}
                          onSave={(next) => void saveRowStage(item, next)}
                        />
                      </td>
                    ) : null}
                    {visibleColumns.date ? (
                      <td className="lr-col-date">
                        {dateLabel ? (
                          <span
                            className="lr-cell-text lr-date-text"
                            title={reportAt}
                          >
                            {dateLabel}
                          </span>
                        ) : (
                          <span className="contact-empty-dash">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE ? (
        <div className="drip-pagination">
          <span className="drip-page-range">
            {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of{" "}
            {total.toLocaleString()}
          </span>
          <div className="drip-page-controls">
            <button
              type="button"
              className="drip-page-arrow"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              ‹
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="drip-page-arrow"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div
          className="crm-modal-backdrop"
          role="presentation"
          onClick={() => !creating && setCreateOpen(false)}
        >
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lr-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <h3 id="lr-create-title">Create lead report</h3>
              <button
                type="button"
                className="crm-modal-close"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <p className="desc">
                Search CRM contacts by name or email, then open their lead report.
              </p>
              <label className="crm-field">
                <span>Search contacts</span>
                <input
                  autoFocus
                  value={searchQ}
                  onChange={(event) => setSearchQ(event.target.value)}
                  placeholder="Name or email…"
                />
              </label>
              <div className="lr-create-results">
                {searching ? (
                  <div className="crm-empty">
                    <div className="lr-loader" role="status">
                      <span className="lr-loader-spinner" aria-hidden="true" />
                      <span>Searching…</span>
                    </div>
                  </div>
                ) : null}
                {!searching && searchQ.trim().length >= 2 && searchResults.length === 0 ? (
                  <p className="crm-empty">No contacts matched.</p>
                ) : null}
                <ul>
                  {searchResults.map((contact) => (
                    <li key={contact.id}>
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => void openLeadReport(contact.id)}
                      >
                        <strong>{displayName(contact)}</strong>
                        <span>{contact.email}</span>
                        <span>{contact.companyName || "No company"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
