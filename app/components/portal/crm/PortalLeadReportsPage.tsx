"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Contact } from "@/lib/crm";
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  LEAD_STATUS_UI,
  getLeadStatusLabel,
  normalizeLeadStatus,
} from "@/lib/lead-status";
import { portalContactRoute, portalListRoute } from "@/lib/portal-nav";

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
const COLUMNS_STORAGE_KEY = "portal.leadReports.visibleColumns.v1";

const LEAD_REPORT_COLUMN_OPTIONS = [
  { id: "lead", label: "Lead", locked: true },
  { id: "email", label: "Email" },
  { id: "company", label: "Company" },
  { id: "position", label: "Position" },
  { id: "solution", label: "Solution" },
  { id: "lists", label: "Lists" },
  { id: "stage", label: "Stage" },
  { id: "date", label: "Date" },
] as const;

type LeadReportColumnId = (typeof LEAD_REPORT_COLUMN_OPTIONS)[number]["id"];
type LeadReportColumnVisibility = Record<LeadReportColumnId, boolean>;

function defaultColumnVisibility(): LeadReportColumnVisibility {
  return {
    lead: true,
    email: true,
    company: true,
    position: true,
    solution: true,
    lists: true,
    stage: true,
    date: true,
  };
}

function loadColumnVisibility(): LeadReportColumnVisibility {
  const defaults = defaultColumnVisibility();
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<LeadReportColumnVisibility>;
    return {
      ...defaults,
      ...parsed,
      lead: true,
    };
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

export default function PortalLeadReportsPage() {
  const router = useRouter();
  const [items, setItems] = useState<LeadReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [solution, setSolution] = useState("");
  const [solutionOptions, setSolutionOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnMenuPos, setColumnMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<LeadReportColumnVisibility>(
    defaultColumnVisibility,
  );
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnMenuPanelRef = useRef<HTMLDivElement | null>(null);

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
    () =>
      LEAD_REPORT_COLUMN_OPTIONS.filter((column) => visibleColumns[column.id]).map(
        (column) => column.id,
      ),
    [visibleColumns],
  );

  const tableColSpan = visibleColumnIds.length + 1; // + action

  const tableMinWidth = useMemo(() => {
    const widths: Record<LeadReportColumnId, number> = {
      lead: 160,
      email: 180,
      company: 140,
      position: 140,
      solution: 140,
      lists: 140,
      stage: 160,
      date: 124,
    };
    const content = visibleColumnIds.reduce(
      (sum, id) => sum + widths[id],
      0,
    );
    return content + 72; // action
  }, [visibleColumnIds]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (q.trim()) params.set("q", q.trim());
      if (stage) params.set("stage", stage);
      if (solution) params.set("solution", solution);
      const response = await fetch(`/api/crm/lead-reports?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as ListResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to load lead reports");
      }
      setItems(data.items || []);
      setSolutionOptions(data.solutions || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lead reports");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, q, stage, solution]);

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

  return (
    <div className="crm-page">
      <div className="crm-page-head">
        <div>
          <h2>Lead Reports</h2>
          <p className="desc">
            Project pipeline lead reports — open a migrated report or create one from a
            CRM contact.
          </p>
        </div>
        <button type="button" className="btn-dark" onClick={() => setCreateOpen(true)}>
          Create lead report
        </button>
      </div>

      <div className="crm-filter-row lr-list-toolbar">
        <input
          value={q}
          onChange={(event) => {
            setPage(1);
            setQ(event.target.value);
          }}
          placeholder="Search name, email, company, position, solution…"
          aria-label="Search lead reports"
        />
        <select
          className="lr-toolbar-select"
          value={stage}
          onChange={(event) => {
            setPage(1);
            setStage(event.target.value);
          }}
          aria-label="Filter by stage"
        >
          <option value="">All stages</option>
          {LEAD_STATUS_ORDER.map((key) => (
            <option key={key} value={key}>
              {LEAD_STATUS_LABELS[key]}
            </option>
          ))}
        </select>
        <div className="lr-toolbar-solution-wrap">
          <select
            className="lr-toolbar-select"
            value={solution}
            onChange={(event) => {
              setPage(1);
              setSolution(event.target.value);
            }}
            aria-label="Filter by solution"
          >
            <option value="">All solutions</option>
            {solutionOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="lr-columns-wrap" ref={columnMenuRef}>
            <button
              ref={columnMenuButtonRef}
              type="button"
              className={`kebab${columnMenuOpen ? " active" : ""}`}
              aria-label="Choose columns"
              aria-expanded={columnMenuOpen}
              onClick={() => setColumnMenuOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
            {columnMenuOpen && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={columnMenuPanelRef}
                    className="lists-columns-menu-portal lr-columns-menu-portal"
                    role="menu"
                    aria-label="Visible columns"
                    style={{
                      top: columnMenuPos?.top ?? 0,
                      left: columnMenuPos?.left ?? 0,
                      visibility: columnMenuPos ? "visible" : "hidden",
                    }}
                  >
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

      <div className="data-table-wrap lr-reports-table-wrap">
        <table
          className="data-table contacts-table lr-reports-table"
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
              {visibleColumns.lists ? (
                <th className="lr-col-lists">Lists</th>
              ) : null}
              {visibleColumns.stage ? (
                <th className="lr-col-stage">Stage</th>
              ) : null}
              {visibleColumns.date ? <th className="lr-col-date">Date</th> : null}
              <th className="lr-col-action" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
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
                  No lead reports in this project yet. Create one from a CRM contact, or
                  run the migration for historical reports.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const lists =
                  item.lists && item.lists.length > 0
                    ? item.lists
                    : (item.listNames || []).map((name) => ({
                        id: "",
                        name,
                      }));
                const position =
                  item.position ||
                  item.attributes?.position ||
                  item.attributes?.title ||
                  "";
                const solutions =
                  item.solutions && item.solutions.length > 0
                    ? item.solutions
                    : parseAttrSolutions(
                        item.attributes?.leadReportSolutions,
                      );
                const solutionsLabel = solutions.join(", ");
                const reportAt =
                  item.leadReportAt || item.createdAt || item.updatedAt;
                const dateLabel = formatLeadDate(reportAt);
                return (
                  <tr key={item.id}>
                    {visibleColumns.lead ? (
                      <td className="lr-col-lead">
                        <Link
                          className="lr-cell-text lr-lead-link"
                          href={portalContactRoute(
                            item.id,
                            "/portal/crm/lead-reports",
                          )}
                          title={`View ${displayName(item)} in CRM`}
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
                      <td className="lr-col-solution">
                        <span
                          className="lr-cell-text"
                          title={solutionsLabel || undefined}
                        >
                          {solutionsLabel || (
                            <span className="contact-empty-dash">—</span>
                          )}
                        </span>
                      </td>
                    ) : null}
                    {visibleColumns.lists ? (
                      <td className="lr-col-lists">
                        {lists.length > 0 || item.unsubscribed ? (
                          <div className="lr-lists-cell">
                            {lists.length > 0 ? (
                              <span
                                className="lr-lists-links"
                                title={lists.map((list) => list.name).join(", ")}
                              >
                                {lists.map((list, index) => (
                                  <span key={`${list.id || list.name}-${index}`}>
                                    {index > 0 ? ", " : null}
                                    {list.id ? (
                                      <Link
                                        className="lr-list-link"
                                        href={portalListRoute(list.id)}
                                      >
                                        {list.name}
                                      </Link>
                                    ) : (
                                      list.name
                                    )}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                            {item.unsubscribed ? (
                              <Link
                                className="lr-list-link lr-unsub-link"
                                href="/portal/unsub"
                                title="This email is on the unsubscribe / suppression list"
                              >
                                Unsubscribed
                              </Link>
                            ) : null}
                          </div>
                        ) : (
                          <span className="contact-empty-dash">—</span>
                        )}
                      </td>
                    ) : null}
                    {visibleColumns.stage ? (
                      <td className="lr-col-stage">
                        {item.leadStageLabel || item.leadStage ? (
                          (() => {
                            const status = normalizeLeadStatus(
                              item.leadStage || item.leadStageLabel,
                            );
                            return (
                              <span
                                className={`lr-list-stage ${LEAD_STATUS_UI[status].badgeClass}`}
                              >
                                {item.leadStageLabel ||
                                  getLeadStatusLabel(status)}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="contact-empty-dash">—</span>
                        )}
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
                    <td className="lr-col-action">
                      <Link
                        className="lr-open-icon"
                        href={portalContactRoute(
                          item.id,
                          "/portal/crm/lead-reports",
                          { view: "lead-report" },
                        )}
                        aria-label={`Open lead report for ${displayName(item)}`}
                        title="Open lead report"
                      >
                        <ArrowUpRight aria-hidden="true" />
                      </Link>
                    </td>
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
