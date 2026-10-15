import type { ColumnFilterState } from "@/lib/people/column-filters";
import type {
  CompanyFilter,
  EmployeesFilter,
  IndustryKeywordsFilter,
  JobTitleFilter,
  LocationFilter,
  PeopleLookalikesFilter,
  RevenueFilter,
  TechnologiesFilter,
} from "@/lib/people/data-browser/types";
import type { DataView } from "@/lib/people/data-views";

export type StatTab = "total" | "net_new" | "saved";

export type FilterPresetPayload = {
  search: string;
  activeStat: StatTab;
  selectedFilters: Partial<Record<string, string[]>>;
  jobTitleFilter: JobTitleFilter;
  peopleLookalikesFilter: PeopleLookalikesFilter;
  companyFilter: CompanyFilter;
  locationFilter: LocationFilter;
  employeesFilter: EmployeesFilter;
  industryKeywordsFilter: IndustryKeywordsFilter;
  technologiesFilter: TechnologiesFilter;
  revenueFilter: RevenueFilter;
  columnFilters: ColumnFilterState;
};

export type FilterPreset = {
  id: string;
  name: string;
  view: DataView;
  createdAt: string;
  payload: FilterPresetPayload;
};

const VERSION = "v1";

function storageKey(view: DataView) {
  return `filter-presets:${VERSION}:${view}`;
}

export function loadFilterPresets(view: DataView): FilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(view));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is FilterPreset =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as FilterPreset).id === "string" &&
        typeof (entry as FilterPreset).name === "string" &&
        (entry as FilterPreset).view === view &&
        Boolean((entry as FilterPreset).payload)
    );
  } catch {
    return [];
  }
}

export function saveFilterPresets(view: DataView, presets: FilterPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(view), JSON.stringify(presets));
  } catch {
    // ignore quota / private mode
  }
}

export function createFilterPreset(
  view: DataView,
  name: string,
  payload: FilterPresetPayload
): FilterPreset {
  return {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Untitled preset",
    view,
    createdAt: new Date().toISOString(),
    payload,
  };
}
