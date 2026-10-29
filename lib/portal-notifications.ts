import { PORTAL_ROUTES } from "@/lib/portal-nav";

export type PortalNotification = {
  id: string;
  title: string;
  body: string;
  href?: string;
  createdAt: string;
};

/**
 * Product announcements shown in the topbar bell.
 * Add a new entry (unique id) when shipping a feature users should notice.
 * Unread count clears after the user opens the notifications panel.
 */
export const PORTAL_NOTIFICATIONS: PortalNotification[] = [
  {
    id: "crm-lead-reports-2026-10",
    title: "CRM Lead Reports",
    body: "Lead reports now live under CRM → Lead Reports. Browse migrated reports or create one from a contact.",
    href: PORTAL_ROUTES["lead-reports"],
    createdAt: "2026-10-29T00:00:00.000Z",
  },
  {
    id: "personalise-email-format-2026-10",
    title: "Personalise email cleanup",
    body: "Messy spreadsheet emails are auto-formatted on upload, with a before → after preview.",
    href: PORTAL_ROUTES.personalise,
    createdAt: "2026-10-29T00:00:00.000Z",
  },
];

const READ_STORAGE_KEY = "portal-notifications-read";

function readIdsFromStorage(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id)).filter(Boolean);
  } catch {
    return [];
  }
}

function writeIdsToStorage(ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
}

export function getReadNotificationIds() {
  return new Set(readIdsFromStorage());
}

export function listPortalNotifications() {
  return [...PORTAL_NOTIFICATIONS].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getUnreadNotifications(readIds = getReadNotificationIds()) {
  return listPortalNotifications().filter((item) => !readIds.has(item.id));
}

export function markNotificationsRead(ids: string[] = PORTAL_NOTIFICATIONS.map((n) => n.id)) {
  const next = [...readIdsFromStorage(), ...ids];
  writeIdsToStorage(next);
  return new Set(next);
}

export function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
