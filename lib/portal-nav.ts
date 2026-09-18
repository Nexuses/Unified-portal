export type PortalPageId =
  | "dashboard"
  | "contacts"
  | "lists"
  | "segments"
  | "companies"
  | "drip"
  | "oneone"
  | "automation"
  | "automation-history"
  | "analytics"
  | "analytics-kanban"
  | "smtp"
  | "inbox"
  | "unsub"
  | "integrations";

export type PortalNavGroupId = "crm" | "marketing" | "analytics";

export type PortalSubNavItem = {
  id: PortalPageId;
  label: string;
  href: string;
};

export type PortalNavItem =
  | {
      type: "item";
      id: PortalPageId;
      label: string;
      href: string;
    }
  | {
      type: "group";
      id: PortalNavGroupId;
      label: string;
      href: string;
      children: PortalSubNavItem[];
    };

export const PORTAL_ROUTES: Record<PortalPageId, string> = {
  dashboard: "/portal",
  contacts: "/portal/crm/contacts",
  lists: "/portal/crm/lists",
  segments: "/portal/crm/segments",
  companies: "/portal/crm/companies",
  drip: "/portal/marketing/drip",
  oneone: "/portal/marketing/one-one",
  automation: "/portal/marketing/automation",
  "automation-history": "/portal/marketing/automation-history",
  analytics: "/portal/analytics",
  "analytics-kanban": "/portal/analytics/kanban",
  smtp: "/portal/smtp",
  inbox: "/portal/inbox",
  unsub: "/portal/unsub",
  integrations: "/portal/integrations",
};

export const PORTAL_CAMPAIGN_EDIT_ROUTE = "/portal/marketing/campaigns/edit";

export function portalCampaignRoute(id: string, kind?: string) {
  if (kind === "oneone") {
    return `/portal/marketing/one-one/${encodeURIComponent(id)}`;
  }
  return `/portal/marketing/campaigns/${encodeURIComponent(id)}`;
}

export function campaignListRoute(kind?: string) {
  return kind === "oneone" ? PORTAL_ROUTES.oneone : PORTAL_ROUTES.drip;
}

export function publicCampaignReportPath(
  token: string,
  options?: { analyticsToken?: string },
) {
  const path = `/r/${encodeURIComponent(token)}`;
  if (options?.analyticsToken) {
    return `${path}?a=${encodeURIComponent(options.analyticsToken)}`;
  }
  return path;
}

export function publicAnalyticsPath(token: string) {
  return `/a/${token}`;
}

export function portalListRoute(id: string) {
  return `/portal/crm/lists/${id}`;
}

export function portalCompanyRoute(id: string) {
  return `/portal/crm/companies/${id}`;
}

export function portalContactRoute(id: string, from?: string) {
  const path = `/portal/crm/contacts/${id}`;
  if (!from || !from.startsWith("/portal/") || from.startsWith("//")) {
    return path;
  }
  return `${path}?from=${encodeURIComponent(from)}`;
}

export function portalReturnPath(from: string | undefined, fallback: string) {
  if (!from || !from.startsWith("/portal/") || from.startsWith("//")) {
    return fallback;
  }
  return from;
}

export const PORTAL_NAV: PortalNavItem[] = [
  { type: "item", id: "dashboard", label: "Home", href: PORTAL_ROUTES.dashboard },
  {
    type: "group",
    id: "crm",
    label: "CRM",
    href: PORTAL_ROUTES.contacts,
    children: [
      { id: "contacts", label: "Contacts", href: PORTAL_ROUTES.contacts },
      { id: "lists", label: "Lists", href: PORTAL_ROUTES.lists },
      { id: "segments", label: "Segments", href: PORTAL_ROUTES.segments },
      { id: "companies", label: "Companies", href: PORTAL_ROUTES.companies },
    ],
  },
  { type: "item", id: "inbox", label: "Master Inbox", href: PORTAL_ROUTES.inbox },
  {
    type: "group",
    id: "marketing",
    label: "Marketing",
    href: PORTAL_ROUTES.drip,
    children: [
      { id: "drip", label: "Drip Campaign", href: PORTAL_ROUTES.drip },
      { id: "oneone", label: "1-1 Campaign", href: PORTAL_ROUTES.oneone },
      { id: "automation", label: "Automation", href: PORTAL_ROUTES.automation },
      {
        id: "automation-history",
        label: "Automation history",
        href: PORTAL_ROUTES["automation-history"],
      },
    ],
  },
  {
    type: "group",
    id: "analytics",
    label: "Analytics",
    href: PORTAL_ROUTES.analytics,
    children: [
      { id: "analytics", label: "Report", href: PORTAL_ROUTES.analytics },
      {
        id: "analytics-kanban",
        label: "Kanban",
        href: PORTAL_ROUTES["analytics-kanban"],
      },
    ],
  },
  { type: "item", id: "smtp", label: "SMTP & Senders", href: PORTAL_ROUTES.smtp },
  { type: "item", id: "unsub", label: "Suppression List", href: PORTAL_ROUTES.unsub },
  {
    type: "item",
    id: "integrations",
    label: "Integrations",
    href: PORTAL_ROUTES.integrations,
  },
];

