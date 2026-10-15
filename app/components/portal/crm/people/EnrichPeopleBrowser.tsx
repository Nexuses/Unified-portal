"use client";

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { Search } from "lucide-react";
import DataTablePanel from "@/app/components/portal/crm/people/DataTablePanel";
import FilterPresetsMenu from "@/app/components/portal/crm/people/FilterPresetsMenu";
import FilterSidebar from "@/app/components/portal/crm/people/FilterSidebar";
import AiFilterBox from "@/app/components/portal/crm/people/AiFilterBox";
import {
  ENRICH_APPLY_FILTERS_EVENT,
  ENRICH_MAX_SAVE,
  ENRICH_MAX_SAVE_MESSAGE,
  ENRICH_SESSION_SCOPE,
  type EnrichExclusions,
} from "@/lib/people/enrich-people";
import {
  EMPTY_COLUMN_FILTER_STATE,
  isColumnFilterStateEmpty,
  type ColumnFilterState,
} from "@/lib/people/column-filters";
import {
  AI_PENDING_FILTERS_KEY,
  aiSearchFiltersToPresetPayload,
  type AiSearchFilters,
} from "@/lib/people/ai-search";
import {
  clearDataBrowserSession,
  loadDataBrowserSession,
  saveDataBrowserSession,
  type DataBrowserSessionState,
} from "@/lib/people/data-browser/session-state";
import {
  getCachedFacets,
  getCachedRecords,
  setCachedFacets,
  setCachedRecords,
  type FacetsResponse,
  type RecordsResponse,
} from "@/lib/people/data-browser/response-cache";
import type { FilterPresetPayload } from "@/lib/people/filter-presets";
import {
  EMPTY_COMPANY_FILTER,
  EMPTY_EMPLOYEES_FILTER,
  EMPTY_INDUSTRY_KEYWORDS_FILTER,
  EMPTY_JOB_TITLE_FILTER,
  EMPTY_LOCATION_FILTER,
  EMPTY_PEOPLE_LOOKALIKES_FILTER,
  EMPTY_TECHNOLOGIES_FILTER,
  EMPTY_REVENUE_FILTER,
  companyActiveTags,
  employeesActiveTags,
  employeesFilterCount,
  industryKeywordsActiveTags,
  industryKeywordsFilterCount,
  technologiesActiveTags,
  technologiesFilterCount,
  revenueActiveTags,
  revenueFilterCount,
  isCompanyFilterEmpty,
  isEmployeesFilterEmpty,
  isIndustryKeywordsFilterEmpty,
  isJobTitleFilterEmpty,
  isLocationFilterEmpty,
  isPeopleLookalikesFilterEmpty,
  isTechnologiesFilterEmpty,
  isRevenueFilterEmpty,
  jobTitleActiveTags,
  locationActiveTags,
  locationFilterCount,
  peopleLookalikesActiveTags,
  peopleLookalikesFilterCount,
  companyFilterCount,
  type CompanyFilter,
  type CompanyFilterTagField,
  type EmployeesFilter,
  type EmployeesFilterTagField,
  type IndustryKeywordsFilter,
  type IndustryKeywordsFilterTagField,
  type TechnologiesFilter,
  type TechnologiesFilterTagField,
  type RevenueFilter,
  type RevenueFilterTagField,
  type FilterKey,
  type JobTitleFilter,
  type JobTitleFilterTagField,
  type LocationFilter,
  type LocationFilterTagField,
  type PeopleLookalikesFilter,
  type StatTab,
} from "@/lib/people/data-browser/types";
import type { PeopleSuggestionRecord } from "@/app/components/portal/crm/people/people-lookalike-suggestions";
import { getEmailStatusOptionById } from "@/app/components/portal/crm/people/email-status-options";
import { phoneFilterLabel } from "@/app/components/portal/crm/people/PhoneFilter";
import { VIEW_COLUMNS, type DataView } from "@/lib/people/data-views";
import PortalToast from "@/app/components/portal/PortalToast";

interface DataRecordRow {
  id: string;
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  title: string;
  [key: string]: string;
}

export type EnrichListOption = { id: string; name: string; recordCount: number };

export type EnrichSelectionContext = {
  ids: string[];
  filtersSummary: string;
  exclusions: EnrichExclusions;
  exclusionCounts: { unsubscribed: number; existing: number } | null;
};

interface EnrichPeopleBrowserProps {
  listOptions: EnrichListOption[];
  listsLoading: boolean;
  listActionBusy: boolean;
  exporting: boolean;
  /** Save these records to a new CRM list (opens the save dialog). */
  onSaveToNewList: (context: EnrichSelectionContext, name?: string) => void | Promise<void>;
  onAddToList: (listId: string, ids: string[]) => void | Promise<void>;
  onExport: (ids: string[]) => void | Promise<void>;
  /** Data credits left this month; `null` while unknown. */
  creditsRemaining?: number | null;
}

let hardReloadHandled = false;

/** After the tab is refreshed on this page, start from a clean filter state. */
function clearSessionAfterHardReload(scope: string) {
  if (hardReloadHandled) return;
  hardReloadHandled = true;
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (entry?.type === "reload" && new URL(entry.name).pathname === window.location.pathname) {
    clearDataBrowserSession(scope);
  }
}

const FILTER_PARAM_KEYS = [
  "search",
  "jobTitleFilter",
  "peopleLookalikesFilter",
  "companyFilter",
  "locationFilter",
  "employeesFilter",
  "industryKeywordsFilter",
  "technologiesFilter",
  "revenueFilter",
  "columnFilters",
];

function hasAppliedFilters(params: URLSearchParams) {
  if (FILTER_PARAM_KEYS.some((key) => params.has(key))) return true;
  try {
    const selected = JSON.parse(params.get("filters") || "{}") as Record<string, unknown>;
    return Object.values(selected).some((values) => Array.isArray(values) && values.length > 0);
  } catch {
    return false;
  }
}

