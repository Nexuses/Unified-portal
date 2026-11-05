import {
  PORTAL_NAV,
  PORTAL_PAGE_TITLES,
  PORTAL_ROUTES,
  type PortalNavItem,
  type PortalPageId,
} from "@/lib/portal-nav";

export type AssignableNavOption = {
  id: PortalPageId;
  label: string;
  section: string;
};

const ALL_PAGE_IDS = Object.keys(PORTAL_PAGE_TITLES) as PortalPageId[];

/** Nav pages an admin can grant to a client-share login. */
export function listAssignableNavOptions(): AssignableNavOption[] {
  const options: AssignableNavOption[] = [];

  for (const item of PORTAL_NAV) {
    if (item.type === "item") {
      options.push({
        id: item.id,
        label: item.label,
        section: "General",
      });
      continue;
    }

    for (const child of item.children) {
      options.push({
        id: child.id,
        label: child.label,
        section: item.label,
      });
    }
  }

  options.push({
    id: "project-assistant",
    label: "Project AI Assistant",
    section: "SMTP & Senders",
  });

  return options;
}

export function normalizeAllowedNavPages(
  value: unknown,
): PortalPageId[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<PortalPageId>();
  for (const entry of value) {
    const id = String(entry ?? "").trim() as PortalPageId;
    if ((ALL_PAGE_IDS as readonly string[]).includes(id)) {
      allowed.add(id);
    }
  }
  return [...allowed];
}

export function hasFullPortalNav(
  allowed: PortalPageId[] | null | undefined,
): boolean {
  return allowed == null;
}

export function isPortalPageAllowed(
  pageId: PortalPageId,
  allowed: PortalPageId[] | null | undefined,
): boolean {
  if (hasFullPortalNav(allowed)) {
    return true;
  }
  return allowed!.includes(pageId);
}

export function isPortalPathAllowed(
  pathname: string,
  allowed: PortalPageId[] | null | undefined,
): boolean {
  if (hasFullPortalNav(allowed)) {
    return true;
  }
  const pageId = getHighlightPageFromPathnameForAccess(pathname);
  return isPortalPageAllowed(pageId, allowed);
}

function getHighlightPageFromPathnameForAccess(pathname: string): PortalPageId {
  // Keep in sync with portal-nav highlight rules for access checks.
  if (pathname.startsWith("/portal/crm/contacts")) return "contacts";
  if (pathname.startsWith("/portal/crm/lead-reports")) return "lead-reports";
  if (pathname.startsWith("/portal/crm/lists")) return "lists";
  if (pathname.startsWith("/portal/crm/segments")) return "segments";
  if (pathname.startsWith("/portal/crm/companies")) return "companies";
  if (pathname.startsWith("/portal/crm/enrich")) return "enrich";
  if (pathname.startsWith("/portal/marketing/drip")) return "drip";
  if (pathname.startsWith("/portal/marketing/one-one")) return "oneone";
  if (pathname.startsWith("/portal/marketing/personalise")) return "personalise";
  if (pathname.startsWith("/portal/marketing/edm")) return "edm";
  if (pathname.startsWith("/portal/marketing/automation-history")) {
    return "automation-history";
  }
  if (pathname.startsWith("/portal/marketing/automation")) return "automation";
  if (pathname.startsWith("/portal/marketing/campaigns/")) return "drip";
  if (pathname.startsWith("/portal/analytics/kanban")) return "analytics-kanban";
  if (pathname.startsWith("/portal/analytics")) return "analytics";
  if (pathname.startsWith("/portal/smtp/assistant")) return "project-assistant";
  if (pathname.startsWith("/portal/smtp/health")) return "smtp-health";
  if (pathname.startsWith("/portal/smtp")) return "smtp";
  if (pathname.startsWith("/portal/branding")) return "branding";
  if (pathname.startsWith("/portal/knowledge-base")) return "knowledge";
  if (pathname.startsWith("/portal/inbox")) return "inbox";
  if (pathname.startsWith("/portal/activity")) return "activity";
  if (pathname.startsWith("/portal/file-manager")) return "files";
  if (pathname.startsWith("/portal/unsub")) return "unsub";
  if (pathname.startsWith("/portal/integrations")) return "integrations";
  return "dashboard";
}

export function filterPortalNav(
  nav: PortalNavItem[],
  allowed: PortalPageId[] | null | undefined,
): PortalNavItem[] {
  if (hasFullPortalNav(allowed)) {
    return nav;
  }

  const allowedSet = new Set(allowed);
  const filtered: PortalNavItem[] = [];

  for (const item of nav) {
    if (item.type === "item") {
      if (allowedSet.has(item.id)) {
        filtered.push(item);
      }
      continue;
    }

    const children = item.children.filter((child) => allowedSet.has(child.id));
    if (children.length === 0) {
      continue;
    }

    filtered.push({
      ...item,
      href: children[0].href,
      children,
    });
  }

  return filtered;
}

/** First allowed route for redirects (prefers Home when allowed). */
export function defaultPortalLandingHref(
  allowed: PortalPageId[],
): string {
  if (allowed.includes("dashboard")) {
    return PORTAL_ROUTES.dashboard;
  }
  const options = listAssignableNavOptions();
  for (const option of options) {
    if (allowed.includes(option.id)) {
      return PORTAL_ROUTES[option.id];
    }
  }
  return PORTAL_ROUTES.dashboard;
}
