"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getHighlightPageFromPathname,
  getOpenGroupsFromPathname,
  getPageTitleFromPathname,
} from "@/lib/portal-nav";
import PortalSidebar from "./PortalSidebar";
import PortalTopbar from "./PortalTopbar";

export type PortalUser = {
  id: string;
  fullName: string;
  email: string;
  projectId: string;
  projectName: string;
};

type PortalAppShellProps = {
  user: PortalUser;
  children: React.ReactNode;
};

export default function PortalAppShell({ user, children }: PortalAppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const highlightPage = useMemo(
    () => getHighlightPageFromPathname(pathname),
    [pathname],
  );
  const openGroups = useMemo(
    () => getOpenGroupsFromPathname(pathname),
    [pathname],
  );
  const pageTitle = useMemo(() => getPageTitleFromPathname(pathname), [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!ready) {
    return <div className="portal-loading-screen">Loading your workspace...</div>;
  }

  return (
    <div className="shell">
      <PortalSidebar
        highlightPage={highlightPage}
        openGroups={openGroups}
        pathname={pathname}
        projectName={user.projectName}
      />

      <div className="main">
        <PortalTopbar
          fullName={user.fullName}
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
    </div>
  );
}