function cleanupMessage(needed: EnrichExclusions) {
  return `Remove ${[
    needed.unsubscribed ? "unsubscribed contacts" : "",
    needed.existing ? "contacts already in your lists" : "",
  ]
    .filter(Boolean)
    .join(" and ")} first, then save.`;
}

const EXCLUSION_LABELS: Record<keyof EnrichExclusions, string> = {
  unsubscribed: "Remove unsubscribed",
  existing: "Remove already in lists",
};

const PAGE_OPTION_RADIUS = 50;

/** First, last and pages near the current one — thousands of <option>s make every render slow. */
function buildPageOptions(page: number, totalPages: number) {
  const start = Math.max(1, page - PAGE_OPTION_RADIUS);
  const end = Math.min(totalPages, page + PAGE_OPTION_RADIUS);
  const options: number[] = [];
  if (start > 1) options.push(1);
  for (let value = start; value <= end; value++) options.push(value);
  if (end < totalPages) options.push(totalPages);
  return options;
}

const SIDEBAR_STORAGE_KEY_PREFIX = "filter-sidebar-collapsed";
const PAGE_SIZE = 50;
const SHOW_ALL_LIMIT = 5000;
const MAX_SAVE_RECORDS = ENRICH_MAX_SAVE;

interface ExpandedHighlights {
  title: string[];
  departments: string[];
  industry: string[];
}

const EMPTY_EXPANDED_HIGHLIGHTS: ExpandedHighlights = {
  title: [],
  departments: [],
  industry: [],
};

