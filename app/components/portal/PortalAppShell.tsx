"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getHighlightPageFromPathname,
  getOpenGroupsFromPathname,
  getPageTitleFromPathname,
} from "@/lib/portal-nav";
import PortalAssistant from "./PortalAssistant";
import PortalSidebar from "./PortalSidebar";
import PortalTopbar from "./PortalTopbar";

export type PortalUser = {
  id: string;
  fullName: string;
  email: string;
  projectId: string;
  projectName: string;
  projectLogoUrl?: string;
};

type PortalAppShellProps = {
  user: PortalUser;
  children: React.ReactNode;
};

const SIDEBAR_COLLAPSED_KEY = "portal.sidebar.collapsed";

export default function PortalAppShell({ user, children }: PortalAppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setReady(true);
    try {
      setSidebarCollapsed(
        window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
      );
    } catch {
      // Ignore storage failures.
    }
  }, []);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }

  const highlightPage = useMemo(
    () => getHighlightPageFromPathname(pathname),
    [pathname],
  );
  const openGroups = useMemo(
    () => getOpenGroupsFromPathname(pathname),
    [pathname],
  );
  const pageTitle = useMemo(() => getPageTitleFromPathname(pathname), [pathname]);
  const isLeadReportView =
    /^\/portal\/crm\/contacts\/[^/]+$/.test(pathname) &&
    searchParams.get("view") === "lead-report";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!ready) {
    return <div className="portal-loading-screen">Loading your workspace...</div>;
  }

  if (pathname.startsWith("/portal/marketing/edm")) {
    return <div className="edm-shell">{children}</div>;
  }

  if (isLeadReportView) {
    return <div className="lead-report-shell">{children}</div>;
  }

  if (pathname.startsWith("/portal/smtp/assistant")) {
    return <div className="project-agent-shell">{children}</div>;
  }

  return (
    <div className={`shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <PortalSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        highlightPage={highlightPage}
        openGroups={openGroups}
        pathname={pathname}
        projectName={user.projectName}
        projectLogoUrl={user.projectLogoUrl ?? ""}
      />

      <div className="main">
        <PortalTopbar
          fullName={user.fullName}
          projectName={user.projectName}
          pageTitle={pageTitle}
          onLogout={handleLogout}
        />

        <div
          className={`content${pathname.startsWith("/portal/crm") ? " crm-content" : ""}${
            pathname === "/portal/marketing/automation" ||
            /^\/portal\/marketing\/automation\/[^/]+$/.test(pathname)
              ? " auto-content"
              : ""
          }`}
        >
          {children}
        </div>
      </div>
      <PortalAssistant projectId={user.projectId} projectName={user.projectName} />
    </div>
  );
}
