"use client";

import { useEffect, useState } from "react";
import { normalizeViewerTimeZone } from "@/lib/viewer-time-zone";

export function resolveViewerTimeZone(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return normalizeViewerTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/** Browser IANA timezone, available after mount (avoids SSR hydration mismatches). */
export function useViewerTimeZone() {
  const [viewerTimeZone, setViewerTimeZone] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setViewerTimeZone(resolveViewerTimeZone());
    setIsReady(true);
  }, []);

  return { viewerTimeZone, isReady };
}