export default function EnrichPeopleBrowser({
  listOptions,
  listsLoading,
  listActionBusy,
  exporting,
  onSaveToNewList,
  onAddToList,
  onExport,
  creditsRemaining = null,
}: EnrichPeopleBrowserProps) {
  const view: DataView = "people";
  const sessionScope = ENRICH_SESSION_SCOPE;
  const tableColumns = VIEW_COLUMNS[view];
  const [records, setRecords] = useState<DataRecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [exclusions, setExclusions] = useState<EnrichExclusions>({
    unsubscribed: false,
    existing: false,
  });
  const [exclusionCounts, setExclusionCounts] = useState<{
    unsubscribed: number;
    existing: number;
  } | null>(null);
  const [exclusionCountsLoading, setExclusionCountsLoading] = useState(false);
  const [exclusionCountsRequested, setExclusionCountsRequested] = useState(false);
  const [cleanupNote, setCleanupNote] = useState("");
  const [cleanupToastKey, setCleanupToastKey] = useState(0);
  const [pendingExclusion, setPendingExclusion] = useState<keyof EnrichExclusions | null>(null);
  const [cleanupNeeded, setCleanupNeeded] = useState<EnrichExclusions>({
    unsubscribed: false,
    existing: false,
  });
  const [preparingSave, setPreparingSave] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeStat, setActiveStat] = useState<StatTab>("net_new");
  const [stats, setStats] = useState({ total: 0, netNew: 0, saved: 0 });
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [facetCounts, setFacetCounts] = useState<Record<string, Record<string, number>>>({});
  const [managementLevelCounts, setManagementLevelCounts] = useState<Record<string, number>>({});
  const [employeeRangeCounts, setEmployeeRangeCounts] = useState<Record<string, number>>({});
  const [peopleSuggestions, setPeopleSuggestions] = useState<PeopleSuggestionRecord[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<Partial<Record<FilterKey, string[]>>>({});
  const [jobTitleFilter, setJobTitleFilter] = useState<JobTitleFilter>(EMPTY_JOB_TITLE_FILTER);
  const [peopleLookalikesFilter, setPeopleLookalikesFilter] = useState<PeopleLookalikesFilter>(
    EMPTY_PEOPLE_LOOKALIKES_FILTER
  );
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>(EMPTY_COMPANY_FILTER);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>(EMPTY_LOCATION_FILTER);
  const [employeesFilter, setEmployeesFilter] = useState<EmployeesFilter>(EMPTY_EMPLOYEES_FILTER);
  const [industryKeywordsFilter, setIndustryKeywordsFilter] = useState<IndustryKeywordsFilter>(
    EMPTY_INDUSTRY_KEYWORDS_FILTER
  );
  const [technologiesFilter, setTechnologiesFilter] = useState<TechnologiesFilter>(
    EMPTY_TECHNOLOGIES_FILTER
  );
  const [revenueFilter, setRevenueFilter] = useState<RevenueFilter>(EMPTY_REVENUE_FILTER);
  const [columnFilters, setColumnFilters] = useState<ColumnFilterState>(
    EMPTY_COLUMN_FILTER_STATE
  );
  const [openSections, setOpenSections] = useState<Partial<Record<FilterKey, boolean>>>({});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [expandedHighlights, setExpandedHighlights] = useState<ExpandedHighlights>(
    EMPTY_EXPANDED_HIGHLIGHTS
  );
  const panelsRef = useRef<HTMLDivElement>(null);
  const [panelsHeight, setPanelsHeight] = useState<number | undefined>(undefined);
  const [listFlash, setListFlash] = useState("");

  useEffect(() => {
    if (!loading) setPendingExclusion(null);
  }, [loading]);

  useEffect(() => {
    const BOTTOM_RESERVE_PX = 72;
    const MIN_HEIGHT_PX = 320;

    function updatePanelsHeight() {
      const el = panelsRef.current;
      const main = el?.closest<HTMLElement>(".content");
      if (!el || !main) return;
      // Scroll-independent offset of the panels row within main.
      const offsetInMain =
        el.getBoundingClientRect().top -
        main.getBoundingClientRect().top +
        main.scrollTop;
      setPanelsHeight(
        Math.max(
          MIN_HEIGHT_PX,
          Math.floor(main.clientHeight - offsetInMain - BOTTOM_RESERVE_PX)
        )
      );
    }

    updatePanelsHeight();
    window.addEventListener("resize", updatePanelsHeight);
    const main = panelsRef.current?.closest(".content");
    const observer =
      main && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updatePanelsHeight)
        : null;
    if (main && observer) observer.observe(main);

    return () => {
      window.removeEventListener("resize", updatePanelsHeight);
      observer?.disconnect();
    };
  }, [isSidebarCollapsed, error]);

  const includeFacetsRef = useRef(true);

  const buildQueryParams = useCallback(
    (options?: {
      idsOnly?: boolean;
      page?: number;
      limit?: number;
      includeFacets?: boolean;
      includeCounts?: boolean;
      includeRecords?: boolean;
    }) => {
      const params = new URLSearchParams({
        page: String(options?.page ?? (showAll ? 1 : page)),
        limit: String(options?.limit ?? (showAll ? SHOW_ALL_LIMIT : PAGE_SIZE)),
        view,
      });
      if (options?.idsOnly) {
        params.set("idsOnly", "true");
      }
      if (options?.includeFacets === false) {
        params.set("includeFacets", "0");
      }
      if (options?.includeCounts === false) {
        params.set("includeCounts", "0");
      }
      if (options?.includeRecords === false) {
        params.set("includeRecords", "0");
      }
      if (search) {
        params.set("search", search);
      }
      params.set("stat", activeStat);
      params.set("filters", JSON.stringify(selectedFilters));
      if (!isJobTitleFilterEmpty(jobTitleFilter)) {
        params.set("jobTitleFilter", JSON.stringify(jobTitleFilter));
      }
      if (!isPeopleLookalikesFilterEmpty(peopleLookalikesFilter)) {
        params.set("peopleLookalikesFilter", JSON.stringify(peopleLookalikesFilter));
      }
      if (!isCompanyFilterEmpty(companyFilter)) {
        params.set("companyFilter", JSON.stringify(companyFilter));
      }
      if (!isLocationFilterEmpty(locationFilter)) {
        params.set("locationFilter", JSON.stringify(locationFilter));
      }
      if (!isEmployeesFilterEmpty(employeesFilter)) {
        params.set("employeesFilter", JSON.stringify(employeesFilter));
      }
      if (!isIndustryKeywordsFilterEmpty(industryKeywordsFilter)) {
        params.set("industryKeywordsFilter", JSON.stringify(industryKeywordsFilter));
      }
      if (!isTechnologiesFilterEmpty(technologiesFilter)) {
        params.set("technologiesFilter", JSON.stringify(technologiesFilter));
      }
      if (!isRevenueFilterEmpty(revenueFilter)) {
        params.set("revenueFilter", JSON.stringify(revenueFilter));
      }
      if (!isColumnFilterStateEmpty(columnFilters)) {
        params.set("columnFilters", JSON.stringify(columnFilters));
      }
      if (exclusions.unsubscribed) {
        params.set("excludeUnsubscribed", "1");
      }
      if (exclusions.existing) {
        params.set("excludeExisting", "1");
      }
      return params;
    },
    [
      activeStat,
      columnFilters,
      companyFilter,
      employeesFilter,
      exclusions,
      industryKeywordsFilter,
      jobTitleFilter,
      locationFilter,
      page,
      peopleLookalikesFilter,
      revenueFilter,
      search,
      selectedFilters,
      showAll,
      technologiesFilter,
      view,
    ]
  );

  const fetchGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const applyRecordsResponse = useCallback((data: RecordsResponse) => {
    setRecords(Array.isArray(data.records) ? (data.records as DataRecordRow[]) : []);
    setTotal(data.total);
    setTotalPages(data.totalPages);
    setStats({
      total: data.stats?.total ?? 0,
      netNew: data.stats?.netNew ?? 0,
      saved: data.stats?.saved ?? 0,
    });
    setExpandedHighlights(data.expandedHighlights ?? EMPTY_EXPANDED_HIGHLIGHTS);
    hasLoadedOnceRef.current = true;
  }, []);

  const fetchRecords = useCallback(async () => {
    // Never block table rows on facet dictionaries — facets load separately.
    const queryString = buildQueryParams({ includeFacets: false }).toString();
    const cacheable = !showAll;
    const cached = cacheable ? getCachedRecords(queryString) : null;
    if (cached) {
      applyRecordsResponse(cached.value);
      setLoading(false);
    }

    // Keep existing rows visible while refetching to avoid a full-screen blink
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = ++fetchGenRef.current;

    try {
      const res = await fetch(`/api/crm/enrich/people?${queryString}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await res.text();
      const data = JSON.parse(body);
      if (gen !== fetchGenRef.current) return;

      if (!res.ok) {
        setError(data.error || "Failed to load data");
        return;
      }

      if (cacheable) setCachedRecords(queryString, data, body);
      if (body !== cached?.body) applyRecordsResponse(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (gen !== fetchGenRef.current) return;
      setError("Failed to load data");
    } finally {
      if (gen === fetchGenRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [applyRecordsResponse, buildQueryParams, showAll]);

  const applyFacetsResponse = useCallback((data: FacetsResponse) => {
    setFacets(data.facets);
    setFacetCounts(data.facetCounts ?? {});
    setManagementLevelCounts(data.managementLevelCounts ?? {});
    setEmployeeRangeCounts(data.employeeRangeCounts ?? {});
    setPeopleSuggestions(data.peopleSuggestions ?? []);
  }, []);

  const fetchFacets = useCallback(async () => {
    if (!includeFacetsRef.current) return;
    const cached = getCachedFacets(view);
    if (cached) {
      applyFacetsResponse(cached.value);
      if (cached.fresh) {
        includeFacetsRef.current = false;
        return;
      }
    }
    try {
      const res = await fetch(
        `/api/crm/enrich/people?${buildQueryParams({
          includeFacets: true,
          includeRecords: false,
          includeCounts: false,
          page: 1,
          limit: 1,
        }).toString()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.facets) return;
      const facetKeys = Object.keys(data.facets);
      if (facetKeys.length === 0) return;

      setCachedFacets(view, data);
      applyFacetsResponse(data);
      includeFacetsRef.current = false;
    } catch {
      // Facets are non-critical; table already loaded.
    }
  }, [applyFacetsResponse, buildQueryParams, view]);

  const pageOptions = useMemo(() => buildPageOptions(page, totalPages), [page, totalPages]);

  const selectionResetKey = useMemo(
    () =>
      JSON.stringify({
        view,
        search,
        activeStat,
        selectedFilters,
        jobTitleFilter,
        peopleLookalikesFilter,
        companyFilter,
        locationFilter,
        employeesFilter,
        industryKeywordsFilter,
        technologiesFilter,
        revenueFilter,
        columnFilters,
      }),
    [
      activeStat,
      columnFilters,
      companyFilter,
      employeesFilter,
      industryKeywordsFilter,
      jobTitleFilter,
      locationFilter,
      peopleLookalikesFilter,
      revenueFilter,
      search,
      selectedFilters,
      technologiesFilter,
      view,
    ]
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionResetKey]);

  useEffect(() => {
    if (!sessionReady) return;
    if (!hasLoadedOnceRef.current) {
      // Not debounced, so cached rows land in the same commit as the facets.
      void fetchRecords();
      return () => abortRef.current?.abort();
    }
    const timer = window.setTimeout(() => void fetchRecords(), 300);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [fetchRecords, sessionReady]);

  useEffect(() => {
    includeFacetsRef.current = true;
  }, [view]);

  useEffect(() => {
    if (!sessionReady) return;
    void fetchFacets();
  }, [fetchFacets, sessionReady]);

  function applyFilterPayload(payload: FilterPresetPayload) {
    setSearch(payload.search ?? "");
    setSearchInput(payload.search ?? "");
    setActiveStat(payload.activeStat ?? "net_new");
    setSelectedFilters(payload.selectedFilters ?? {});
    setJobTitleFilter(payload.jobTitleFilter ?? EMPTY_JOB_TITLE_FILTER);
    setPeopleLookalikesFilter(
      payload.peopleLookalikesFilter ?? EMPTY_PEOPLE_LOOKALIKES_FILTER
    );
    setCompanyFilter(payload.companyFilter ?? EMPTY_COMPANY_FILTER);
    setLocationFilter(payload.locationFilter ?? EMPTY_LOCATION_FILTER);
    setEmployeesFilter(payload.employeesFilter ?? EMPTY_EMPLOYEES_FILTER);
    setIndustryKeywordsFilter(
      payload.industryKeywordsFilter ?? EMPTY_INDUSTRY_KEYWORDS_FILTER
    );
    setTechnologiesFilter(payload.technologiesFilter ?? EMPTY_TECHNOLOGIES_FILTER);
    setRevenueFilter(payload.revenueFilter ?? EMPTY_REVENUE_FILTER);
    setColumnFilters(payload.columnFilters ?? EMPTY_COLUMN_FILTER_STATE);
  }

  function applySessionState(state: DataBrowserSessionState) {
    applyFilterPayload(state);
    setShowAll(Boolean(state.showAll));
    setPage(state.showAll ? 1 : Math.max(1, state.page || 1));
  }

  function resetBrowserStateForView() {
    setPage(1);
    setShowAll(false);
    if (view === "companies") {
      setSelectedFilters((prev) => {
        const next = { ...prev };
        delete next.name;
        delete next.emailStatus;
        return next;
      });
      setJobTitleFilter(EMPTY_JOB_TITLE_FILTER);
      setPeopleLookalikesFilter(EMPTY_PEOPLE_LOOKALIKES_FILTER);
    }
    setColumnFilters(EMPTY_COLUMN_FILTER_STATE);
  }

  useEffect(() => {
    setSessionReady(false);
    hasLoadedOnceRef.current = false;
    clearSessionAfterHardReload(sessionScope);

    let restored = false;
    try {
      const raw = sessionStorage.getItem(AI_PENDING_FILTERS_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as {
          view?: DataView;
          payload?: FilterPresetPayload;
        };
        sessionStorage.removeItem(AI_PENDING_FILTERS_KEY);
        if (pending.view === view && pending.payload) {
          applyFilterPayload(pending.payload);
          setShowAll(false);
          setPage(1);
          restored = true;
        }
      }
    } catch {
      // ignore
    }

    if (!restored) {
      const saved = loadDataBrowserSession(sessionScope);
      if (saved) {
        applySessionState(saved);
        restored = true;
      }
    }

    if (!restored) {
      resetBrowserStateForView();
    }

    setSessionReady(true);
    // Hydrate once per view/list mount from AI handoff or localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sessionScope]);

  useEffect(() => {
    const raw = window.localStorage.getItem(`${SIDEBAR_STORAGE_KEY_PREFIX}-${view}`);
    if (raw !== null) {
      setIsSidebarCollapsed(raw === "true");
    }
  }, [view]);

  useEffect(() => {
    window.localStorage.setItem(
      `${SIDEBAR_STORAGE_KEY_PREFIX}-${view}`,
      String(isSidebarCollapsed)
    );
  }, [isSidebarCollapsed, view]);


  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (records.every((record) => selectedIds.has(record.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        records.forEach((record) => next.delete(record.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        records.forEach((record) => next.add(record.id));
        return next;
      });
    }
  }

  async function selectAllMatching() {
    if (total === 0 || selectingAll) return;

    setSelectingAll(true);
    setError("");

    try {
      const res = await fetch(`/api/crm/enrich/people?${buildQueryParams({ idsOnly: true }).toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to select all records");
        return;
      }

      setSelectedIds(new Set(data.ids ?? []));
    } catch {
      setError("Failed to select all records. Please try again.");
    } finally {
      setSelectingAll(false);
    }
  }

  async function applySelectionMenu(payload: {
    mode: "count" | "page" | "all";
    count: number;
    maxPerCompany: number | null;
  }) {
    if (payload.mode === "page") {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        records.forEach((record) => next.add(record.id));
        return next;
      });
      return;
    }

    if (total === 0 || selectingAll) return;
    setSelectingAll(true);
    setError("");

    try {
      const params = buildQueryParams({ idsOnly: true });
      if (payload.mode === "count") {
        params.set("selectLimit", String(Math.max(1, payload.count)));
        if (payload.maxPerCompany && payload.maxPerCompany > 0) {
          params.set("maxPerCompany", String(payload.maxPerCompany));
        }
      }

      const res = await fetch(`/api/crm/enrich/people?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to apply selection");
        return;
      }
      setSelectedIds(new Set(data.ids ?? []));
    } catch {
      setError("Failed to apply selection. Please try again.");
    } finally {
      setSelectingAll(false);
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const exclusionKey = useMemo(
    () => buildQueryParams({ includeFacets: false, page: 1, limit: 1 }),
    [buildQueryParams]
  );

  const exclusionFiltersApplied = useMemo(
    () => hasAppliedFilters(new URLSearchParams(exclusionKey)),
    [exclusionKey]
  );

  useEffect(() => {
    if (!sessionReady) return;
    if (!exclusionFiltersApplied && !exclusionCountsRequested) {
      setExclusionCounts(null);
      setExclusionCountsLoading(false);
      return;
    }
    const params = new URLSearchParams(exclusionKey);
    params.delete("excludeUnsubscribed");
    params.delete("excludeExisting");
    const controller = new AbortController();
    setExclusionCounts(null);
    setExclusionCountsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/enrich/people/exclusions?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (res.ok) {
          setExclusionCounts({
            unsubscribed: Number(data.unsubscribed || 0),
            existing: Number(data.existing || 0),
          });
        }
      } catch {
        // Counts are informational; the buttons still work without them.
      } finally {
        if (!controller.signal.aborted) setExclusionCountsLoading(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [exclusionKey, sessionReady, exclusionFiltersApplied, exclusionCountsRequested]);

  function toggleExclusion(key: keyof EnrichExclusions) {
    setPage(1);
    setPendingExclusion(key);
    const stillNeeded = { ...cleanupNeeded, [key]: false };
    setCleanupNeeded(stillNeeded);
    setCleanupNote(
      stillNeeded.unsubscribed || stillNeeded.existing ? cleanupMessage(stillNeeded) : ""
    );
    setExclusions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function filtersSummary() {
    const labels = [
      search ? `Search: ${search}` : "",
      ...activeTags.map((tag) => tag.label ?? tag.value),
      ...jobTitleTags.map((tag) => tag.label),
      ...peopleLookalikesTags.map((tag) => tag.label),
      ...companyTags.map((tag) => tag.label),
      ...locationTags.map((tag) => tag.label),
      ...employeesTags.map((tag) => tag.label),
      ...industryKeywordsTags.map((tag) => tag.label),
      ...technologiesTags.map((tag) => tag.label),
      ...revenueTags.map((tag) => tag.label),
    ].filter(Boolean);
    if (labels.length === 0) return "All people";
    return labels.slice(0, 6).join(" · ") + (labels.length > 6 ? " …" : "");
  }

  const saveLimit =
    creditsRemaining == null ? MAX_SAVE_RECORDS : Math.min(MAX_SAVE_RECORDS, creditsRemaining);

  async function handleSaveToList(ids: string[] | null, name?: string) {
    if (preparingSave || total === 0) return;
    setError("");
    if (ids && ids.length > MAX_SAVE_RECORDS) {
      setError(ENRICH_MAX_SAVE_MESSAGE);
      return;
    }
    if (creditsRemaining === 0) {
      setError("No data credits left this month.");
      return;
    }
    let targetIds = ids;
    if (!targetIds || targetIds.length === 0) {
      const countsNotStarted =
        !exclusionCounts && !exclusionFiltersApplied && !exclusionCountsRequested;
      if (exclusionCountsLoading || countsNotStarted) {
        setExclusionCountsRequested(true);
        setCleanupToastKey((current) => current + 1);
        setCleanupNote(
          "Checking for unsubscribed contacts and contacts already in your lists — try again in a moment."
        );
        return;
      }
      const needed = {
        unsubscribed: !exclusions.unsubscribed && (exclusionCounts?.unsubscribed ?? 0) > 0,
        existing: !exclusions.existing && (exclusionCounts?.existing ?? 0) > 0,
      };
      if (needed.unsubscribed || needed.existing) {
        setCleanupNeeded(needed);
        setCleanupToastKey((current) => current + 1);
        setCleanupNote(cleanupMessage(needed));
        return;
      }
      setPreparingSave(true);
      try {
        const params = buildQueryParams({ idsOnly: true });
        params.set("selectLimit", String(saveLimit));
        const res = await fetch(`/api/crm/enrich/people?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to load matches");
          return;
        }
        targetIds = Array.isArray(data.ids) ? (data.ids as string[]) : [];
      } catch {
        setError("Failed to load matches. Please try again.");
        return;
      } finally {
        setPreparingSave(false);
      }
    }
    if (targetIds.length === 0) return;
    setCleanupNote("");
    setCleanupNeeded({ unsubscribed: false, existing: false });
    await onSaveToNewList(
      {
        ids: targetIds,
        filtersSummary: filtersSummary(),
        exclusions,
        exclusionCounts,
      },
      name
    );
  }

  function handleExport() {
    if (selectedIds.size === 0) return;
    void onExport(Array.from(selectedIds));
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function toggleFilterValue(section: FilterKey, value: string) {
    setPage(1);
    setSelectedFilters((prev) => {
      const current = prev[section] ?? [];
      const nextValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const next = { ...prev };
      if (nextValues.length === 0) {
        delete next[section];
      } else {
        next[section] = nextValues;
      }
      return next;
    });
  }

  function setSearchFilter(section: FilterKey, value: string) {
    setPage(1);
    setSelectedFilters((prev) => {
      const next = { ...prev };
      if (value.trim().length === 0) {
        delete next[section];
      } else {
        next[section] = [value.trim()];
      }
      return next;
    });
  }

  function removeJobTitleFilterTag(field: JobTitleFilterTagField, value: string) {
    setPage(1);
    setJobTitleFilter((prev) => ({
      ...prev,
      [field]: prev[field].filter((entry) => entry !== value),
    }));
  }

  function removePeopleLookalikesFilterTag(field: "query" | "workUrls") {
    setPage(1);
    setPeopleLookalikesFilter((prev) => {
      if (field === "query") {
        return { ...prev, query: "", lookalikeOf: undefined };
      }
      return { ...prev, workUrls: "" };
    });
  }

  function removeCompanyFilterTag(field: CompanyFilterTagField, value: string) {
    setPage(1);
    setCompanyFilter((prev) => {
      switch (field) {
        case "include":
          return {
            ...prev,
            include: prev.include.filter((entry) => entry.name !== value),
          };
        case "mode":
          return { ...prev, mode: "is_any_of" };
        case "isNotAnyOf":
          return { ...prev, isNotAnyOf: false };
        case "domainExists":
          return { ...prev, domainExists: false };
        case "includePastCompany":
          return { ...prev, includePastCompany: false };
        case "excludePastCompany":
          return { ...prev, excludePastCompany: false };
        case "includeList":
          return { ...prev, includeList: "" };
        case "excludeList":
          return { ...prev, excludeList: "" };
        default:
          return prev;
      }
    });
  }

  function removeLocationFilterTag(field: LocationFilterTagField, value: string) {
    setPage(1);
    setLocationFilter((prev) => ({
      ...prev,
      [field]: prev[field].filter((entry) => entry !== value),
    }));
  }

  function removeEmployeesFilterTag(field: EmployeesFilterTagField, value: string) {
    setPage(1);
    setEmployeesFilter((prev) => {
      if (field === "predefined") {
        return {
          ...prev,
          predefinedRanges: prev.predefinedRanges.filter((entry) => entry !== value),
        };
      }
      if (field === "customMin") {
        return { ...prev, customMin: "" };
      }
      return { ...prev, customMax: "" };
    });
  }

  function removeIndustryKeywordsFilterTag(
    field: IndustryKeywordsFilterTagField,
    value: string
  ) {
    setPage(1);
    setIndustryKeywordsFilter((prev) => {
      if (field === "industries") {
        return {
          ...prev,
          industries: prev.industries.filter((entry) => entry !== value),
        };
      }
      if (field === "excludeIndustries") {
        return {
          ...prev,
          excludeIndustries: prev.excludeIndustries.filter((entry) => entry !== value),
        };
      }
      if (field === "advancedMode") {
        return { ...prev, advancedMode: null };
      }
      if (field === "keywords") {
        return {
          ...prev,
          keywords: prev.keywords.filter((entry) => entry !== value),
        };
      }
      if (field === "excludeKeywords") {
        return {
          ...prev,
          excludeKeywords: prev.excludeKeywords.filter((entry) => entry !== value),
        };
      }
      return { ...prev, includeAllKeywords: false };
    });
  }

  function removeTechnologiesFilterTag(field: TechnologiesFilterTagField, value: string) {
    setPage(1);
    setTechnologiesFilter((prev) => ({
      ...prev,
      [field]: prev[field].filter((entry) => entry !== value),
    }));
  }

  function removeRevenueFilterTag(field: RevenueFilterTagField) {
    setPage(1);
    setRevenueFilter((prev) => {
      if (field === "mode") {
        return { ...prev, mode: "is_between" };
      }
      if (field === "min") {
        return { ...prev, min: "" };
      }
      if (field === "max") {
        return { ...prev, max: "" };
      }
      return prev;
    });
  }

  function setEmailStatusFilter(values: string[]) {
    setPage(1);
    setSelectedFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) {
        delete next.emailStatus;
      } else {
        next.emailStatus = values;
      }
      return next;
    });
  }

  function setPersonalPhoneFilter(values: string[]) {
    setPage(1);
    setSelectedFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) {
        delete next.personalPhone;
      } else {
        next.personalPhone = values;
      }
      return next;
    });
  }

  function setCompanyPhoneFilter(values: string[]) {
    setPage(1);
    setSelectedFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) {
        delete next.companyPhone;
      } else {
        next.companyPhone = values;
      }
      return next;
    });
  }

  const activeTags = Object.entries(selectedFilters).flatMap(([key, values]) => {
    if (
      key === "company" ||
      key === "location" ||
      key === "employees" ||
      key === "industryKeywords" ||
      key === "technologies" ||
      key === "revenue"
    ) {
      return [];
    }

    if (key === "personalPhone" || key === "companyPhone") {
      const label = phoneFilterLabel(
        key === "personalPhone" ? "personal" : "company",
        values
      );
      if (!label || !values?.length) return [];
      // Use the stored value so removing the chip clears the phone filter.
      return [
        {
          key: key as FilterKey,
          value: values[0],
          label,
        },
      ];
    }

    return (values ?? []).map((value) => ({
      key: key as FilterKey,
      value,
      label:
        key === "emailStatus"
          ? `Email: ${getEmailStatusOptionById(value)?.label ?? value}`
          : key === "name"
            ? `Name: ${value}`
            : undefined,
    }));
  });
  const jobTitleTags = jobTitleActiveTags(jobTitleFilter);
  const peopleLookalikesTags = peopleLookalikesActiveTags(peopleLookalikesFilter);
  const companyTags = companyActiveTags(companyFilter);
  const locationTags = locationActiveTags(locationFilter);
  const employeesTags = employeesActiveTags(employeesFilter);
  const industryKeywordsTags = industryKeywordsActiveTags(industryKeywordsFilter);
  const technologiesTags = technologiesActiveTags(technologiesFilter);
  const revenueTags = revenueActiveTags(revenueFilter);
  const peopleLookalikesActiveCount = peopleLookalikesFilterCount(peopleLookalikesFilter);
  const companyActiveCount = companyFilterCount(companyFilter);
  const locationActiveCount = locationFilterCount(locationFilter);
  const employeesActiveCount = employeesFilterCount(employeesFilter);
  const industryKeywordsActiveCount = industryKeywordsFilterCount(industryKeywordsFilter);
  const technologiesActiveCount = technologiesFilterCount(technologiesFilter);
  const revenueActiveCount = revenueFilterCount(revenueFilter);
  const totalActiveFilters =
    activeTags.length +
    jobTitleTags.length +
    peopleLookalikesActiveCount +
    companyActiveCount +
    locationActiveCount +
    employeesActiveCount +
    industryKeywordsActiveCount +
    technologiesActiveCount +
    revenueActiveCount +
    columnFilters.rules.length;

  function getPresetPayload(): FilterPresetPayload {
    return {
      search,
      activeStat,
      selectedFilters,
      jobTitleFilter,
      peopleLookalikesFilter,
      companyFilter,
      locationFilter,
      employeesFilter,
      industryKeywordsFilter,
      technologiesFilter,
      revenueFilter,
      columnFilters,
    };
  }

  function applyPreset(payload: FilterPresetPayload) {
    setShowAll(false);
    setPage(1);
    applyFilterPayload(payload);
  }

  function applyAiFilters(filters: AiSearchFilters) {
    applyPreset({
      ...aiSearchFiltersToPresetPayload(filters, { activeStat }),
      columnFilters,
    });
  }

  const applyPresetRef = useRef(applyPreset);
  useEffect(() => {
    applyPresetRef.current = applyPreset;
  });

  useEffect(() => {
    function onApply(event: Event) {
      const payload = (event as CustomEvent<FilterPresetPayload>).detail;
      if (!payload) return;
      try {
        sessionStorage.removeItem(AI_PENDING_FILTERS_KEY);
      } catch {
        // ignore
      }
      applyPresetRef.current(payload);
    }
    window.addEventListener(ENRICH_APPLY_FILTERS_EVENT, onApply);
    return () => window.removeEventListener(ENRICH_APPLY_FILTERS_EVENT, onApply);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const timer = window.setTimeout(() => {
      saveDataBrowserSession(sessionScope, {
        ...getPresetPayload(),
        page,
        showAll,
      });
    }, 250);
    return () => window.clearTimeout(timer);
    // Persist working filters/search/page so refresh restores the same place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionReady,
    sessionScope,
    view,
    page,
    showAll,
    search,
    activeStat,
    selectedFilters,
    jobTitleFilter,
    peopleLookalikesFilter,
    companyFilter,
    locationFilter,
    employeesFilter,
    industryKeywordsFilter,
    technologiesFilter,
    revenueFilter,
    columnFilters,
  ]);

  const highlightTechnologies = [
    ...technologiesFilter.include,
    ...technologiesFilter.includeAll,
  ];

  const someSelected = selectedIds.size > 0;
  const allMatchingSelected = total > 0 && selectedIds.size >= total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-500">
            {total} record{total !== 1 ? "s" : ""} total
            {someSelected && ` · ${selectedIds.size.toLocaleString()} selected`}
          </p>
          {total > 0 && !allMatchingSelected && (
            <button
              type="button"
              onClick={() => void selectAllMatching()}
              disabled={loading || selectingAll}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {selectingAll
                ? "Selecting..."
                : `Select all (${total.toLocaleString()})`}
            </button>
          )}
          {someSelected && (
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectingAll}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              Clear selection
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FilterPresetsMenu
            view={view}
            getPayload={getPresetPayload}
            onApply={applyPreset}
          />
          <form onSubmit={handleSearchSubmit} className="relative flex gap-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={view === "people" ? "Search people" : "Search companies"}
              aria-label={view === "people" ? "Search people" : "Search companies"}
              className="w-72 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
            />
            <button
              type="submit"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50"
            >
              Search
            </button>
          </form>

          {someSelected && (
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              {exporting
                ? "Exporting..."
                : `Export ${selectedIds.size} Selected`}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSaveToList(someSelected ? Array.from(selectedIds) : null)}
            disabled={preparingSave || listActionBusy || total === 0}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-slate-800 disabled:opacity-60"
          >
            {preparingSave
              ? "Preparing..."
              : someSelected
                ? `Save ${selectedIds.size.toLocaleString()} to list`
                : `Save ${Math.min(total, saveLimit).toLocaleString()} to list`}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(EXCLUSION_LABELS) as Array<keyof EnrichExclusions>).map((key) => {
          const active = exclusions[key];
          const needsAction = cleanupNeeded[key] && !active;
          const checking =
            exclusionCountsLoading || (pendingExclusion === key && loading);
          const count = exclusionCounts?.[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => toggleExclusion(key)}
              aria-busy={checking}
              className={`enrich-sweep relative inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium shadow-xs transition ${
                checking ? "is-loading " : ""
              }${
                active
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : needsAction
                    ? "border-red-500 bg-white text-red-600 ring-2 ring-red-500/15 hover:bg-red-50"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {active ? "✓ " : ""}
              {EXCLUSION_LABELS[key]}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {count == null
                  ? exclusionCountsLoading
                    ? "…"
                    : "–"
                  : count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {cleanupNote ? (
        <PortalToast
          key={cleanupToastKey}
          message={cleanupNote}
          onDone={() => setCleanupNote("")}
        />
      ) : error ? (
        <PortalToast key={error} message={error} onDone={() => setError("")} />
      ) : null}

      {listFlash ? (
        <PortalToast
          key={listFlash}
          variant="success"
          message={listFlash}
          onDone={() => setListFlash("")}
        />
      ) : null}

      <div
        ref={panelsRef}
        className="flex items-stretch gap-4"
        style={
          panelsHeight
            ? { height: panelsHeight }
            : { minHeight: 320 }
        }
      >
        <FilterSidebar
          view={view}
          collapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
          activeStat={activeStat}
          stats={stats}
          onStatChange={(stat) => {
            setPage(1);
            setActiveStat(stat);
          }}
          activeTags={activeTags}
          jobTitleTags={jobTitleTags}
          peopleLookalikesTags={peopleLookalikesTags}
          companyFilter={companyFilter}
          companyTags={companyTags}
          locationFilter={locationFilter}
          locationTags={locationTags}
          employeesFilter={employeesFilter}
          employeesTags={employeesTags}
          industryKeywordsFilter={industryKeywordsFilter}
          industryKeywordsTags={industryKeywordsTags}
          technologiesFilter={technologiesFilter}
          technologiesTags={technologiesTags}
          revenueFilter={revenueFilter}
          revenueTags={revenueTags}
          employeeRangeCounts={employeeRangeCounts}
          totalActiveFilters={totalActiveFilters}
          facets={facets}
          facetCounts={facetCounts}
          selectedFilters={selectedFilters}
          openSections={openSections}
          onToggleSection={(section) =>
            startTransition(() => {
              setOpenSections((prev) => (prev[section] ? {} : { [section]: true }));
            })
          }
          onToggleFilterValue={toggleFilterValue}
          onSetSearchFilter={setSearchFilter}
          jobTitleFilter={jobTitleFilter}
          onJobTitleFilterChange={(next) => {
            setPage(1);
            setJobTitleFilter(next);
          }}
          onRemoveJobTitleTag={removeJobTitleFilterTag}
          peopleLookalikesFilter={peopleLookalikesFilter}
          peopleSuggestions={peopleSuggestions}
          onPeopleLookalikesFilterChange={(next) => {
            setPage(1);
            setPeopleLookalikesFilter(next);
          }}
          onRemovePeopleLookalikesTag={removePeopleLookalikesFilterTag}
          onCompanyFilterChange={(next) => {
            setPage(1);
            setCompanyFilter(next);
          }}
          onRemoveCompanyTag={removeCompanyFilterTag}
          onLocationFilterChange={(next) => {
            setPage(1);
            setLocationFilter(next);
          }}
          onRemoveLocationTag={removeLocationFilterTag}
          onEmployeesFilterChange={(next) => {
            setPage(1);
            setEmployeesFilter(next);
          }}
          onRemoveEmployeesTag={removeEmployeesFilterTag}
          onIndustryKeywordsFilterChange={(next) => {
            setPage(1);
            setIndustryKeywordsFilter(next);
          }}
          onRemoveIndustryKeywordsTag={removeIndustryKeywordsFilterTag}
          onTechnologiesFilterChange={(next) => {
            setPage(1);
            setTechnologiesFilter(next);
          }}
          onRemoveTechnologiesTag={removeTechnologiesFilterTag}
          onRevenueFilterChange={(next) => {
            setPage(1);
            setRevenueFilter(next);
          }}
          onRemoveRevenueTag={removeRevenueFilterTag}
          onEmailStatusChange={setEmailStatusFilter}
          onPersonalPhoneChange={setPersonalPhoneFilter}
          onCompanyPhoneChange={setCompanyPhoneFilter}
          managementLevelCounts={managementLevelCounts}
          aiAssist={
            <AiFilterBox view={view} facets={facets} onApply={applyAiFilters} />
          }
          onClearAll={() => {
            setPage(1);
            setSelectedFilters({});
            setJobTitleFilter(EMPTY_JOB_TITLE_FILTER);
            setPeopleLookalikesFilter(EMPTY_PEOPLE_LOOKALIKES_FILTER);
            setCompanyFilter(EMPTY_COMPANY_FILTER);
            setLocationFilter(EMPTY_LOCATION_FILTER);
            setEmployeesFilter(EMPTY_EMPLOYEES_FILTER);
            setIndustryKeywordsFilter(EMPTY_INDUSTRY_KEYWORDS_FILTER);
            setTechnologiesFilter(EMPTY_TECHNOLOGIES_FILTER);
            setRevenueFilter(EMPTY_REVENUE_FILTER);
            // Column/table filters stay — clear them via the table filter bar only.
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DataTablePanel
            view={view}
            loading={loading}
            refreshing={isRefreshing}
            records={records}
            tableColumns={tableColumns}
            search={search}
            hasActiveFilters={totalActiveFilters > 0}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            columnFilters={columnFilters}
            onColumnFiltersChange={(next) => {
              setPage(1);
              setColumnFilters(next);
            }}
            onExportSelected={async (ids) => {
              if (ids.length === 0) return;
              await onExport(ids);
            }}
            exporting={exporting}
            fillHeight
            storageKey="portal-enrich-people"
            listOptions={listOptions}
            listsLoading={listsLoading}
            listActionBusy={listActionBusy}
            onAddToList={(listId, ids) => {
              if (ids.length > MAX_SAVE_RECORDS) {
                setError(ENRICH_MAX_SAVE_MESSAGE);
                return;
              }
              return onAddToList(listId, ids);
            }}
            onCreateList={(name, ids) => handleSaveToList(ids, name)}
            totalMatching={total}
            selectingMatching={selectingAll}
            onApplySelectionMenu={applySelectionMenu}
          />
        </div>
      </div>

      {totalPages > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!showAll ? (
            <>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Previous
              </button>
              <div className="flex items-center gap-3">
                <select
                  value={page}
                  onChange={(e) => setPage(Number(e.target.value))}
                  aria-label="Select page"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm shadow-xs"
                >
                  {pageOptions.map((pageOption) => (
                    <option key={pageOption} value={pageOption}>
                      {pageOption}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-slate-500">
                  {(total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1).toLocaleString()}-
                  {Math.min(page * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Next
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Showing all {records.length.toLocaleString()} of {total.toLocaleString()} records
            </p>
          )}

          {total > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => {
                setPage(1);
                setShowAll((value) => !value);
              }}
              disabled={loading}
              className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {showAll ? "Show paginated view" : `Show all (${total.toLocaleString()})`}
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Save to list with nothing selected saves up to{" "}
        {saveLimit.toLocaleString()} matching people
        {saveLimit < MAX_SAVE_RECORDS ? " (limited by your data credits)" : ""}.
      </p>
    </div>
  );
}
