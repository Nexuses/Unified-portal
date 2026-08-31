export type PortalPageId =
  | "dashboard"
  | "contacts"
  | "lists"
  | "segments"
  | "companies"
  | "drip"
  | "oneone"
  | "analytics"
  | "smtp"
  | "unsub";

export type PortalNavGroupId = "crm" | "marketing";

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
  analytics: "/portal/analytics",
  smtp: "/portal/smtp",
  unsub: "/portal/unsub",
};

export const PORTAL_CAMPAIGN_EDIT_ROUTE = "/portal/marketing/campaigns/edit";

export function portalCampaignRoute(id: string) {
  return `/portal/marketing/campaigns/${id}`;
}

export function publicCampaignReportPath(token: string) {
  return `/r/${token}`;
}

export function portalListRoute(id: string) {
  return `/portal/crm/lists/${id}`;
}

export function portalCompanyRoute(id: string) {
  return `/portal/crm/companies/${id}`;
}

export function portalContactRoute(id: string) {
  return `/portal/crm/contacts/${id}`;
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
  {
    type: "group",
    id: "marketing",
    label: "Marketing",
    href: PORTAL_ROUTES.drip,
    children: [
      { id: "drip", label: "Drip Campaign", href: PORTAL_ROUTES.drip },
      { id: "oneone", label: "1-1 Campaign", href: PORTAL_ROUTES.oneone },
    ],
  },
  { type: "item", id: "analytics", label: "Analytics", href: PORTAL_ROUTES.analytics },
  { type: "item", id: "smtp", label: "SMTP & Senders", href: PORTAL_ROUTES.smtp },
  { type: "item", id: "unsub", label: "Suppression List", href: PORTAL_ROUTES.unsub },
];

export const PORTAL_PAGE_TITLES: Record<PortalPageId, string> = {
  dashboard: "Home",
  contacts: "Contacts",
  lists: "Lists",
  segments: "Segments",
  companies: "Companies",
  drip: "Drip Campaign",
  oneone: "1-1 Campaign",
  analytics: "Analytics",
  smtp: "SMTP & Senders",
  unsub: "Suppression List",
};

export const PORTAL_GROUP_DEFAULTS: Record<PortalNavGroupId, string> = {
  crm: PORTAL_ROUTES.contacts,
  marketing: PORTAL_ROUTES.drip,
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
  if (pathname.startsWith("/portal/marketing/campaigns/")) return "drip";
  if (pathname.startsWith("/portal/analytics")) return "analytics";
  if (pathname.startsWith("/portal/smtp")) return "smtp";
  if (pathname.startsWith("/portal/unsub")) return "unsub";
  return "dashboard";
}

export function getOpenGroupsFromPathname(
  pathname: string,
): Record<PortalNavGroupId, boolean> {
  return {
    crm: pathname.startsWith("/portal/crm"),
    marketing: pathname.startsWith("/portal/marketing"),
  };
}

export function getPageTitleFromPathname(pathname: string): string {
  if (pathname.startsWith("/portal/crm/lists/")) return DETAIL_TITLES.list;
  if (pathname.startsWith("/portal/crm/companies/")) return DETAIL_TITLES.company;
  if (pathname.startsWith("/portal/crm/contacts/")) return DETAIL_TITLES.contact;
  if (pathname.startsWith("/portal/marketing/campaigns/")) {
    return DETAIL_TITLES.campaign;
  }

  const pageId = getHighlightPageFromPathname(pathname);
  return PORTAL_PAGE_TITLES[pageId] ?? "Home";
}

export function isNavItemActive(href: string, pathname: string) {
  if (href === "/portal") {
    return pathname === "/portal";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
