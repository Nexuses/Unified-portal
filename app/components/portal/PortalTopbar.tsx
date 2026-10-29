"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatNotificationDate,
  getReadNotificationIds,
  getUnreadNotifications,
  listPortalNotifications,
  markNotificationsRead,
  PORTAL_NOTIFICATIONS,
  type PortalNotification,
} from "@/lib/portal-notifications";
import ApiCreditButton from "./ApiCreditButton";
import { IconBell, IconChevronDown } from "./PortalIcons";

type PortalTopbarProps = {
  fullName: string;
  pageTitle: string;
  onLogout: () => void;
};

type OpenMenu = "notifications" | "user" | null;
type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "portal-theme";

function getInitials(fullName: string) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function applyTheme(theme: ThemeMode) {
  const root = document.querySelector(".portal-route");
  if (root instanceof HTMLElement) {
    root.setAttribute("data-theme", theme);
  }
  document.documentElement.setAttribute("data-theme", theme);
}

export default function PortalTopbar({
  fullName,
  pageTitle,
  onLogout,
}: PortalTopbarProps) {
  const firstName = fullName.split(" ")[0] ?? fullName;
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [seenInPanel, setSeenInPanel] = useState<Set<string>>(new Set());
  const menusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReadIds(getReadNotificationIds());
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    applyTheme(stored === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menusRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const unread = useMemo(
    () => getUnreadNotifications(readIds),
    [readIds],
  );
  const unreadCount = unread.length;
  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  function toggleMenu(menu: Exclude<OpenMenu, null>) {
    setOpenMenu((current) => {
      const next = current === menu ? null : menu;
      if (next === "notifications") {
        const unreadIds = getUnreadNotifications(readIds).map((item) => item.id);
        setSeenInPanel(new Set(unreadIds));
        const nextRead = markNotificationsRead(
          PORTAL_NOTIFICATIONS.map((item) => item.id),
        );
        setReadIds(nextRead);
      } else if (menu === "notifications") {
        setSeenInPanel(new Set());
      }
      return next;
    });
  }

  function notificationItem(item: PortalNotification, isUnread: boolean) {
    const content = (
      <>
        <div className="top-notif-head">
          <strong>{item.title}</strong>
          {isUnread ? <span className="top-notif-dot" aria-hidden="true" /> : null}
        </div>
        <p>{item.body}</p>
        <span className="top-notif-date">{formatNotificationDate(item.createdAt)}</span>
      </>
    );

    if (item.href) {
      return (
        <Link
          key={item.id}
          href={item.href}
          className={`top-notif-item${isUnread ? " is-unread" : ""}`}
          role="menuitem"
          onClick={() => setOpenMenu(null)}
        >
          {content}
        </Link>
      );
    }

    return (
      <div
        key={item.id}
        className={`top-notif-item${isUnread ? " is-unread" : ""}`}
        role="menuitem"
      >
        {content}
      </div>
    );
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 id="pageTitle">{pageTitle}</h1>
      </div>
      <div className="topbar-right" ref={menusRef}>
        <ApiCreditButton onOpen={() => setOpenMenu(null)} />
        <div className="org-menu">
          <button
            type="button"
            className={`top-icon top-notif-btn${openMenu === "notifications" ? " open" : ""}`}
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            aria-haspopup="menu"
            aria-expanded={openMenu === "notifications"}
            onClick={() => toggleMenu("notifications")}
          >
            <IconBell />
            {unreadCount > 0 ? (
              <span className="top-notif-badge" aria-hidden="true">
                {badgeLabel}
              </span>
            ) : null}
          </button>
          {openMenu === "notifications" ? (
            <div
              className="org-dropdown org-dropdown-wide top-notif-dropdown"
              role="menu"
            >
              <div className="org-dropdown-label top-notif-label">Notifications</div>
              <div className="top-notif-list">
                {PORTAL_NOTIFICATIONS.length === 0 ? (
                  <div className="top-notif-empty">No notifications yet.</div>
                ) : (
                  listPortalNotifications().map((item) =>
                    notificationItem(item, seenInPanel.has(item.id)),
                  )
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="org-menu">
          <button
            type="button"
            className={`org-pill${openMenu === "user" ? " open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "user"}
            onClick={() => toggleMenu("user")}
          >
            <div className="avatar">{getInitials(fullName)}</div>
            {firstName}
            <IconChevronDown />
          </button>
          {openMenu === "user" ? (
            <div className="org-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                className="org-dropdown-item"
                onClick={() => {
                  setOpenMenu(null);
                  onLogout();
                }}
              >
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
