"use client";

import { useEffect } from "react";

type PublicPageAnalyticsProps = {
  publicId: string;
};

const VISITOR_KEY = "nexuses_event_vid";

function getOrCreateVisitorId() {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY)?.trim();
    if (existing) {
      return existing;
    }
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function PublicPageAnalytics({ publicId }: PublicPageAnalyticsProps) {
  useEffect(() => {
    if (!publicId) {
      return;
    }

    const visitorId = getOrCreateVisitorId();
    const payload = {
      visitorId,
      path: window.location.pathname,
      referrer: document.referrer || "",
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      screen: `${window.screen.width}x${window.screen.height}`,
    };

    const url = `/api/public-events/${encodeURIComponent(publicId)}/analytics`;
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, [publicId]);

  return null;
}