export const PORTAL_PAGE_TITLES: Record<PortalPageId, string> = {
  dashboard: "Home",
  contacts: "Contacts",
  lists: "Lists",
  segments: "Segments",
  companies: "Companies",
  drip: "Drip Campaign",
  oneone: "1-1 Campaign",
  automation: "Automation",
  "automation-history": "Automation history",
  analytics: "Report",
  "analytics-kanban": "Kanban",
  smtp: "SMTP & Senders",
  inbox: "Master Inbox",
  unsub: "Suppression List",
  integrations: "Integrations",
};

export const PORTAL_GROUP_DEFAULTS: Record<PortalNavGroupId, string> = {
  crm: PORTAL_ROUTES.contacts,
  marketing: PORTAL_ROUTES.drip,
  analytics: PORTAL_ROUTES.analytics,
};

const DETAIL_TITLES: Record<string, string> = {
  list: "List",
  company: "Company",
  contact: "Contact",
  campaign: "Campaign",
};

export function getHighlightPageFromPathname(pathname: string): PortalPageId {
  if (pathname.startsWith("/portal/crm/contacts")) return "contacts";
  if (pathname.startsWith("/portal/crm/lists")) return "lists";
  if (pathname.startsWith("/portal/crm/segments")) return "segments";
  if (pathname.startsWith("/portal/crm/companies")) return "companies";
  if (pathname.startsWith("/portal/marketing/drip")) return "drip";
  if (pathname.startsWith("/portal/marketing/one-one")) return "oneone";
  if (pathname.startsWith("/portal/marketing/automation-history")) {
    return "automation-history";
  }
  if (pathname.startsWith("/portal/marketing/automation")) return "automation";
  if (pathname.startsWith("/portal/marketing/campaigns/")) return "drip";
  if (pathname.startsWith("/portal/analytics/kanban")) return "analytics-kanban";
  if (pathname.startsWith("/portal/analytics")) return "analytics";
  if (pathname.startsWith("/portal/smtp")) return "smtp";
  if (pathname.startsWith("/portal/inbox")) return "inbox";
  if (pathname.startsWith("/portal/unsub")) return "unsub";
  if (pathname.startsWith("/portal/integrations")) return "integrations";
  return "dashboard";
}

export function getOpenGroupsFromPathname(
  pathname: string,
): Record<PortalNavGroupId, boolean> {
  return {
    crm: pathname.startsWith("/portal/crm"),
    marketing: pathname.startsWith("/portal/marketing"),
    analytics: pathname.startsWith("/portal/analytics"),
  };
}

export function getPageTitleFromPathname(pathname: string): string {
  if (pathname === "/portal/crm/lists/new") return "Create new list";
  if (pathname.startsWith("/portal/crm/lists/")) return DETAIL_TITLES.list;
  if (pathname.startsWith("/portal/crm/companies/")) return DETAIL_TITLES.company;
  if (pathname.startsWith("/portal/crm/contacts/")) return DETAIL_TITLES.contact;
  if (pathname.startsWith("/portal/marketing/one-one/")) return DETAIL_TITLES.campaign;
  if (pathname.startsWith("/portal/marketing/campaigns/")) {
    return DETAIL_TITLES.campaign;
  }
  if (pathname.startsWith("/portal/analytics/kanban/")) return "Kanban";

  const pageId = getHighlightPageFromPathname(pathname);
  return PORTAL_PAGE_TITLES[pageId] ?? "Home";
}

export function isNavItemActive(href: string, pathname: string) {
  if (href === "/portal" || href === "/portal/analytics") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
