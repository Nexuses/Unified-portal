import type { FilterPresetPayload } from "@/lib/people/filter-presets";

export type DataBrowserSessionState = FilterPresetPayload & {
  page: number;
  showAll: boolean;
};

const VERSION = "v1";

function storageKey(scope: string) {
  return `data-browser-session:${VERSION}:${scope}`;
}

export function loadDataBrowserSession(
  scope: string
): DataBrowserSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const data = parsed as Record<string, unknown>;
    const page =
      typeof data.page === "number" && Number.isFinite(data.page) && data.page >= 1
        ? Math.floor(data.page)
        : 1;

    return {
      ...(data as unknown as FilterPresetPayload),
      search: typeof data.search === "string" ? data.search : "",
      activeStat:
        data.activeStat === "total" ||
        data.activeStat === "net_new" ||
        data.activeStat === "saved"
          ? data.activeStat
          : "net_new",
      page,
      showAll: Boolean(data.showAll),
    };
  } catch {
    return null;
  }
}

export function saveDataBrowserSession(
  scope: string,
  state: DataBrowserSessionState
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export function clearDataBrowserSession(scope: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(scope));
  } catch {
    // ignore
  }
}
