import type { RowDensity, SavedTableLayout } from "./types";

const VERSION = "v1";

export function loadTableLayout(storageKey: string): SavedTableLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`table-layout:${VERSION}:${storageKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedTableLayout;
  } catch {
    return null;
  }
}

export function saveTableLayout(storageKey: string, layout: SavedTableLayout) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `table-layout:${VERSION}:${storageKey}`,
      JSON.stringify(layout)
    );
  } catch {
    // ignore quota / private mode
  }
}

export function clearTableLayout(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`table-layout:${VERSION}:${storageKey}`);
  } catch {
    // ignore
  }
}

export function defaultDensity(): RowDensity {
  return "comfortable";
}
