"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  highlightPage: PortalPageId;
  openGroups: Record<PortalNavGroupId, boolean>;
  pathname: string;
  projectName: string;
  projectLogoUrl: string;
};

export default function PortalSidebar({
  collapsed = false,
  onToggleCollapsed,
  highlightPage,
  openGroups,
  pathname,
  projectName,
  projectLogoUrl,
}: PortalSidebarProps) {
  const router = useRouter();
  const [manualOpen, setManualOpen] = useState<
    Partial<Record<PortalNavGroupId, boolean>>
  >({});
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const leaveTimerRef = useRef<number | null>(null);

  const railCollapsed = collapsed && !hoverExpanded;

  useEffect(() => {
    setManualOpen({});
  }, [pathname]);

  useEffect(() => {
    if (!collapsed) {
      setHoverExpanded(false);
    }
  }, [collapsed]);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
      }
    };
  }, []);

  function clearLeaveTimer() {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }

  function handleSidebarEnter() {
    if (!collapsed) return;
    clearLeaveTimer();
    setHoverExpanded(true);
  }

  function handleSidebarLeave() {
    if (!collapsed) return;
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      setHoverExpanded(false);
      leaveTimerRef.current = null;
    }, 160);
  }

  function isGroupOpen(groupId: PortalNavGroupId) {
    if (railCollapsed) {
      return false;
    }
    if (manualOpen[groupId] !== undefined) {
      return Boolean(manualOpen[groupId]);
    }
    return openGroups[groupId];
  }

  function handleGroupClick(groupId: PortalNavGroupId) {
    if (railCollapsed) {
      router.push(PORTAL_GROUP_DEFAULTS[groupId]);
      return;
    }

    const currentlyOpen = isGroupOpen(groupId);

    if (currentlyOpen) {
      setManualOpen((current) => ({ ...current, [groupId]: false }));
      return;
    }

    setManualOpen((current) => ({ ...current, [groupId]: true }));
    if (!openGroups[groupId]) {
      router.push(PORTAL_GROUP_DEFAULTS[groupId]);
    }
  }

  return (
    <>
      {collapsed ? (
        <div className="sidebar-collapsed-spacer" aria-hidden="true" />
      ) : null}
      <aside
        className={`sidebar${collapsed ? " is-collapsed" : ""}${
          collapsed && hoverExpanded ? " is-hover-expanded" : ""
        }`}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
        onFocusCapture={handleSidebarEnter}
        onBlurCapture={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          handleSidebarLeave();
        }}
      >
        <div className="brand">
          <span className="brand-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-logo"
              src="https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png"
              alt="Nexuses"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-mark"
              src="https://cdn-nexlink.s3.us-east-2.amazonaws.com/Group_15_b5d5ad17-292a-47a6-a4e1-636f541568ae.png"
              alt="Nexuses"
            />
          </span>
          {onToggleCollapsed ? (
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
            >
              <IconSidebarToggle className={collapsed ? "is-flipped" : undefined} />
            </button>
          ) : null}
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
                  title={item.label}
                >
                  <Icon />
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            }

            const Icon = getNavIcon(item.id);
            const isOpen = isGroupOpen(item.id);
            const groupActive = item.children.some(
              (child) => highlightPage === child.id,
            );

            return (
              <div key={item.id} className="nav-group">
                <button
                  type="button"
                  data-group={item.id}
                  className={`nav-item${isOpen ? " open" : ""}${
                    railCollapsed && groupActive ? " active" : ""
                  }`}
                  onClick={() => handleGroupClick(item.id)}
                  title={item.label}
                  aria-expanded={isOpen}
                >
                  <Icon />
                  <span className="nav-label">{item.label}</span>
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
        <div className="sidebar-client-meta">Workspace</div>
        <div className="sidebar-client" title={projectName}>
          {projectLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="sidebar-client-logo"
              src={projectLogoUrl}
              alt={`${projectName} logo`}
            />
          ) : (
            <span className="sidebar-client-fallback" aria-hidden="true">
              {projectName.trim().charAt(0).toUpperCase() || "W"}
            </span>
          )}
        </div>
      </div>
    </aside>
    </>
  );
}
