"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  mapDataToolRecordToContact,
  formatEnrichRecordField,
  ENRICH_EMPLOYEE_SIZE_LABELS,
  ENRICH_REVENUE_RANGE_LABELS,
  ENRICH_RESULT_COLUMNS,
  DEFAULT_ENRICH_VISIBLE_COLUMNS,
  type DataToolRecord,
  type EnrichColumnKey,
  type EnrichOptions,
  type EnrichSearchFilters,
} from "@/lib/datatool";
import { createListWithChunkedImport } from "@/lib/crm-client-import";
import { portalListRoute } from "@/lib/portal-nav";

const ENRICH_HISTORY_KEY = "portal-enrich-history";
const ENRICH_COLUMNS_KEY = "portal-enrich-columns";

type EnrichHistoryEntry = {
  id: string;
  listName: string;
  listId: string;
  savedAt: string;
  contactCount: number;
  filtersSummary: string;
};

type ExistingListRef = {
  id: string;
  name: string;
  displayId: number;
};

type DuplicateMatch = {
  recordId: string;
  email: string;
  name: string;
  lists: ExistingListRef[];
};

function loadEnrichHistory(): EnrichHistoryEntry[] {
  try {
    const raw = localStorage.getItem(ENRICH_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as EnrichHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEnrichHistory(entries: EnrichHistoryEntry[]) {
  try {
    localStorage.setItem(ENRICH_HISTORY_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {
    // Ignore quota / private mode.
  }
}

function loadVisibleColumns(): EnrichColumnKey[] {
  try {
    const raw = localStorage.getItem(ENRICH_COLUMNS_KEY);
    if (!raw) {
      return [...DEFAULT_ENRICH_VISIBLE_COLUMNS];
    }
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_ENRICH_VISIBLE_COLUMNS];
    }
    const allowed = new Set(ENRICH_RESULT_COLUMNS.map((col) => col.key));
    const next = parsed.filter((key): key is EnrichColumnKey =>
      allowed.has(key as EnrichColumnKey),
    );
    for (const col of ENRICH_RESULT_COLUMNS) {
      if (col.alwaysOn && !next.includes(col.key)) {
        next.unshift(col.key);
      }
    }
    return next.length > 0 ? next : [...DEFAULT_ENRICH_VISIBLE_COLUMNS];
  } catch {
    return [...DEFAULT_ENRICH_VISIBLE_COLUMNS];
  }
}

function summarizeFilters(filters: EnrichSearchFilters) {
  const parts: string[] = [];
  const push = (label: string, values?: string[]) => {
    if (values && values.length > 0) {
      parts.push(`${label}: ${values.slice(0, 3).join(", ")}${values.length > 3 ? "…" : ""}`);
    }
  };
  push("Title", filters.titles);
  push("Level", filters.managementLevels);
  push("Size", filters.employeeSizes);
  push("Industry", filters.industryKeywords);
  push("Revenue", filters.revenueRanges);
  push("Tech", filters.technologies);
  push("Person", filters.personLocations);
  push("Company", filters.companyLocations);
  return parts.join(" · ") || "Custom enrich";
}

type FilterKey = keyof EnrichSearchFilters;

type WizardStep = {
  key: FilterKey;
  stepLabel: string;
  title: string;
  hint: string;
  placeholder: string;
  /** Fixed ranges — do not load/search from Data Tool API. */
  fixedOptions?: string[];
};

const WIZARD_STEPS: WizardStep[] = [
  {
    key: "titles",
    stepLabel: "01 · Position",
    title: "Position / Job Title",
    hint: "Pick from Data Portal, or type your own and press Enter",
    placeholder: "Search or type a job title…",
  },
  {
    key: "managementLevels",
    stepLabel: "02 · Management",
    title: "Management Level",
    hint: "Pick from Data Portal, or type your own and press Enter",
    placeholder: "Search or type a management level…",
  },
  {
    key: "employeeSizes",
    stepLabel: "03 · Company size",
    title: "Employee Size",
    hint: "Select ranges, or type your own size and press Enter",
    placeholder: "Search ranges or type your own…",
    fixedOptions: [...ENRICH_EMPLOYEE_SIZE_LABELS],
  },
  {
    key: "industryKeywords",
    stepLabel: "04 · Industry",
    title: "Industry & Keywords",
    hint: "Pick from Data Portal, or type your own and press Enter",
    placeholder: "Search or type an industry…",
  },
  {
    key: "revenueRanges",
    stepLabel: "05 · Revenue",
    title: "Revenue Range",
    hint: "Select ranges, or type your own revenue and press Enter",
    placeholder: "Search ranges or type your own…",
    fixedOptions: [...ENRICH_REVENUE_RANGE_LABELS],
  },
  {
    key: "technologies",
    stepLabel: "06 · Technologies",
    title: "Technologies Used",
    hint: "Pick from Data Portal, or type your own and press Enter",
    placeholder: "Search or type a technology…",
  },
  {
    key: "personLocations",
    stepLabel: "07 · Person location",
    title: "Person Location",
    hint: "Pick from Data Portal, or type your own and press Enter",
    placeholder: "Search or type a person location…",
  },
  {
    key: "companyLocations",
    stepLabel: "08 · Company location",
    title: "Company / Contact Location",
    hint: "Pick from Data Portal, or type your own and press Enter",
    placeholder: "Search or type a company location…",
  },
];

const EMPTY_FILTERS: EnrichSearchFilters = {
  titles: [],
  managementLevels: [],
  employeeSizes: [],
  industryKeywords: [],
  revenueRanges: [],
  technologies: [],
  personLocations: [],
  companyLocations: [],
};

const EMPTY_OPTIONS: EnrichOptions = {
  titles: [],
  managementLevels: [],
  employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
  industryKeywords: [],
  revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
  technologies: [],
  personLocations: [],
  companyLocations: [],
  scanned: 0,
  total: 0,
};

function recordLabel(record: DataToolRecord) {
  const name = [record.first_name, record.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || String(record.email ?? "Unknown");
}

function EnrichMultiSelect({
  options,
  value,
  onChange,
  placeholder,
  loading,
  onSearchApi,
  allowCustom = true,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  loading?: boolean;
  onSearchApi?: (query: string) => void;
  allowCustom?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!onSearchApi) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }
    const handle = window.setTimeout(() => {
      onSearchApi(trimmed);
    }, 320);
    return () => window.clearTimeout(handle);
  }, [query, onSearchApi]);

  const trimmedQuery = query.trim();

  const filtered = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => option.toLowerCase().includes(needle));
  }, [options, trimmedQuery]);

  const canAddCustom = useMemo(() => {
    if (!allowCustom || !trimmedQuery) {
      return false;
    }
    const lower = trimmedQuery.toLowerCase();
    if (value.some((item) => item.toLowerCase() === lower)) {
      return false;
    }
    if (options.some((item) => item.toLowerCase() === lower)) {
      return false;
    }
    return true;
  }, [allowCustom, trimmedQuery, value, options]);

  function toggle(option: string) {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option));
      return;
    }
    onChange([...value, option]);
  }

  function addCustom(raw: string) {
    const next = raw.trim();
    if (!next) {
      return;
    }
    const lower = next.toLowerCase();
    const existing = value.find((item) => item.toLowerCase() === lower);
    if (existing) {
      setQuery("");
      return;
    }
    const fromOptions = options.find((item) => item.toLowerCase() === lower);
    onChange([...value, fromOptions || next]);
    setQuery("");
    setOpen(true);
  }

  function remove(option: string) {
    onChange(value.filter((item) => item !== option));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (trimmedQuery) {
        addCustom(trimmedQuery);
      }
      return;
    }
    if (event.key === "Backspace" && !query && value.length > 0) {
      onChange(value.slice(0, -1));
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="enrich-ms" ref={rootRef}>
      <div
        className={`enrich-ms-control${open ? " open" : ""}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        <div className="enrich-ms-chips">
          {value.map((item) => (
            <button
              key={item}
              type="button"
              className="enrich-ms-chip"
              onClick={(event) => {
                event.stopPropagation();
                remove(item);
              }}
            >
              <span>{item}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <input
            className="enrich-ms-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={
              value.length === 0
                ? placeholder
                : "Type to search or add your own…"
            }
          />
        </div>
      </div>

      {open ? (
        <div className="enrich-ms-menu" role="listbox" aria-multiselectable>
          {canAddCustom ? (
            <button
              type="button"
              className="enrich-ms-option enrich-ms-option-custom"
              onClick={() => addCustom(trimmedQuery)}
            >
              <span className="enrich-ms-check">+</span>
              <span>
                Add “{trimmedQuery}”
              </span>
            </button>
          ) : null}
          {loading ? (
            <div className="enrich-ms-empty">Loading options from Data Tool…</div>
          ) : filtered.length === 0 ? (
            <div className="enrich-ms-empty">
              {trimmedQuery
                ? allowCustom
                  ? "No portal match — press Enter to add your own."
                  : "No matching values."
                : "No values found in Data Tool yet."}
            </div>
          ) : (
            filtered.slice(0, 200).map((option) => {
              const selected = value.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`enrich-ms-option${selected ? " selected" : ""}`}
                  onClick={() => toggle(option)}
                >
                  <span className="enrich-ms-check">{selected ? "✓" : ""}</span>
                  <span>{option}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function PortalEnrichPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [filters, setFilters] = useState<EnrichSearchFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<EnrichOptions>(EMPTY_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [phase, setPhase] = useState<"home" | "wizard" | "results">("home");

  const [records, setRecords] = useState<DataToolRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [matched, setMatched] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [selectingAll, setSelectingAll] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<EnrichColumnKey[]>([
    ...DEFAULT_ENRICH_VISIBLE_COLUMNS,
  ]);
  const [columnToolkitOpen, setColumnToolkitOpen] = useState(false);
  const [history, setHistory] = useState<EnrichHistoryEntry[]>([]);
  const columnToolkitRef = useRef<HTMLDivElement>(null);

  const step = WIZARD_STEPS[stepIndex];
  const selectedForStep = filters[step.key] || [];
  const optionsForStep = step.fixedOptions || options[step.key] || [];

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.has(record.id)),
    [records, selectedIds],
  );

  const activeColumns = useMemo(
    () =>
      ENRICH_RESULT_COLUMNS.filter((column) =>
        visibleColumns.includes(column.key),
      ),
    [visibleColumns],
  );

  const allResultsSelected =
    records.length > 0 &&
    selectedIds.size === records.length &&
    records.every((record) => selectedIds.has(record.id));

  const RESULTS_PAGE_SIZE = 200;
  const SELECT_ALL_LIMIT = 1000;

  const loadOptions = useCallback(async (q?: string) => {
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const query = q?.trim()
        ? `?q=${encodeURIComponent(q.trim())}`
        : "";
      const response = await fetch(`/api/crm/enrich/options${query}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load options");
      }
      const incoming = {
        titles: Array.isArray(data.titles) ? data.titles : [],
        managementLevels: Array.isArray(data.managementLevels)
          ? data.managementLevels
          : [],
        employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
        industryKeywords: Array.isArray(data.industryKeywords)
          ? data.industryKeywords
          : [],
        revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
        technologies: Array.isArray(data.technologies) ? data.technologies : [],
        personLocations: Array.isArray(data.personLocations)
          ? data.personLocations
          : [],
        companyLocations: Array.isArray(data.companyLocations)
          ? data.companyLocations
          : [],
        scanned: Number(data.scanned || 0),
        total: Number(data.total || 0),
      } satisfies EnrichOptions;

      setOptions((current) => {
        if (!q?.trim()) {
          return incoming;
        }
        const merge = (a: string[], b: string[]) =>
          [...new Set([...a, ...b])].sort((left, right) =>
            left.localeCompare(right, undefined, { sensitivity: "base" }),
          );
        return {
          titles: merge(current.titles, incoming.titles),
          managementLevels: merge(
            current.managementLevels,
            incoming.managementLevels,
          ),
          employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
          industryKeywords: merge(
            current.industryKeywords,
            incoming.industryKeywords,
          ),
          revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
          technologies: merge(current.technologies, incoming.technologies),
          personLocations: merge(
            current.personLocations,
            incoming.personLocations,
          ),
          companyLocations: merge(
            current.companyLocations,
            incoming.companyLocations,
          ),
          scanned: Math.max(current.scanned, incoming.scanned),
          total: Math.max(current.total, incoming.total),
        };
      });
    } catch (err) {
      setOptionsError(
        err instanceof Error ? err.message : "Failed to load options",
      );
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    setHistory(loadEnrichHistory());
    setVisibleColumns(loadVisibleColumns());
  }, []);

  useEffect(() => {
    if (!columnToolkitOpen) {
      return;
    }
    function onDocClick(event: MouseEvent) {
      if (!columnToolkitRef.current?.contains(event.target as Node)) {
        setColumnToolkitOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [columnToolkitOpen]);

  const onSearchApi = useCallback(
    (query: string) => {
      void loadOptions(query);
    },
    [loadOptions],
  );

  function startNewEnrich() {
    setPhase("wizard");
    setStepIndex(0);
    setFilters(EMPTY_FILTERS);
    setRecords([]);
    setSelectedIds(new Set());
    setError("");
    setSaveOpen(false);
    setDuplicates([]);
    setSaveError("");
  }

  function persistVisibleColumns(next: EnrichColumnKey[]) {
    setVisibleColumns(next);
    try {
      localStorage.setItem(ENRICH_COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota / private mode.
    }
  }

  function toggleColumn(key: EnrichColumnKey) {
    const meta = ENRICH_RESULT_COLUMNS.find((column) => column.key === key);
    if (meta?.alwaysOn) {
      return;
    }
    persistVisibleColumns(
      visibleColumns.includes(key)
        ? visibleColumns.filter((item) => item !== key)
        : [...visibleColumns, key],
    );
  }

  function setStepValues(next: string[]) {
    setFilters((current) => ({
      ...current,
      [step.key]: next,
    }));
  }

  async function runSearch(nextPage = 1) {
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/crm/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...filters,
          page: nextPage,
          limit: RESULTS_PAGE_SIZE,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }
      const nextRecords = Array.isArray(data.records)
        ? (data.records as DataToolRecord[])
        : [];
      setRecords(nextRecords);
      setPage(Number(data.page || nextPage));
      setTotal(Number(data.total || 0));
      setMatched(Number(data.matched ?? nextRecords.length));
      setScanned(Number(data.scanned ?? nextRecords.length));
      setLastQuery(String(data.q || ""));
      setSelectedIds(new Set());
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setRecords([]);
      setSelectedIds(new Set());
      setScanned(0);
      setLastQuery("");
      setPhase("results");
    } finally {
      setSearching(false);
    }
  }

  function goNext() {
    if (stepIndex < WIZARD_STEPS.length - 1) {
      setStepIndex((current) => current + 1);
      return;
    }
    void runSearch(1);
  }

  function goBack() {
    if (phase === "results") {
      setPhase("wizard");
      setError("");
      return;
    }
    if (stepIndex > 0) {
      setStepIndex((current) => current - 1);
      return;
    }
    setPhase("home");
  }

  async function toggleSelectAllResults() {
    if (allResultsSelected) {
      setSelectedIds(new Set());
      return;
    }

    setSelectingAll(true);
    setError("");
    try {
      const response = await fetch("/api/crm/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...filters,
          page: 1,
          limit: SELECT_ALL_LIMIT,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load all matches");
      }
      const nextRecords = Array.isArray(data.records)
        ? (data.records as DataToolRecord[])
        : [];
      setRecords(nextRecords);
      setPage(1);
      setTotal(Number(data.total || 0));
      setMatched(Number(data.matched ?? nextRecords.length));
      setScanned(Number(data.scanned ?? nextRecords.length));
      setLastQuery(String(data.q || ""));
      setSelectedIds(new Set(nextRecords.map((record) => record.id)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to select all results",
      );
    } finally {
      setSelectingAll(false);
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function removeDuplicateFromSelection(recordId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(recordId);
      return next;
    });
    setDuplicates((current) => current.filter((row) => row.recordId !== recordId));
  }

  function removeAllDuplicatesFromSelection() {
    const dupIds = new Set(duplicates.map((row) => row.recordId));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of dupIds) {
        next.delete(id);
      }
      return next;
    });
    setDuplicates([]);
  }

  async function openSaveModal() {
    if (selectedRecords.length === 0) {
      return;
    }
    const stamp = new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    setListName(`Enriched ${stamp}`);
    setSaveError("");
    setDuplicates([]);
    setSaveOpen(true);
    setCheckingDuplicates(true);

    const emails = [
      ...new Set(
        selectedRecords
          .map((record) => String(record.email ?? "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ];

    try {
      if (emails.length === 0) {
        return;
      }
      const matchMap = new Map<string, ExistingListRef[]>();
      const LOOKUP_CHUNK = 500;
      for (let index = 0; index < emails.length; index += LOOKUP_CHUNK) {
        const emailChunk = emails.slice(index, index + LOOKUP_CHUNK);
        const response = await fetch("/api/crm/contacts/lookup-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: emailChunk }),
        });
        const data = await response.json();
        if (!response.ok) {
          continue;
        }
        for (const match of (data.matches as
          | Array<{ email: string; lists: ExistingListRef[] }>
          | undefined) ?? []) {
          matchMap.set(match.email.toLowerCase(), match.lists);
        }
      }
      const nextDuplicates: DuplicateMatch[] = [];
      for (const record of selectedRecords) {
        const email = String(record.email ?? "").trim().toLowerCase();
        if (!email) {
          continue;
        }
        const lists = matchMap.get(email) ?? [];
        if (lists.length === 0) {
          continue;
        }
        nextDuplicates.push({
          recordId: record.id,
          email,
          name: recordLabel(record),
          lists,
        });
      }
      setDuplicates(nextDuplicates);
    } catch {
      // Keep save usable if lookup fails.
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function saveToList() {
    const name = listName.trim();
    if (!name || saving) {
      return;
    }
    const contacts = selectedRecords
      .map(mapDataToolRecordToContact)
      .filter((row) => row.email && row.firstName && row.companyName);

    if (contacts.length === 0) {
      setSaveError(
        "Selected rows need email, name, and company to save into a list.",
      );
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const { list } = await createListWithChunkedImport({
        name,
        contacts,
        importFileName: "data-tool-enrich",
      });
      const listId = list?.id || "";
      if (listId) {
        const entry: EnrichHistoryEntry = {
          id: `${Date.now()}`,
          listName: name,
          listId,
          savedAt: new Date().toISOString(),
          contactCount: contacts.length,
          filtersSummary: summarizeFilters(filters),
        };
        const nextHistory = [entry, ...history.filter((row) => row.listId !== listId)];
        setHistory(nextHistory);
        saveEnrichHistory(nextHistory);
      }
      setSaveOpen(false);
      setDuplicates([]);
      if (listId) {
        router.push(portalListRoute(listId));
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save list");
    } finally {
      setSaving(false);
    }
  }

  function deleteHistoryEntry(id: string) {
    const nextHistory = history.filter((entry) => entry.id !== id);
    setHistory(nextHistory);
    saveEnrichHistory(nextHistory);
  }

  const totalPages = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));
  const hasAnyFilter = Object.values(filters).some(
    (value) => Array.isArray(value) && value.length > 0,
  );
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const remainingAfterDupRemove = selectedIds.size - duplicates.length;

  return (
    <div className="enrich-page">
      <div className="crm-page-head">
        <div>
          <h2>Enrich</h2>
          <p className="desc">
            Search Data Tool, review matches, and save full contact details into
            CRM lists.
          </p>
        </div>
        {phase === "home" ? (
          <button type="button" className="btn-dark" onClick={startNewEnrich}>
            + Enrich
          </button>
        ) : null}
      </div>

      {phase === "home" ? (
        <section className="enrich-history">
          {history.length === 0 ? (
            <div className="enrich-empty">
              No enrich history yet. Click <strong>+ Enrich</strong> to search
              Data Tool and save contacts to a list.
            </div>
          ) : (
            <div className="enrich-table-wrap">
              <table className="data-table enrich-table">
                <thead>
                  <tr>
                    <th>List</th>
                    <th>Contacts</th>
                    <th>Filters</th>
                    <th>Saved</th>
                    <th className="enrich-actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <button
                          type="button"
                          className="btn-link-purple enrich-history-link"
                          onClick={() =>
                            router.push(portalListRoute(entry.listId))
                          }
                        >
                          {entry.listName}
                        </button>
                      </td>
                      <td>{entry.contactCount.toLocaleString()}</td>
                      <td>
                        <span className="enrich-meta">
                          {entry.filtersSummary}
                        </span>
                      </td>
                      <td>
                        {new Date(entry.savedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="enrich-actions-col">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={() =>
                            router.push(portalListRoute(entry.listId))
                          }
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn-soft enrich-danger-btn"
                          onClick={() => deleteHistoryEntry(entry.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {phase === "wizard" ? (
        <section className="enrich-wizard">
          <div className="enrich-wizard-progress">
            {WIZARD_STEPS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={`enrich-wizard-dot${index === stepIndex ? " active" : ""}${index < stepIndex ? " done" : ""}`}
                onClick={() => setStepIndex(index)}
                title={item.title}
              >
                {index + 1}
              </button>
            ))}
          </div>

          <div className="enrich-wizard-card">
            <div className="enrich-section-label">{step.stepLabel}</div>
            <h3 className="enrich-wizard-title">{step.title}</h3>
            <p className="enrich-field-hint">{step.hint}</p>

            {optionsError ? <div className="crm-error">{optionsError}</div> : null}

            <EnrichMultiSelect
              key={step.key}
              options={optionsForStep}
              value={selectedForStep}
              onChange={setStepValues}
              placeholder={step.placeholder}
              loading={step.fixedOptions ? false : optionsLoading}
              onSearchApi={step.fixedOptions ? undefined : onSearchApi}
            />

            {selectedForStep.length > 0 ? (
              <p className="enrich-selected-count">
                {selectedForStep.length} selected
              </p>
            ) : (
              <p className="enrich-selected-count muted">
                Optional — you can skip and continue
              </p>
            )}

            <div className="enrich-wizard-actions">
              <button
                type="button"
                className="btn-soft"
                onClick={goBack}
                disabled={searching}
              >
                {stepIndex === 0 ? "History" : "Back"}
              </button>
              <div className="enrich-wizard-actions-right">
                {!isLastStep ? (
                  <button
                    type="button"
                    className="btn-soft"
                    onClick={() => setStepIndex((current) => current + 1)}
                    disabled={searching}
                  >
                    Skip
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-dark"
                  onClick={goNext}
                  disabled={searching || (isLastStep && !hasAnyFilter)}
                >
                  {searching
                    ? "Searching…"
                    : isLastStep
                      ? "Search Data Tool"
                      : "Next"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {phase === "results" ? (
        <section className="enrich-results">
          <div className="enrich-results-head">
            <div>
              <h3>Results</h3>
              <p>
                {matched} loaded
                {total > 0 ? ` · ${total.toLocaleString()} in Data Tool` : ""}
                {selectedIds.size > 0
                  ? ` · ${selectedIds.size} selected`
                  : ""}
                {selectingAll ? " · selecting all…" : ""}
              </p>
            </div>
            <div className="enrich-results-actions">
              <div className="enrich-column-toolkit" ref={columnToolkitRef}>
                <button
                  type="button"
                  className="btn-soft"
                  onClick={() => setColumnToolkitOpen((open) => !open)}
                  aria-expanded={columnToolkitOpen}
                  aria-haspopup="true"
                >
                  Columns
                </button>
                {columnToolkitOpen ? (
                  <div className="enrich-column-menu" role="menu">
                    <div className="enrich-column-menu-head">Show columns</div>
                    {ENRICH_RESULT_COLUMNS.map((column) => {
                      const checked = visibleColumns.includes(column.key);
                      return (
                        <label
                          key={column.key}
                          className={`enrich-column-option${column.alwaysOn ? " locked" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={column.alwaysOn}
                            onChange={() => toggleColumn(column.key)}
                          />
                          <span>{column.label}</span>
                          {column.alwaysOn ? (
                            <span className="enrich-column-locked">Required</span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="btn-soft"
                onClick={goBack}
                disabled={searching || selectingAll}
              >
                Edit filters
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={selectedIds.size === 0 || searching || selectingAll}
                onClick={() => void openSaveModal()}
              >
                Save to list
              </button>
            </div>
          </div>

          {error ? <div className="crm-error">{error}</div> : null}

          {records.length === 0 ? (
            <div className="enrich-empty">
              No people matched these filters.
              {lastQuery ? (
                <>
                  {" "}
                  Data Tool search used <code>{lastQuery}</code>
                  {scanned > 0 ? ` and scanned ${scanned} records` : ""}.
                </>
              ) : scanned > 0 ? (
                <> Scanned {scanned} records.</>
              ) : null}{" "}
              Try fewer filters (start with title or industry only), then narrow.
            </div>
          ) : (
            <>
              <div className="enrich-table-wrap">
                <table className="data-table enrich-table">
                  <thead>
                    <tr>
                      <th className="enrich-check-col">
                        <input
                          type="checkbox"
                          checked={allResultsSelected}
                          disabled={selectingAll || searching}
                          onChange={() => {
                            void toggleSelectAllResults();
                          }}
                          aria-label="Select all results"
                          title="Select all matched results"
                        />
                      </th>
                      {activeColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td className="enrich-check-col">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(record.id)}
                            onChange={() => toggleOne(record.id)}
                            aria-label={`Select ${recordLabel(record)}`}
                          />
                        </td>
                        {activeColumns.map((column) => {
                          const value = formatEnrichRecordField(
                            record,
                            column.key,
                          );
                          return (
                            <td key={column.key}>
                              {column.key === "name" ? (
                                <div className="enrich-name">
                                  {value || "—"}
                                </div>
                              ) : (
                                value || "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 ? (
                <div className="enrich-pager">
                  <button
                    type="button"
                    className="btn-soft"
                    disabled={page <= 1 || searching}
                    onClick={() => void runSearch(page - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn-soft"
                    disabled={page >= totalPages || searching}
                    onClick={() => void runSearch(page + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {saveOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => {
            if (!saving) {
              setSaveOpen(false);
            }
          }}
        >
          <div
            className="crm-modal enrich-save-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="enrich-save-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="enrich-save-title">Save to list</h3>
                <p>
                  Create a new CRM list with {selectedRecords.length} selected
                  contact
                  {selectedRecords.length === 1 ? "" : "s"}. All Data Tool
                  fields are saved on each contact.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={() => setSaveOpen(false)}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <div className="crm-field">
                <label htmlFor="enrich-list-name">List name</label>
                <input
                  id="enrich-list-name"
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  placeholder="e.g. SaaS VPs US"
                  disabled={saving}
                  autoFocus
                />
              </div>

              {checkingDuplicates ? (
                <p className="enrich-dup-status">Checking for existing emails…</p>
              ) : null}

              {!checkingDuplicates && duplicates.length > 0 ? (
                <div className="enrich-dup-panel">
                  <div className="enrich-dup-panel-head">
                    <div>
                      <strong>
                        {duplicates.length} already in your lists
                      </strong>
                      <p>
                        These emails already belong to other CRM lists. Remove
                        them before saving, or keep them to add again.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-soft enrich-danger-btn"
                      onClick={removeAllDuplicatesFromSelection}
                      disabled={saving}
                    >
                      Remove all
                    </button>
                  </div>
                  <ul className="enrich-dup-list">
                    {duplicates.map((row) => (
                      <li key={row.recordId}>
                        <div>
                          <div className="enrich-name">{row.name}</div>
                          <div className="enrich-meta">{row.email}</div>
                          <div className="enrich-meta">
                            In{" "}
                            {row.lists
                              .map(
                                (list) => `${list.name} (#${list.displayId})`,
                              )
                              .join(", ")}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-soft enrich-danger-btn"
                          onClick={() =>
                            removeDuplicateFromSelection(row.recordId)
                          }
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!checkingDuplicates &&
              duplicates.length === 0 &&
              selectedRecords.length > 0 ? (
                <p className="enrich-dup-status ok">
                  No selected emails are already on other lists.
                </p>
              ) : null}

              {saveError ? <div className="crm-error">{saveError}</div> : null}
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-link-purple"
                onClick={() => setSaveOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void saveToList()}
                disabled={
                  saving ||
                  !listName.trim() ||
                  selectedRecords.length === 0 ||
                  checkingDuplicates
                }
              >
                {saving
                  ? "Saving…"
                  : `Save ${selectedRecords.length} contact${selectedRecords.length === 1 ? "" : "s"}`}
              </button>
            </div>
            {duplicates.length > 0 && remainingAfterDupRemove >= 0 ? (
              <p className="enrich-save-hint">
                {remainingAfterDupRemove} contact
                {remainingAfterDupRemove === 1 ? "" : "s"} will remain after
                removing duplicates.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
