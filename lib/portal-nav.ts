export type PortalPageId =
  | "dashboard"
  | "contacts"
  | "lists"
  | "segments"
  | "companies"
  | "enrich"
  | "drip"
  | "oneone"
  | "automation"
  | "automation-history"
  | "personalise"
  | "edm"
  | "analytics"
  | "analytics-kanban"
  | "smtp"
  | "branding"
  | "knowledge"
  | "inbox"
  | "activity"
  | "files"
  | "unsub"
  | "integrations";

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
  enrich: "/portal/crm/enrich",
  drip: "/portal/marketing/drip",
  oneone: "/portal/marketing/one-one",
  automation: "/portal/marketing/automation",
  "automation-history": "/portal/marketing/automation-history",
  personalise: "/portal/marketing/personalise",
  edm: "/portal/marketing/edm",
  analytics: "/portal/analytics",
  "analytics-kanban": "/portal/analytics/kanban",
  smtp: "/portal/smtp",
  branding: "/portal/branding",
  knowledge: "/portal/knowledge-base",
  inbox: "/portal/inbox",
  activity: "/portal/activity",
  files: "/portal/file-manager",
  unsub: "/portal/unsub",
  integrations: "/portal/integrations",
};

export const PORTAL_CAMPAIGN_EDIT_ROUTE = "/portal/marketing/campaigns/edit";

export function portalCampaignRoute(id: string, kind?: string, tags?: string[]) {
  const campaignId = encodeURIComponent(id);
  if (tags?.includes("personalise")) {
    return `${PORTAL_ROUTES.personalise}/${campaignId}`;
  }
  if (kind === "oneone") {
    return `/portal/marketing/one-one/${campaignId}`;
  }
  return `/portal/marketing/campaigns/${campaignId}`;
}

export function campaignListRoute(kind?: string, tags?: string[]) {
  if (tags?.includes("personalise")) {
    return PORTAL_ROUTES.personalise;
  }
  return kind === "oneone" ? PORTAL_ROUTES.oneone : PORTAL_ROUTES.drip;
}

export function publicCampaignReportPath(
  token: string,
  options?: { analyticsToken?: string; hideBotClicks?: boolean },
) {
  const path = `/r/${encodeURIComponent(token)}`;
  const params = new URLSearchParams();
  if (options?.analyticsToken) {
    params.set("a", options.analyticsToken);
  }
  if (typeof options?.hideBotClicks === "boolean") {
    params.set("hideBotClicks", options.hideBotClicks ? "1" : "0");
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function publicAnalyticsPath(token: string) {
  return `/a/${token}`;
}

export function publicKanbanPath(token: string) {
  return `/k/${token}`;
}

export function publicLeadReportPath(token: string) {
  return `/l/${encodeURIComponent(token)}`;
}

export function portalListRoute(id: string) {
  return `/portal/crm/lists/${id}`;
}

export function portalCompanyRoute(id: string) {
  return `/portal/crm/companies/${id}`;
}

export function portalContactRoute(
  id: string,
  from?: string,
  options?: { view?: "lead-report" },
) {
  const path = `/portal/crm/contacts/${id}`;
  const params = new URLSearchParams();
  if (from && from.startsWith("/portal/") && !from.startsWith("//")) {
    params.set("from", from);
  }
  if (options?.view) {
    params.set("view", options.view);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
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
      { id: "enrich", label: "Enrich", href: PORTAL_ROUTES.enrich },
    ],
  },
  {
    type: "item",
    id: "analytics-kanban",
    label: "Pipeline",
    href: PORTAL_ROUTES["analytics-kanban"],
  },
  {
    type: "item",
    id: "branding",
    label: "Branding",
    href: PORTAL_ROUTES.branding,
  },
  {
    type: "item",
    id: "knowledge",
    label: "Knowledge Base",
    href: PORTAL_ROUTES.knowledge,
  },
  { type: "item", id: "inbox", label: "Master Inbox", href: PORTAL_ROUTES.inbox },
  {
    type: "item",
    id: "files",
    label: "File Manager",
    href: PORTAL_ROUTES.files,
  },
  {
    type: "group",
    id: "marketing",
    label: "Marketing",
    href: PORTAL_ROUTES.drip,
    children: [
      { id: "drip", label: "Drip Campaign", href: PORTAL_ROUTES.drip },
      { id: "oneone", label: "1-1 Campaign", href: PORTAL_ROUTES.oneone },
      { id: "personalise", label: "Personalise Campaign", href: PORTAL_ROUTES.personalise },
      { id: "automation", label: "Automation", href: PORTAL_ROUTES.automation },
      { id: "edm", label: "EDM generation", href: PORTAL_ROUTES.edm },
    ],
  },
  {
    type: "item",
    id: "analytics",
    label: "Analytics",
    href: PORTAL_ROUTES.analytics,
  },
  {
    type: "item",
    id: "activity",
    label: "Activity Feed",
    href: PORTAL_ROUTES.activity,
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
  enrich: "Enrich",
  drip: "Drip Campaign",
  oneone: "1-1 Campaign",
  personalise: "Personalise Campaign",
  automation: "Automation",
  "automation-history": "Automation history",
  edm: "EDM generation",
  analytics: "Analytics",
  "analytics-kanban": "Pipeline",
  smtp: "SMTP & Senders",
  branding: "Branding",
  knowledge: "Knowledge Base",
  inbox: "Master Inbox",
  activity: "Activity Feed",
  files: "File Manager",
  unsub: "Suppression List",
  integrations: "Integrations",
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

export function getOpenGroupsFromPathname(
  pathname: string,
): Record<PortalNavGroupId, boolean> {
  return {
    crm: pathname.startsWith("/portal/crm"),
    marketing: pathname.startsWith("/portal/marketing"),
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
  if (pathname.startsWith("/portal/analytics/kanban")) return "Pipeline";

  const pageId = getHighlightPageFromPathname(pathname);
  return PORTAL_PAGE_TITLES[pageId] ?? "Home";
}

export function isNavItemActive(href: string, pathname: string) {
  if (href === "/portal" || href === "/portal/analytics") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
