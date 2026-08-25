"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isNavItemActive,
  PORTAL_GROUP_DEFAULTS,
  PORTAL_NAV,
  type PortalNavGroupId,
  type PortalPageId,
} from "@/lib/portal-nav";
import { getNavIcon, IconSidebarToggle } from "./PortalIcons";

type PortalSidebarProps = {
  highlightPage: PortalPageId;
  openGroups: Record<PortalNavGroupId, boolean>;
  pathname: string;
  projectName: string;
};

export default function PortalSidebar({
  highlightPage,
  openGroups,
  pathname,
  projectName,
}: PortalSidebarProps) {
  const router = useRouter();

  function handleGroupClick(groupId: PortalNavGroupId, href: string) {
    if (openGroups[groupId] && isNavItemActive(href, pathname)) {
      return;
    }

    router.push(PORTAL_GROUP_DEFAULTS[groupId]);
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-left">Nexuses</span>
        <button
          type="button"
          className="brand-toggle"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <IconSidebarToggle />
        </button>
      </div>

      <nav className="nav">
        {PORTAL_NAV.map((item) => {
          if (item.type === "item") {
            const Icon = getNavIcon(item.id);
            const isActive = isNavItemActive(item.href, pathname);

            return (
              <Link
                key={item.id}
                href={item.href}
                data-page={item.id}
                className={`nav-item${isActive ? " active" : ""}`}
              >
                <Icon />
                {item.label}
              </Link>
            );
          }

          const Icon = getNavIcon(item.id);
          const isOpen = openGroups[item.id];
          const isGroupActive = item.children.some((child) =>
            isNavItemActive(child.href, pathname),
          );

          return (
            <div key={item.id} className="nav-group">
              <button
                type="button"
                data-group={item.id}
                className={`nav-item${isOpen ? " open" : ""}${isGroupActive ? " active" : ""}`}
                onClick={() => handleGroupClick(item.id, item.href)}
              >
                <Icon />
                {item.label}
              </button>
              <div
                className={`sub-nav${isOpen ? " open" : ""}`}
                data-group={item.id}
              >
                {item.children.map((child) => (
                  <Link
                    key={child.id}
                    href={child.href}
                    data-page={child.id}
                    className={`sub-item${highlightPage === child.id ? " active" : ""}`}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        Workspace
        <br />
        <strong style={{ color: "var(--ink)" }}>{projectName}</strong>
      </div>
    </aside>
  );
}
