"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PORTAL_ROUTES } from "@/lib/portal-nav";
import {
  IconChevronDown,
  IconHelp,
  IconSettings,
} from "./PortalIcons";

type PortalTopbarProps = {
  fullName: string;
  pageTitle: string;
  onLogout: () => void;
};

type OpenMenu = "help" | "settings" | "user" | null;
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
  const [theme, setTheme] = useState<ThemeMode>("light");
  const menusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const next: ThemeMode = stored === "dark" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
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

  function toggleMenu(menu: Exclude<OpenMenu, null>) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function setThemeMode(next: ThemeMode) {
    setTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 id="pageTitle">{pageTitle}</h1>
      </div>
      <div className="topbar-right" ref={menusRef}>
        <div className="org-menu">
          <button
            type="button"
            className={`top-icon${openMenu === "help" ? " open" : ""}`}
            aria-label="Help"
            aria-haspopup="menu"
            aria-expanded={openMenu === "help"}
            onClick={() => toggleMenu("help")}
          >
            <IconHelp />
          </button>
          {openMenu === "help" ? (
            <div className="org-dropdown org-dropdown-wide" role="menu">
              <div className="org-dropdown-label">Help</div>
              <Link
                href={PORTAL_ROUTES.drip}
                className="org-dropdown-item"
                role="menuitem"
                onClick={() => setOpenMenu(null)}
              >
                Drip campaigns
              </Link>
              <Link
                href={PORTAL_ROUTES.oneone}
                className="org-dropdown-item"
                role="menuitem"
                onClick={() => setOpenMenu(null)}
              >
                1-1 campaigns
              </Link>
              <Link
                href={PORTAL_ROUTES.contacts}
                className="org-dropdown-item"
                role="menuitem"
                onClick={() => setOpenMenu(null)}
              >
                CRM contacts
              </Link>
              <Link
                href={PORTAL_ROUTES.smtp}
                className="org-dropdown-item"
                role="menuitem"
                onClick={() => setOpenMenu(null)}
              >
                Sender / SMTP setup
              </Link>
              <a
                href="mailto:support@nexuses.in?subject=Unified%20Portal%20help"
                className="org-dropdown-item"
                role="menuitem"
                onClick={() => setOpenMenu(null)}
              >
                Contact support
              </a>
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
